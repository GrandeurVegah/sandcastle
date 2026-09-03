# Local Inference Gateway

The local inference gateway is the control-plane boundary between a coding-agent harness and OpenRouter.

It exists because one Sandcastle attempt can cause multiple model requests. Request budgets and model telemetry therefore cannot be inferred from Sandcastle iteration counts.

## Scope

Task 3 implements an OpenAI-compatible local surface with:

- `GET /healthz`
- `GET /v1/models`
- `POST /v1/chat/completions`
- streaming SSE pass-through
- explicit `:free` model allowlisting
- per-minute and daily request limits
- run/task/attempt attribution
- requested and served model telemetry
- latency, token usage, tool-schema presence, HTTP status, and failure classification
- append-only JSONL telemetry

It does not implement adaptive model routing, durable workflow state, or persistent request-budget counters.

## Prerequisites

- Node.js 22, matching repository CI
- an OpenRouter API key
- at least one currently available explicit OpenRouter model whose ID ends in `:free`
- Pi if testing the coding-agent-facing API directly

Never commit the OpenRouter key.

## Configuration

Required:

```bash
export OPENROUTER_API_KEY="..."
export SANDCASTLE_GATEWAY_ALLOWED_MODELS="qwen/qwen3-coder:free"
```

Multiple models may be comma-separated. Every allowlisted model must end in `:free`.

Optional:

```bash
export SANDCASTLE_GATEWAY_HOST="127.0.0.1"
export SANDCASTLE_GATEWAY_PORT="3210"
export SANDCASTLE_GATEWAY_DAILY_REQUEST_LIMIT="50"
export SANDCASTLE_GATEWAY_REQUESTS_PER_MINUTE="20"
export SANDCASTLE_GATEWAY_TELEMETRY_PATH=".sandcastle/logs/inference-gateway.jsonl"
export OPENROUTER_HTTP_REFERER="https://example.com"
export OPENROUTER_APP_TITLE="Sandcastle"
```

The default request limits are conservative free-tier limits. Raise them only when the OpenRouter account state supports a higher allowance.

The default host is loopback. Binding the gateway to a non-loopback interface exposes a process that holds an OpenRouter credential, so only do that behind an appropriate local/container network boundary.

## Start the gateway

```bash
npm run gateway
```

The default local base URL is:

```text
http://127.0.0.1:3210/v1
```

The gateway uses `OPENROUTER_API_KEY` when forwarding to OpenRouter. A client-provided local API key is not forwarded upstream.

## Required attribution headers

Every `POST /v1/chat/completions` request must contain:

```text
x-sandcastle-run-id
x-sandcastle-task-id
x-sandcastle-attempt-id
```

Requests without all three are rejected before an upstream inference call is made.

The gateway adds:

```text
x-sandcastle-request-id
```

to proxied responses.

## Model-routing boundary

Task 3 accepts exactly one explicitly selected model per request.

The selected `model` must:

1. appear in `SANDCASTLE_GATEWAY_ALLOWED_MODELS`, and
2. end in `:free`.

The gateway rejects OpenRouter `models` fallback arrays and `preset` fields. Those mechanisms can change which semantic model ultimately handles the request and therefore belong to the future Sandcastle model router rather than the inference transport layer.

OpenRouter may still perform provider-endpoint failover for the selected model. That remains an OpenRouter responsibility under ADR 0022.

This distinction prevents a request from naming an allowed free model while silently falling back to a different paid model.

## Pi provider configuration

Pi supports custom OpenAI Chat Completions-compatible providers through `~/.pi/agent/models.json`.

A minimal gateway provider looks like:

```json
{
  "providers": {
    "sandcastle-gateway": {
      "baseUrl": "http://127.0.0.1:3210/v1",
      "api": "openai-completions",
      "apiKey": "sandcastle-local",
      "headers": {
        "x-sandcastle-run-id": "$SANDCASTLE_RUN_ID",
        "x-sandcastle-task-id": "$SANDCASTLE_TASK_ID",
        "x-sandcastle-attempt-id": "$SANDCASTLE_ATTEMPT_ID"
      },
      "models": [
        {
          "id": "qwen/qwen3-coder:free"
        }
      ]
    }
  }
}
```

The model in Pi configuration must also appear in `SANDCASTLE_GATEWAY_ALLOWED_MODELS`.

Set attribution for a direct Pi test:

```bash
export SANDCASTLE_RUN_ID="smoke-run"
export SANDCASTLE_TASK_ID="smoke-task"
export SANDCASTLE_ATTEMPT_ID="attempt-1"
```

Then invoke Pi using the custom provider and explicit model.

Task 2 has not been merged into this fork, so Sandcastle's existing `pi()` adapter has not yet been wired to generate or select this custom Pi provider automatically. The gateway contract is ready for that integration, but Task 3 does not silently modify the upstream-compatible Pi agent adapter to compensate for the missing phase.

## Telemetry

The default telemetry file is:

```text
.sandcastle/logs/inference-gateway.jsonl
```

Each completed or rejected attributed inference request records fields including:

```text
requestId
runId
taskId
attemptId
requestedModel
servedModel
startedAt
finishedAt
latencyMs
httpStatus
inputTokens
outputTokens
toolSchemaPresent
status
failureType
upstreamRequestId
```

Streaming usage is captured when the upstream SSE stream includes usage data. Pi's OpenAI-compatible streaming mode can request usage in the stream; absence of upstream usage leaves token fields undefined rather than fabricating estimates.

## Budget semantics

The Task 3 budget is process-local.

An allowed upstream attempt consumes the local request budget before the OpenRouter result is known. This is intentional because failed provider calls can consume upstream request quota.

A gateway restart resets the process-local counters. Persisting budget consumption across restarts belongs to the durable-state/runtime-policy phases.

## Failure classifications

The gateway distinguishes:

- `LOCAL_DAILY_BUDGET_EXHAUSTED`
- `LOCAL_RATE_LIMITED`
- `MODEL_NOT_ALLOWED`
- `AUTHENTICATION_FAILED`
- `RATE_LIMITED`
- `MODEL_UNAVAILABLE`
- `CONTEXT_OVERFLOW`
- `INVALID_REQUEST`
- `UPSTREAM_UNAVAILABLE`
- `NETWORK_ERROR`

An OpenRouter 429 is therefore distinct from a local gateway rate-limit rejection.

## Tests

Normal tests use mocked OpenRouter responses and do not consume model quota:

```bash
npm test
npm run typecheck
npm run build
```

The localhost server integration test binds to an ephemeral local port and still uses a mocked upstream `fetch` implementation.

No test in Task 3 requires a real `OPENROUTER_API_KEY`.
