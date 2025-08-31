import type { Context } from "hono";
import { env } from "hono/adapter";
import type { Env } from "../types";
import { fetchModels, createErrorResponse } from "../utils";
import { backendState } from "../index";

export async function handleModels(c: Context): Promise<Response> {
  try {
    const envVars = env<Env>(c);
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

    const openaiModels = {
      object: "list",
      data: Array.from(models.entries())
        .map(([id, info]) => ({
          id: id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: info.provider,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    };

    return new Response(JSON.stringify(openaiModels, null, 2) + "\n", {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error: any) {
    console.error("Error in handleModels:", error);
    backendState.isWorking = false;
    backendState.lastFailureTime = Date.now();
    return createErrorResponse(
      `Failed to fetch models: ${error.message}`,
      500,
      "relay_error",
    );
  }
}
