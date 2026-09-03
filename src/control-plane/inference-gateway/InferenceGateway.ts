import { randomUUID } from "node:crypto";
import { InferenceRequestBudget } from "./budget.js";
import type {
  ChatCompletionRequestBody,
  InferenceAttribution,
  InferenceFailureType,
  InferenceGatewayConfig,
  InferenceTelemetryEvent,
  InferenceTelemetrySink,
  TokenUsage,
} from "./types.js";
import {
  ATTEMPT_ID_HEADER,
  REQUEST_ID_HEADER,
  RUN_ID_HEADER,
  TASK_ID_HEADER,
} from "./types.js";

export interface InferenceGateway {
  handle(request: Request): Promise<Response>;
  waitForIdle(): Promise<void>;
  budgetSnapshot(): ReturnType<InferenceRequestBudget["snapshot"]>;
}

export interface InferenceGatewayDependencies {
  readonly config: InferenceGatewayConfig;
  readonly telemetry: InferenceTelemetrySink;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly createRequestId?: () => string;
  readonly budget?: InferenceRequestBudget;
}

interface ResponseObservation {
  servedModel?: string;
  usage: TokenUsage;
}

const json = (status: number, body: unknown, headers?: HeadersInit): Response => {
  const outputHeaders = new Headers(headers);
  if (!outputHeaders.has("content-type")) {
    outputHeaders.set("content-type", "application/json");
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: outputHeaders,
  });
};

const requiredAttribution = (
  headers: Headers,
): InferenceAttribution | undefined => {
  const runId = headers.get(RUN_ID_HEADER)?.trim();
  const taskId = headers.get(TASK_ID_HEADER)?.trim();
  const attemptId = headers.get(ATTEMPT_ID_HEADER)?.trim();
  if (!runId || !taskId || !attemptId) return undefined;
  return { runId, taskId, attemptId };
};

const parseUsage = (value: unknown): TokenUsage => {
  if (typeof value !== "object" || value === null) return {};
  const usage = value as Record<string, unknown>;
  const input =
    typeof usage.prompt_tokens === "number"
      ? usage.prompt_tokens
      : typeof usage.input_tokens === "number"
        ? usage.input_tokens
        : undefined;
  const output =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : typeof usage.output_tokens === "number"
        ? usage.output_tokens
        : undefined;
  return { inputTokens: input, outputTokens: output };
};

const observeJson = (text: string): ResponseObservation => {
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    return {
      servedModel:
        typeof payload.model === "string" ? payload.model : undefined,
      usage: parseUsage(payload.usage),
    };
  } catch {
    return { usage: {} };
  }
};

const classifyUpstreamFailure = (
  status: number,
  responseText: string,
): InferenceFailureType => {
  const detail = responseText.toLowerCase();
  if (status === 401 || status === 403) return "AUTHENTICATION_FAILED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 400 || status === 413) {
    if (
      detail.includes("context length") ||
      detail.includes("context window") ||
      detail.includes("maximum context") ||
      detail.includes("too many tokens")
    ) {
      return "CONTEXT_OVERFLOW";
    }
    return "INVALID_REQUEST";
  }
  if (status === 404 || status === 503) return "MODEL_UNAVAILABLE";
  if (status >= 500) return "UPSTREAM_UNAVAILABLE";
  return "INVALID_REQUEST";
};

const responseHeaders = (upstream: Response, requestId: string): Headers => {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  const cacheControl = upstream.headers.get("cache-control");
  const retryAfter = upstream.headers.get("retry-after");
  if (contentType) headers.set("content-type", contentType);
  if (cacheControl) headers.set("cache-control", cacheControl);
  if (retryAfter) headers.set("retry-after", retryAfter);
  headers.set(REQUEST_ID_HEADER, requestId);
  return headers;
};

const upstreamRequestId = (upstream: Response): string | undefined =>
  upstream.headers.get("x-request-id") ??
  upstream.headers.get("x-openrouter-request-id") ??
  undefined;

export const createInferenceGateway = (
  dependencies: InferenceGatewayDependencies,
): InferenceGateway => {
  const { config, telemetry } = dependencies;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const createRequestId = dependencies.createRequestId ?? randomUUID;
  const budget =
    dependencies.budget ??
    new InferenceRequestBudget(
      config.dailyRequestLimit,
      config.requestsPerMinute,
    );
  const allowedModels = new Set(config.allowedModels);

  const record = async (
    attribution: InferenceAttribution,
    requestId: string,
    requestedModel: string,
    toolSchemaPresent: boolean,
    startedAt: Date,
    httpStatus: number,
    status: "succeeded" | "failed",
    options: {
      servedModel?: string;
      usage?: TokenUsage;
      failureType?: InferenceFailureType;
      upstreamRequestId?: string;
    } = {},
  ): Promise<void> => {
    const finishedAt = now();
    const event: InferenceTelemetryEvent = {
      ...attribution,
      requestId,
      requestedModel,
      servedModel: options.servedModel,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      httpStatus,
      inputTokens: options.usage?.inputTokens,
      outputTokens: options.usage?.outputTokens,
      toolSchemaPresent,
      status,
      failureType: options.failureType,
      upstreamRequestId: options.upstreamRequestId,
    };
    await telemetry.record(event);
  };

  const streamingBody = (
    body: ReadableStream<Uint8Array>,
    attribution: InferenceAttribution,
    requestId: string,
    requestedModel: string,
    toolSchemaPresent: boolean,
    startedAt: Date,
    upstream: Response,
  ): ReadableStream<Uint8Array> => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let servedModel: string | undefined;
    let usage: TokenUsage = {};

    const inspectLine = (line: string): void => {
      if (!line.startsWith("data:")) return;
      const data = line.slice("data:".length).trim();
      if (!data || data === "[DONE]") return;
      try {
        const payload = JSON.parse(data) as Record<string, unknown>;
        if (typeof payload.model === "string") servedModel = payload.model;
        const parsed = parseUsage(payload.usage);
        if (parsed.inputTokens !== undefined || parsed.outputTokens !== undefined) {
          usage = parsed;
        }
      } catch {
        // Unknown SSE payloads are forwarded untouched and ignored for metrics.
      }
    };

    const inspectText = (text: string, flush: boolean): void => {
      buffer += text;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        inspectLine(line);
        newline = buffer.indexOf("\n");
      }
      if (flush && buffer.length > 0) {
        inspectLine(buffer.replace(/\r$/, ""));
        buffer = "";
      }
    };

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (done) {
            inspectText(decoder.decode(), true);
            await record(
              attribution,
              requestId,
              requestedModel,
              toolSchemaPresent,
              startedAt,
              upstream.status,
              "succeeded",
              {
                servedModel,
                usage,
                upstreamRequestId: upstreamRequestId(upstream),
              },
            );
            controller.close();
            return;
          }
          inspectText(decoder.decode(value, { stream: true }), false);
          controller.enqueue(value);
        } catch (error) {
          try {
            await record(
              attribution,
              requestId,
              requestedModel,
              toolSchemaPresent,
              startedAt,
              upstream.status,
              "failed",
              {
                servedModel,
                usage,
                failureType: "NETWORK_ERROR",
                upstreamRequestId: upstreamRequestId(upstream),
              },
            );
          } finally {
            controller.error(error);
          }
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    });
  };

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return json(200, { status: "ok" });
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      return json(200, {
        object: "list",
        data: config.allowedModels.map((model) => ({
          id: model,
          object: "model",
          owned_by: "openrouter",
        })),
      });
    }

    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return json(404, { error: { message: "Not found" } });
    }

    const attribution = requiredAttribution(request.headers);
    if (!attribution) {
      return json(400, {
        error: {
          message: `Missing required attribution headers: ${RUN_ID_HEADER}, ${TASK_ID_HEADER}, ${ATTEMPT_ID_HEADER}`,
        },
      });
    }

    const requestText = await request.text();
    if (Buffer.byteLength(requestText, "utf8") > config.maxRequestBodyBytes) {
      return json(413, { error: { message: "Request body exceeds gateway limit" } });
    }

    let body: ChatCompletionRequestBody;
    try {
      body = JSON.parse(requestText) as ChatCompletionRequestBody;
    } catch {
      return json(400, { error: { message: "Request body must be valid JSON" } });
    }

    if (typeof body.model !== "string" || body.model.trim().length === 0) {
      return json(400, { error: { message: "model is required" } });
    }

    const requestId = createRequestId();
    const requestedModel = body.model;
    const toolSchemaPresent =
      (Array.isArray(body.tools) && body.tools.length > 0) ||
      (Array.isArray(body.functions) && body.functions.length > 0);
    const startedAt = now();

    if (body.models !== undefined || body.preset !== undefined) {
      await record(
        attribution,
        requestId,
        requestedModel,
        toolSchemaPresent,
        startedAt,
        403,
        "failed",
        { failureType: "MODEL_NOT_ALLOWED" },
      );
      return json(
        403,
        {
          error: {
            message:
              "Model fallbacks and presets are not allowed at the inference gateway; semantic model selection belongs to the control plane",
          },
        },
        { [REQUEST_ID_HEADER]: requestId },
      );
    }

    if (!requestedModel.endsWith(":free") || !allowedModels.has(requestedModel)) {
      await record(
        attribution,
        requestId,
        requestedModel,
        toolSchemaPresent,
        startedAt,
        403,
        "failed",
        { failureType: "MODEL_NOT_ALLOWED" },
      );
      return json(
        403,
        { error: { message: `Model is not allowed by gateway: ${requestedModel}` } },
        { [REQUEST_ID_HEADER]: requestId },
      );
    }

    const budgetDecision = budget.tryConsume(startedAt);
    if (!budgetDecision.allowed) {
      await record(
        attribution,
        requestId,
        requestedModel,
        toolSchemaPresent,
        startedAt,
        429,
        "failed",
        { failureType: budgetDecision.reason },
      );
      return json(
        429,
        { error: { message: budgetDecision.reason } },
        {
          [REQUEST_ID_HEADER]: requestId,
          "retry-after": String(Math.ceil(budgetDecision.retryAfterMs / 1000)),
        },
      );
    }

    const upstreamHeaders = new Headers({
      authorization: `Bearer ${config.openRouterApiKey}`,
      "content-type": "application/json",
    });
    if (config.httpReferer) {
      upstreamHeaders.set("HTTP-Referer", config.httpReferer);
    }
    if (config.appTitle) upstreamHeaders.set("X-Title", config.appTitle);

    const upstreamUrl = `${config.openRouterBaseUrl.replace(/\/$/, "")}/chat/completions`;
    let upstream: Response;
    try {
      upstream = await fetchImpl(upstreamUrl, {
        method: "POST",
        headers: upstreamHeaders,
        body: requestText,
      });
    } catch {
      await record(
        attribution,
        requestId,
        requestedModel,
        toolSchemaPresent,
        startedAt,
        502,
        "failed",
        { failureType: "NETWORK_ERROR" },
      );
      return json(
        502,
        { error: { message: "OpenRouter request failed before a response was received" } },
        { [REQUEST_ID_HEADER]: requestId },
      );
    }

    if (!upstream.ok) {
      const responseText = await upstream.text();
      await record(
        attribution,
        requestId,
        requestedModel,
        toolSchemaPresent,
        startedAt,
        upstream.status,
        "failed",
        {
          failureType: classifyUpstreamFailure(upstream.status, responseText),
          upstreamRequestId: upstreamRequestId(upstream),
        },
      );
      return new Response(responseText, {
        status: upstream.status,
        headers: responseHeaders(upstream, requestId),
      });
    }

    if (body.stream === true && upstream.body) {
      return new Response(
        streamingBody(
          upstream.body,
          attribution,
          requestId,
          requestedModel,
          toolSchemaPresent,
          startedAt,
          upstream,
        ),
        {
          status: upstream.status,
          headers: responseHeaders(upstream, requestId),
        },
      );
    }

    const responseText = await upstream.text();
    const observed = observeJson(responseText);
    await record(
      attribution,
      requestId,
      requestedModel,
      toolSchemaPresent,
      startedAt,
      upstream.status,
      "succeeded",
      {
        servedModel: observed.servedModel,
        usage: observed.usage,
        upstreamRequestId: upstreamRequestId(upstream),
      },
    );
    return new Response(responseText, {
      status: upstream.status,
      headers: responseHeaders(upstream, requestId),
    });
  };

  return {
    handle,
    async waitForIdle(): Promise<void> {
      // Non-streaming telemetry is awaited in handle(). Streaming telemetry is
      // awaited before the proxied stream closes, so there is no detached work.
    },
    budgetSnapshot(): ReturnType<InferenceRequestBudget["snapshot"]> {
      return budget.snapshot(now());
    },
  };
};
