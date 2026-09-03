import { join } from "node:path";
import type { InferenceGatewayConfig } from "./types.js";

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_DAILY_REQUEST_LIMIT = 50;
const DEFAULT_REQUESTS_PER_MINUTE = 20;
const DEFAULT_PORT = 3210;
const DEFAULT_MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

const requireValue = (
  env: NodeJS.ProcessEnv,
  key: string,
): string => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const positiveInteger = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number => {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer; received ${raw}`);
  }
  return value;
};

const nonNegativeInteger = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number => {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer; received ${raw}`);
  }
  return value;
};

export const parseAllowedModels = (raw: string): string[] => {
  const models = [...new Set(raw.split(",").map((model) => model.trim()).filter(Boolean))];
  if (models.length === 0) {
    throw new Error("SANDCASTLE_GATEWAY_ALLOWED_MODELS must contain at least one model");
  }
  const paid = models.filter((model) => !model.endsWith(":free"));
  if (paid.length > 0) {
    throw new Error(
      `SANDCASTLE_GATEWAY_ALLOWED_MODELS only accepts explicit :free models; rejected: ${paid.join(", ")}`,
    );
  }
  return models;
};

export const loadInferenceGatewayConfig = (
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): InferenceGatewayConfig => {
  const openRouterApiKey = requireValue(env, "OPENROUTER_API_KEY");
  const allowedModels = parseAllowedModels(
    requireValue(env, "SANDCASTLE_GATEWAY_ALLOWED_MODELS"),
  );

  return {
    openRouterApiKey,
    openRouterBaseUrl:
      env.SANDCASTLE_GATEWAY_OPENROUTER_BASE_URL?.trim() ||
      DEFAULT_OPENROUTER_BASE_URL,
    allowedModels,
    dailyRequestLimit: positiveInteger(
      env,
      "SANDCASTLE_GATEWAY_DAILY_REQUEST_LIMIT",
      DEFAULT_DAILY_REQUEST_LIMIT,
    ),
    requestsPerMinute: positiveInteger(
      env,
      "SANDCASTLE_GATEWAY_REQUESTS_PER_MINUTE",
      DEFAULT_REQUESTS_PER_MINUTE,
    ),
    host: env.SANDCASTLE_GATEWAY_HOST?.trim() || "127.0.0.1",
    port: nonNegativeInteger(env, "SANDCASTLE_GATEWAY_PORT", DEFAULT_PORT),
    maxRequestBodyBytes: positiveInteger(
      env,
      "SANDCASTLE_GATEWAY_MAX_REQUEST_BODY_BYTES",
      DEFAULT_MAX_REQUEST_BODY_BYTES,
    ),
    telemetryPath:
      env.SANDCASTLE_GATEWAY_TELEMETRY_PATH?.trim() ||
      join(cwd, ".sandcastle", "logs", "inference-gateway.jsonl"),
    httpReferer: env.OPENROUTER_HTTP_REFERER?.trim() || undefined,
    appTitle: env.OPENROUTER_APP_TITLE?.trim() || undefined,
  };
};
