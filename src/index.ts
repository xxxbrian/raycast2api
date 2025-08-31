import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "hono/adapter";
import type { Context } from "hono";
import type { Env } from "./types";
import { createErrorResponse, validateApiKey, fetchModels } from "./utils";
import { handleChatCompletions } from "./handlers/chat";
import { handleModels } from "./handlers/models";

// Rate limiting configuration
const READINESS_CHECK_INTERVAL_MS = 30000; // 30 seconds

// Simple backend state tracking
export const backendState = {
  isWorking: true, // Optimistic default
  lastCheckTime: 0,
  lastSuccessTime: 0,
  lastFailureTime: 0,
};

const app = new Hono<{ Bindings: Env }>();

app.use(
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

app.use(async (c: Context, next) => {
  const envVars = env<Env>(c);

  // Skip authentication for health check endpoints
  const publicPaths = ["/health", "/ready"];
  if (publicPaths.includes(c.req.path)) {
    await next();
    return;
  }

  if (!envVars.RAYCAST_BEARER_TOKEN) {
    console.error("FATAL: RAYCAST_BEARER_TOKEN is not configured.");
    return createErrorResponse(
      "Server configuration error: Missing Raycast credentials",
      500,
      "server_error",
    );
  }

  if (!validateApiKey(c.req.header("Authorization") || null, envVars)) {
    console.log(
      `[${new Date().toISOString()}] Failed API Key validation for ${c.req.method} ${c.req.url}`,
    );
    return createErrorResponse(
      "Invalid API key provided.",
      401,
      "authentication_error",
    );
  }

  console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.path}`);
  await next();
});

app.post("/v1/chat/completions", async (c) => {
  return handleChatCompletions(c);
});

app.get("/v1/models", async (c) => {
  return handleModels(c);
});

app.get("/health", (c) => {
  const envVars = env<Env>(c);

  // Simple config check - no external API calls
  if (
    !envVars.RAYCAST_BEARER_TOKEN ||
    !envVars.RAYCAST_DEVICE_ID ||
    !envVars.RAYCAST_SIGNATURE_SECRET
  ) {
    return c.json(
      { status: "error", message: "Missing required configuration" },
      503,
    );
  }

  return c.json({ status: "ok" });
});

app.get("/ready", async (c) => {
  const envVars = env<Env>(c);
  const now = Date.now();

  // FIRST: Check required configuration
  if (
    !envVars.RAYCAST_BEARER_TOKEN ||
    !envVars.RAYCAST_DEVICE_ID ||
    !envVars.RAYCAST_SIGNATURE_SECRET
  ) {
    return c.json(
      {
        status: "not ready",
        reason: "missing_configuration",
      },
      503,
    );
  }

  // THEN: Check if backend is working (only after config is validated)
  if (backendState.isWorking) {
    return c.json({ status: "ready" });
  }

  // Rate limiting: only check every 30 seconds when not working
  if (now - backendState.lastCheckTime < READINESS_CHECK_INTERVAL_MS) {
    return c.json(
      {
        status: "not ready",
        message: "Backend not working, rate limited",
      },
      503,
    );
  }

  // Test Raycast API connectivity for readiness check
  // Note: fetchModels() currently handles its own errors and returns empty Map,
  // but this try-catch provides defensive programming in case fetchModels() is
  // refactored to throw exceptions in the future
  try {
    backendState.lastCheckTime = now;
    const models = await fetchModels(envVars);

    if (models.size > 0) {
      backendState.isWorking = true;
      backendState.lastSuccessTime = now;
      return c.json({ status: "ready" });
    } else {
      backendState.lastFailureTime = now;
      return c.json(
        {
          status: "not ready",
          message: "No models available",
        },
        503,
      );
    }
  } catch (error: any) {
    // Defensive catch: handles potential future changes to fetchModels() behavior
    backendState.lastFailureTime = now;
    return c.json(
      {
        status: "not ready",
        message: `API test failed: ${error.message}`,
      },
      503,
    );
  }
});

app.all("*", () => {
  return createErrorResponse("Not Found", 404, "invalid_request_error");
});

export default app;
