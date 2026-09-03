# OpenRouter is an inference backend, not the workflow engine

## Context

The fork is designed around free models accessed through OpenRouter. OpenRouter provides a unified inference API, access to multiple model families, provider-endpoint routing, and model/provider availability behaviour.

However, an inference provider is not equivalent to a coding-agent runtime or a durable orchestration engine.

Sandcastle's `AgentProvider` abstraction is built around coding-agent CLIs that can participate in repository workflows: build a command, receive a prompt, stream text and tool events, and in some cases persist/resume an agent session. Sandcastle already includes Pi support, including Pi stream parsing and filesystem-backed session transfer.

A raw OpenRouter model endpoint does not itself provide the local repository read/edit/bash loop required to act as a coding agent. It also does not own this fork's durable task graph, request budgets, task acceptance, resource leases, crash recovery, or verified workload learning.

There are also two distinct routing questions:

1. **Semantic model routing:** which model should handle this task attempt?
2. **Provider-endpoint routing:** which available provider endpoint should serve the selected model?

The fork needs to learn and control the first from its own verified workload. OpenRouter is well positioned to own the second.

## Decision

OpenRouter will be treated as an **inference backend**.

The durable control plane owns:

- discovery and policy over allowed models
- semantic model selection for a task attempt
- task/model performance history
- request and run budgets
- model-health signals relevant to semantic routing
- failure classification at the workflow level
- verified progress per request optimisation

OpenRouter owns:

- inference API delivery
- provider-endpoint selection and failover according to OpenRouter request/routing configuration
- provider availability behind a selected model

A coding-agent harness remains between Sandcastle and the inference API. Pi is the initial intended harness because Sandcastle already supports it, but the architecture must keep that choice replaceable.

The initial conceptual path is:

```text
Durable control plane
       |
       v
Sandcastle bounded execution
       |
       v
Pi coding-agent harness
       |
       v
Local inference gateway
       |
       v
OpenRouter
       |
       v
Selected explicit free model
```

A local inference gateway will later be introduced so every actual model request can be observed, tagged, metered, and constrained independently of Sandcastle iteration counts.

The system should prefer explicit free model IDs for controlled routing and attribution. An aggregate free-model router may be useful for exploration or low-criticality fallback, but it must not replace the fork's semantic routing and learning layer.

## Consequences

- OpenRouter integration does not require turning OpenRouter into an `AgentProvider` if a coding-agent harness such as Pi remains the actual repository-operating agent.
- The control plane can compare models by verified outcomes rather than losing attribution behind opaque model selection.
- Provider-level delivery behaviour remains delegated instead of being redundantly implemented in the scheduler.
- A Sandcastle run cannot be used as the request-budget unit because the coding-agent harness may issue multiple inference calls during one run.
- Task 2 should prove the smallest Sandcastle -> Pi -> OpenRouter -> explicit free-model path.
- Task 3 should add the local inference gateway and immutable per-request telemetry before sophisticated routing is implemented.
- Pi-specific integration must remain behind replaceable coding-agent interfaces so another harness can be introduced later.

## Considered Options

1. **Treat OpenRouter as the coding agent** - rejected. An inference API does not itself provide Sandcastle's expected repository tool loop.
2. **Treat OpenRouter's free-model router as the complete semantic router** - rejected as the primary strategy. It weakens reproducibility, attribution, model-specific learning, and workload-based optimisation.
3. **Reimplement provider-endpoint routing in the fork** - rejected. This duplicates a responsibility OpenRouter already provides and couples scheduling to inference-provider details.
4. **Split semantic routing from provider routing** - chosen. The fork chooses the model from verified task evidence; OpenRouter serves that selected model through an eligible endpoint.

## Architectural rule

The fork's router answers:

```text
Which model should attempt this task?
```

OpenRouter answers:

```text
Which eligible endpoint should serve that model request?
```

These responsibilities remain separate unless superseded by a later ADR.
