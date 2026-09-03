import { describe, expect, it } from "vitest";
import { InferenceRequestBudget } from "./budget.js";
import { createInferenceGateway } from "./InferenceGateway.js";
import { InMemoryInferenceTelemetrySink } from "./telemetry.js";
import type { InferenceGatewayConfig } from "./types.js";
import {
  ATTEMPT_ID_HEADER,
  REQUEST_ID_HEADER,
  RUN_ID_HEADER,
  TASK_ID_HEADER,
} from "./types.js";

const MODEL = "qwen/qwen3-coder:free";

const config: InferenceGatewayConfig = {
  openRouterApiKey: "openrouter-secret",
  openRouterBaseUrl: "https://openrouter.example/api/v1",
  allowedModels: [MODEL],
  dailyRequestLimit: 50,
  requestsPerMinute: 20,
  host: "127.0.0.1",
  port: 3210,
  maxRequestBodyBytes: 1_000_000,
  telemetryPath: "/tmp/gateway.jsonl",
};

const request = (
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request =>
  new Request("http://127.0.0.1:3210/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [RUN_ID_HEADER]: "run-1",
      [TASK_ID_HEADER]: "task-1",
      [ATTEMPT_ID_HEADER]: "attempt-1",
      ...headers,
    },
    body: JSON.stringify(body),
  });

const fixedNow = (): Date => new Date("2026-09-03T12:00:00.000Z");

describe("InferenceGateway", () => {
  it("forwards an attributed free-model request to OpenRouter and records usage", async () => {
    const telemetry = new InMemoryInferenceTelemetrySink();
    let seenUrl = "";
    let seenAuthorization = "";
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      seenUrl = String(input);
      seenAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(
        JSON.stringify({
          id: "completion-1",
          model: MODEL,
          usage: { prompt_tokens: 120, completion_tokens: 30 },
          choices: [],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "openrouter-request-1",
          },
        },
      );
    }) as typeof fetch;
    const gateway = createInferenceGateway({
      config,
      telemetry,
      fetchImpl,
      now: fixedNow,
      createRequestId: () => "gateway-request-1",
    });

    const response = await gateway.handle(
      request({
        model: MODEL,
        messages: [{ role: "user", content: "hello" }],
        tools: [{ type: "function", function: { name: "read_file" } }],
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("gateway-request-1");
    expect(seenUrl).toBe("https://openrouter.example/api/v1/chat/completions");
    expect(seenAuthorization).toBe("Bearer openrouter-secret");
    expect(telemetry.events()).toEqual([
      expect.objectContaining({
        requestId: "gateway-request-1",
        runId: "run-1",
        taskId: "task-1",
        attemptId: "attempt-1",
        requestedModel: MODEL,
        servedModel: MODEL,
        inputTokens: 120,
        outputTokens: 30,
        toolSchemaPresent: true,
        httpStatus: 200,
        status: "succeeded",
        upstreamRequestId: "openrouter-request-1",
      }),
    ]);
  });

  it("proxies streaming SSE and observes final usage before the stream closes", async () => {
    const telemetry = new InMemoryInferenceTelemetrySink();
    const encoder = new TextEncoder();
    const fetchImpl = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ model: MODEL, choices: [{ delta: { content: "hi" } }] })}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ model: MODEL, usage: { prompt_tokens: 10, completion_tokens: 2 }, choices: [] })}\n\ndata: [DONE]\n\n`,
              ),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )) as typeof fetch;
    const gateway = createInferenceGateway({
      config,
      telemetry,
      fetchImpl,
      now: fixedNow,
      createRequestId: () => "stream-request",
    });

    const response = await gateway.handle(
      request({ model: MODEL, messages: [], stream: true }),
    );
    const streamed = await response.text();

    expect(streamed).toContain("data:");
    expect(streamed).toContain("[DONE]");
    expect(telemetry.events()).toEqual([
      expect.objectContaining({
        requestId: "stream-request",
        requestedModel: MODEL,
        servedModel: MODEL,
        inputTokens: 10,
        outputTokens: 2,
        status: "succeeded",
      }),
    ]);
  });

  it("rejects requests without durable run/task/attempt attribution", async () => {
    let calls = 0;
    const gateway = createInferenceGateway({
      config,
      telemetry: new InMemoryInferenceTelemetrySink(),
      fetchImpl: (async () => {
        calls++;
        return new Response("{}");
      }) as typeof fetch,
    });

    const response = await gateway.handle(
      new Request("http://127.0.0.1:3210/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages: [] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });

  it("rejects paid or non-allowlisted models before spending provider quota", async () => {
    const telemetry = new InMemoryInferenceTelemetrySink();
    let calls = 0;
    const gateway = createInferenceGateway({
      config,
      telemetry,
      fetchImpl: (async () => {
        calls++;
        return new Response("{}");
      }) as typeof fetch,
      now: fixedNow,
      createRequestId: () => "rejected-request",
    });

    const response = await gateway.handle(
      request({ model: "openai/gpt-5-mini", messages: [] }),
    );

    expect(response.status).toBe(403);
    expect(calls).toBe(0);
    expect(telemetry.events()[0]).toEqual(
      expect.objectContaining({ failureType: "MODEL_NOT_ALLOWED" }),
    );
  });

  it("enforces the local per-minute budget before forwarding", async () => {
    const telemetry = new InMemoryInferenceTelemetrySink();
    let calls = 0;
    const gateway = createInferenceGateway({
      config,
      telemetry,
      budget: new InferenceRequestBudget(10, 1),
      fetchImpl: (async () => {
        calls++;
        return new Response(JSON.stringify({ model: MODEL, choices: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
      now: fixedNow,
    });

    expect(
      (await gateway.handle(request({ model: MODEL, messages: [] }))).status,
    ).toBe(200);
    const rejected = await gateway.handle(request({ model: MODEL, messages: [] }));

    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).not.toBeNull();
    expect(calls).toBe(1);
    expect(telemetry.events().at(-1)).toEqual(
      expect.objectContaining({ failureType: "LOCAL_RATE_LIMITED" }),
    );
  });

  it("preserves upstream 429 handling and classifies it separately from local limits", async () => {
    const telemetry = new InMemoryInferenceTelemetrySink();
    const gateway = createInferenceGateway({
      config,
      telemetry,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "7" },
        })) as typeof fetch,
      now: fixedNow,
      createRequestId: () => "rate-limit-request",
    });

    const response = await gateway.handle(
      request({ model: MODEL, messages: [] }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(telemetry.events()[0]).toEqual(
      expect.objectContaining({ failureType: "RATE_LIMITED" }),
    );
  });

  it("classifies model availability failures", async () => {
    const telemetry = new InMemoryInferenceTelemetrySink();
    const gateway = createInferenceGateway({
      config,
      telemetry,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { message: "no endpoints" } }), {
          status: 503,
        })) as typeof fetch,
      now: fixedNow,
    });

    const response = await gateway.handle(
      request({ model: MODEL, messages: [] }),
    );

    expect(response.status).toBe(503);
    expect(telemetry.events()[0]).toEqual(
      expect.objectContaining({ failureType: "MODEL_UNAVAILABLE" }),
    );
  });

  it("turns transport failures into observable 502 responses", async () => {
    const telemetry = new InMemoryInferenceTelemetrySink();
    const gateway = createInferenceGateway({
      config,
      telemetry,
      fetchImpl: (async () => {
        throw new Error("connection reset");
      }) as typeof fetch,
      now: fixedNow,
    });

    const response = await gateway.handle(
      request({ model: MODEL, messages: [] }),
    );

    expect(response.status).toBe(502);
    expect(telemetry.events()[0]).toEqual(
      expect.objectContaining({ failureType: "NETWORK_ERROR" }),
    );
  });

  it("exposes only allowlisted models from the local models endpoint", async () => {
    const gateway = createInferenceGateway({
      config,
      telemetry: new InMemoryInferenceTelemetrySink(),
    });
    const response = await gateway.handle(
      new Request("http://127.0.0.1:3210/v1/models"),
    );
    const payload = (await response.json()) as { data: Array<{ id: string }> };

    expect(payload.data.map(({ id }) => id)).toEqual([MODEL]);
  });
});
