import { describe, expect, it } from "vitest";
import { createInferenceGateway } from "./InferenceGateway.js";
import { createInferenceGatewayServer } from "./server.js";
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
  port: 0,
  maxRequestBodyBytes: 1_000_000,
  telemetryPath: "/tmp/gateway.jsonl",
};

describe("InferenceGatewayServer", () => {
  it("serves an OpenAI-compatible chat completion endpoint over localhost", async () => {
    const telemetry = new InMemoryInferenceTelemetrySink();
    const gateway = createInferenceGateway({
      config,
      telemetry,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            id: "completion-1",
            object: "chat.completion",
            model: MODEL,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch,
    });
    const server = createInferenceGatewayServer({
      gateway,
      host: "127.0.0.1",
      port: 0,
      maxRequestBodyBytes: config.maxRequestBodyBytes,
    });

    const { url } = await server.start();
    try {
      const response = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RUN_ID_HEADER]: "run-http",
          [TASK_ID_HEADER]: "task-http",
          [ATTEMPT_ID_HEADER]: "attempt-http",
        },
        body: JSON.stringify({ model: MODEL, messages: [] }),
      });
      const payload = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      expect(response.status).toBe(200);
      expect(payload.choices[0]?.message.content).toBe("ok");
      expect(telemetry.events()[0]).toEqual(
        expect.objectContaining({
          runId: "run-http",
          taskId: "task-http",
          attemptId: "attempt-http",
          requestedModel: MODEL,
          status: "succeeded",
        }),
      );
    } finally {
      await server.close();
    }
  });
});
