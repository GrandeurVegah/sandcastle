# Local inference gateway is the request-accounting boundary

## Context

ADR 0022 establishes OpenRouter as the inference backend rather than the workflow engine. ADR 0023 establishes a bounded Sandcastle execution port for the durable control plane.

Those two boundaries leave one important accounting problem: a single coding-agent attempt can issue multiple model requests internally. Counting Sandcastle runs or iterations therefore cannot enforce scarce OpenRouter request budgets or provide model-level telemetry.

The initial coding-agent harness is Pi. Pi supports custom OpenAI Chat Completions-compatible providers, so a localhost OpenAI-compatible proxy can sit below Pi without changing the Sandcastle execution kernel.

Task 3 also precedes the durable SQLite state and runtime-policy phases. The gateway needs hard process-local controls and observable request evidence now without prematurely becoming the durable workflow database.

## Decision

Introduce `src/control-plane/inference-gateway/**` as the inference request-accounting boundary.

The gateway exposes the minimum OpenAI-compatible surface required for Pi integration:

```text
GET  /healthz
GET  /v1/models
POST /v1/chat/completions
```

`POST /v1/chat/completions` supports streaming SSE pass-through.

Every attributed inference request must include:

```text
x-sandcastle-run-id
x-sandcastle-task-id
x-sandcastle-attempt-id
```

The gateway generates an independent request ID and records immutable request telemetry through a sink interface.

The gateway owns:

- per-request IDs
- run/task/attempt attribution
- explicit free-model allowlisting
- process-local daily request limits
- process-local rolling per-minute rate limits
- requested model capture
- served model capture when returned upstream
- latency
- input/output usage when returned upstream
- tool-schema presence
- HTTP status
- gateway/upstream failure classification
- forwarding OpenRouter authentication from gateway-owned configuration

The gateway does not own:

- semantic model selection
- provider-endpoint routing
- task retries
- attempt retries
- durable task/run state
- persistent cross-restart budgets
- task acceptance

OpenRouter provider routing remains delegated to OpenRouter.

Only explicit allowlisted model IDs ending in `:free` may pass the Task 3 gateway. This prevents accidental paid-model fallback at the local policy boundary.

An allowed upstream attempt consumes the local request budget before the result is known. The counter is not refunded on upstream failure because failed inference attempts may still consume provider request quota.

Task 3 uses an in-memory budget guard plus append-only JSONL telemetry. Durable counters and reconciliation across process restarts belong to the later durable-state and runtime-policy phases.

Telemetry write failures are not intentionally swallowed. In streaming mode the client stream does not close successfully until final request telemetry has been recorded.

## Consequences

- One Sandcastle attempt may now be measured as multiple actual inference requests.
- Future runtime policy can enforce request budgets using gateway evidence rather than estimating from agent iterations.
- Future routing can learn from requested model, served model, availability, and verified downstream outcomes.
- A gateway restart resets Task 3's in-memory counters; later durable state must reconcile this limitation.
- The coding-agent harness can remain replaceable as long as it can target the local OpenAI-compatible surface or an equivalent adapter.
- The existing Sandcastle `pi()` provider is not modified in Task 3 to compensate for the missing Task 2 integration. Pi-to-gateway provider selection remains an explicit integration task.

## Considered options

1. **Count Sandcastle runs as inference requests** - rejected. A coding-agent run can contain multiple model calls.
2. **Put request accounting inside `src/Orchestrator.ts`** - rejected. The orchestrator cannot reliably observe individual inference calls made inside the coding-agent process and this would violate the kernel/control-plane boundary.
3. **Rely only on OpenRouter account limits** - rejected. The fork requires per-run/task/attempt attribution and local hard budgets before requests leave the machine.
4. **Introduce the full durable database in Task 3** - rejected. Durable workflow state is a separate phase and should not be coupled prematurely to the proxy implementation.
5. **Use a local OpenAI-compatible gateway with process-local enforcement and append-only telemetry** - chosen.

## Architectural rule

```text
coding-agent harness
        |
        v
local inference gateway  <-- authoritative actual-request accounting
        |
        v
OpenRouter               <-- provider-endpoint routing
        |
        v
explicit allowed :free model
```

A higher layer may decide which model to request. It must not bypass the gateway when request-budget enforcement is required.
