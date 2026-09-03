import { describe, expect, it } from "vitest";
import { createInferenceGateway } from "./InferenceGateway.js";
import { InMemoryInferenceTelemetrySink } from "./telemetry.js";
import type { InferenceGatewayConfig } from "./types.js";
import {
  ATTEMPT_ID_HEADER,
  RUN_ID_HEADER,
  TASK_ID_HEADER,
} from "./types.js";

const MODEL = "qwen/qwen3-coder:free";

const config: InferenceGatewayConfig = {
  openRouterApiKey: "secret",
  openRouterBaseUrl: "https://openrouter.example/api/v1",
  allowedModels: [MODEL],
  dailyRequestLimit: 50,
  requestsPerMinute: 20,
  host: "127.0.0.1",
  port: 3210,
  maxRequestBodyBytes: 1_000_000,
  telemetryPath: "/tmp/gateway.jsonl",
};

const attributedRequest = (body: Record<string, unknown>): Request =>
  new Request("http://127.0.0.1:3210/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [RUN_ID_HEADER]: "run-policy",
      [TASK_ID_HEADER]: "task-policy",
      [ATTEMPT_ID_HEADER]: "attempt-policy",
    },
    body: JSON.stringify(body),
  });

describe("inference gateway semantic model policy", () => {
  it("rejects OpenRouter model fallback arrays before forwarding", async () => {
    const telemetry = new InMemoryInferenceTelemetrySink();
    let upstreamCalls = 0;
    const gateway = createInferenceGateway({
      config,
      telemetry,
      fetchImpl: (async () => {
        upstreamCalls++;
        return new Response("{}");
      }) as typeof fetch,
    });

    const response = await gateway.handle(
      attributedRequest({
        model: MODEL,
        models: [MODEL, "openai/gpt-5-mini"],
        messages: [],
      }),
    );

    expect(response.status).toBe(403);
    expect(upstreamCalls).toBe(0);
    expect(telemetry.events()[0]).toEqual(
      expect.objectContaining({ failureType: "MODEL_NOT_ALLOWED" }),
    );
  });

  it("rejects presets that could change semantic model routing", async () => {
    let upstreamCalls = 0;
    const gateway = createInferenceGateway({
      config,
      telemetry: new InMemoryInferenceTelemetrySink(),
      fetchImpl: (async () => {
        upstreamCalls++;
        return new Response("{}");
      }) as typeof fetch,
    });

    const response = await gateway.handle(
      attributedRequest({
        model: MODEL,
        preset: "some-routing-preset",
        messages: [],
      }),
    );

    expect(response.status).toBe(403);
    expect(upstreamCalls).toBe(0);
  });
});
