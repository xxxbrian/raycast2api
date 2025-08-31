import type { Context } from "hono";
import { env } from "hono/adapter";
import type {
  Env,
  OpenAIChatRequest,
  RaycastChatRequest,
  OpenAIChatResponse,
  RaycastSSEData,
} from "../types";
import {
  fetchModels,
  getProviderInfo,
  convertMessages,
  getRaycastHeaders,
  parseSSEResponse,
  createErrorResponse,
  generateUUID,
} from "../utils";
import { RAYCAST_API_URL, DEFAULT_MODEL_ID } from "../config";
import { backendState } from "../index";

export async function handleChatCompletions(c: Context): Promise<Response> {
  try {
    const envVars = env<Env>(c);
    const body = (await c.req.json()) as OpenAIChatRequest;

    const {
      messages,
      model: requestedModelId = DEFAULT_MODEL_ID,
      temperature = 0.5,
      stream = false,
    } = body;

    if (!messages?.length) {
      return createErrorResponse(
        "Missing or invalid 'messages' field",
        400,
        "invalid_request_error",
      );
    }

    const models = await fetchModels(envVars);
    if (models.size === 0) {
      backendState.isWorking = false;
      backendState.lastFailureTime = Date.now();
      return createErrorResponse(
        "No models available. Check server configuration.",
        500,
        "server_error",
      );
    }

    // Mark backend as working when models are successfully fetched
    backendState.isWorking = true;
    backendState.lastSuccessTime = Date.now();

    const { provider, model: internalModelName } = getProviderInfo(
      requestedModelId,
      models,
    );

    console.log(
      `Relaying request for ${requestedModelId} to Raycast ${provider}/${internalModelName}`,
    );

    const { raycastMessages, systemInstruction } = convertMessages(messages);

    const raycastRequest: RaycastChatRequest = {
      model: internalModelName,
      provider,
      messages: raycastMessages,
      system_instruction: systemInstruction,
      temperature,
      additional_system_instructions: "",
      debug: false,
      locale: "en-US",
      source: "ai_chat",
      thread_id: generateUUID(),
      tools: [],
    };

    const requestBody = JSON.stringify(raycastRequest);
    const raycastResponse = await fetch(RAYCAST_API_URL, {
      method: "POST",
      headers: await getRaycastHeaders(envVars, requestBody),
      body: requestBody,
    });
    console.log(raycastResponse);

    console.log(`Raycast API response status: ${raycastResponse.status}`);

    if (!raycastResponse.ok) {
      const errorText = await raycastResponse.text();
      console.error(`Raycast API error response body: ${errorText}`);
      backendState.isWorking = false;
      backendState.lastFailureTime = Date.now();
      return createErrorResponse(
        `Raycast API error (${raycastResponse.status})`,
        502,
        "bad_gateway",
      );
    }

    // Mark backend as working when API call succeeds
    backendState.isWorking = true;
    backendState.lastSuccessTime = Date.now();

    return stream
      ? handleStreamingResponse(raycastResponse, requestedModelId)
      : handleNonStreamingResponse(raycastResponse, requestedModelId);
  } catch (error: any) {
    console.error("Error in handleChatCompletions:", error);
    backendState.isWorking = false;
    backendState.lastFailureTime = Date.now();
    return createErrorResponse(
      `Chat completion failed: ${error.message}`,
      500,
      "relay_error",
    );
  }
}

function handleStreamingResponse(
  response: Response,
  requestedModelId: string,
): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    if (!response.body) {
      console.error("No response body from Raycast for streaming.");
      try {
        await writer.close();
      } catch {}
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamFinished = false;
    let aborted = false;

    try {
      while (!streamFinished) {
        const { done, value } = await reader.read();
        if (done) {
          streamFinished = true;
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        let newlineIndex;

        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);

          if (!line.startsWith("data:")) continue;

          const dataContent = line.substring(5).trim();
          if (dataContent === "[DONE]") {
            streamFinished = true;
            break;
          }

          try {
            const jsonData: RaycastSSEData = JSON.parse(dataContent);
            const chunk = {
              id: `chatcmpl-${generateUUID()}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: requestedModelId,
              choices: [
                {
                  index: 0,
                  delta: { content: jsonData.text || "" },
                  finish_reason:
                    jsonData.finish_reason === undefined
                      ? null
                      : jsonData.finish_reason,
                },
              ],
            };

            try {
              await writer.write(
                encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
              );
            } catch (writeError) {
              console.error("Failed to write to client stream:", writeError);
              aborted = true;
              try {
                await writer.abort(writeError as any);
              } catch {}
              streamFinished = true;
              break;
            }

            if (
              jsonData.finish_reason !== null &&
              jsonData.finish_reason !== undefined
            ) {
              streamFinished = true;
              break;
            }
          } catch (e) {
            console.error(
              "Failed to parse/process SSE chunk:",
              dataContent,
              "Error:",
              e,
            );
          }
        }
      }

      if (!aborted) {
        try {
          await writer.write(encoder.encode("data: [DONE]\n\n"));
        } catch (writeDoneError) {
          console.error("Failed to write final [DONE] chunk:", writeDoneError);
          aborted = true;
          try {
            await writer.abort(writeDoneError as any);
          } catch {}
        }
      }
    } catch (error) {
      console.error("Error processing Raycast stream:", error);
      if (!aborted) {
        try {
          await writer.abort(error as any);
        } catch {}
        aborted = true;
      }
    } finally {
      if (!aborted) {
        try {
          await writer.close();
        } catch {}
      }
      try {
        await reader.cancel();
      } catch (e) {
        console.error("Error cancelling reader:", e);
      }
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleNonStreamingResponse(
  response: Response,
  requestedModelId: string,
): Promise<Response> {
  const responseText = await response.text();
  const fullText = parseSSEResponse(responseText);

  const openaiResponse: OpenAIChatResponse = {
    id: `chatcmpl-${generateUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModelId,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: fullText,
          refusal: null,
          annotations: [],
        },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
      completion_tokens_details: {
        reasoning_tokens: 0,
        audio_tokens: 0,
        accepted_prediction_tokens: 0,
        rejected_prediction_tokens: 0,
      },
    },
    service_tier: "default",
    system_fingerprint: null,
  };

  return new Response(JSON.stringify(openaiResponse, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
