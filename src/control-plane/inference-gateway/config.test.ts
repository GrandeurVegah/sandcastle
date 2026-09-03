import { describe, expect, it } from "vitest";
import {
  loadInferenceGatewayConfig,
  parseAllowedModels,
} from "./config.js";

describe("inference gateway configuration", () => {
  it("requires an OpenRouter API key", () => {
    expect(() =>
      loadInferenceGatewayConfig({
        SANDCASTLE_GATEWAY_ALLOWED_MODELS: "qwen/qwen3-coder:free",
      }),
    ).toThrow("OPENROUTER_API_KEY is required");
  });

  it("requires explicit free models", () => {
    expect(() => parseAllowedModels("openai/gpt-5-mini")).toThrow(
      "only accepts explicit :free models",
    );
  });

  it("deduplicates and trims the model allowlist", () => {
    expect(
      parseAllowedModels(
        "qwen/qwen3-coder:free, qwen/qwen3-coder:free,openai/gpt-oss-120b:free",
      ),
    ).toEqual(["qwen/qwen3-coder:free", "openai/gpt-oss-120b:free"]);
  });

  it("uses conservative free-tier defaults while allowing overrides", () => {
    const config = loadInferenceGatewayConfig(
      {
        OPENROUTER_API_KEY: "secret",
        SANDCASTLE_GATEWAY_ALLOWED_MODELS: "qwen/qwen3-coder:free",
      },
      "/repo",
    );

    expect(config.dailyRequestLimit).toBe(50);
    expect(config.requestsPerMinute).toBe(20);
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3210);
    expect(config.telemetryPath).toBe(
      "/repo/.sandcastle/logs/inference-gateway.jsonl",
    );
  });

  it("rejects invalid numeric limits", () => {
    expect(() =>
      loadInferenceGatewayConfig({
        OPENROUTER_API_KEY: "secret",
        SANDCASTLE_GATEWAY_ALLOWED_MODELS: "qwen/qwen3-coder:free",
        SANDCASTLE_GATEWAY_REQUESTS_PER_MINUTE: "0",
      }),
    ).toThrow("must be a positive integer");
  });
});
