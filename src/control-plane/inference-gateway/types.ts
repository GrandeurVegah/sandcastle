export const RUN_ID_HEADER = "x-sandcastle-run-id";
export const TASK_ID_HEADER = "x-sandcastle-task-id";
export const ATTEMPT_ID_HEADER = "x-sandcastle-attempt-id";
export const REQUEST_ID_HEADER = "x-sandcastle-request-id";

export interface InferenceAttribution {
  readonly runId: string;
  readonly taskId: string;
  readonly attemptId: string;
}

export type InferenceFailureType =
  | "LOCAL_DAILY_BUDGET_EXHAUSTED"
  | "LOCAL_RATE_LIMITED"
  | "MODEL_NOT_ALLOWED"
  | "AUTHENTICATION_FAILED"
  | "RATE_LIMITED"
  | "MODEL_UNAVAILABLE"
  | "CONTEXT_OVERFLOW"
  | "INVALID_REQUEST"
  | "UPSTREAM_UNAVAILABLE"
  | "NETWORK_ERROR";

export interface InferenceTelemetryEvent extends InferenceAttribution {
  readonly requestId: string;
  readonly requestedModel: string;
  readonly servedModel?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly latencyMs: number;
  readonly httpStatus: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly toolSchemaPresent: boolean;
  readonly status: "succeeded" | "failed";
  readonly failureType?: InferenceFailureType;
  readonly upstreamRequestId?: string;
}

export interface InferenceTelemetrySink {
  record(event: InferenceTelemetryEvent): Promise<void> | void;
}

export interface InferenceGatewayConfig {
  readonly openRouterApiKey: string;
  readonly openRouterBaseUrl: string;
  readonly allowedModels: readonly string[];
  readonly dailyRequestLimit: number;
  readonly requestsPerMinute: number;
  readonly host: string;
  readonly port: number;
  readonly maxRequestBodyBytes: number;
  readonly telemetryPath: string;
  readonly httpReferer?: string;
  readonly appTitle?: string;
}

export interface ChatCompletionRequestBody {
  readonly model: string;
  /** OpenRouter semantic-model fallbacks are rejected by the Task 3 gateway. */
  readonly models?: readonly string[];
  /** Presets can alter model/routing behavior and are rejected in Task 3. */
  readonly preset?: string;
  readonly stream?: boolean;
  readonly tools?: readonly unknown[];
  readonly functions?: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface TokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}
