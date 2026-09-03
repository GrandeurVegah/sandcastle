# Product Thesis: Reliable Orchestration Over Unreliable Models

## Purpose

This fork turns Sandcastle from an agent execution toolkit into the execution foundation for a local-first, long-horizon coding-agent orchestration system designed for heterogeneous, quota-constrained, replaceable inference models accessed through OpenRouter.

The product is not "Sandcastle with OpenRouter support." Its purpose is to make verified software progress continue even when individual model calls are unreliable, models disappear, quotas are exhausted, agent sessions are lost, or a machine process restarts.

## Product thesis

> Build a durable local control plane over Sandcastle that maximises verified software progress per scarce inference request while assuming models are probabilistic, heterogeneous, rate-limited, replaceable, and sometimes unavailable.

System reliability must come from the harness, not from trusting any individual model.

## Economic unit

For paid frontier models, token cost is often the obvious scarce resource. For free-model orchestration, the binding constraints can instead be request quotas, rate limits, model availability, latency, tool-call reliability, and the number of attempts required to reach a verified result.

The primary economic objective is therefore **Verified Progress per Request (VPPR)** rather than raw token minimisation.

A useful conceptual form is:

```text
VPPR(model, task) =
  probability(task reaches verified acceptance | model, task)
  * task value
  / expected model requests to acceptance
```

Latency, context pressure, infrastructure cost, and critical-path importance may later be incorporated as penalties or weights. The initial architecture must preserve enough telemetry to estimate this metric empirically.

## Reliability model

The system assumes:

1. Model output is a claim, not evidence.
2. A coding agent may consume multiple inference requests inside one apparent agent run.
3. An agent completion signal is a process signal, not proof of correctness.
4. Git is authoritative for repository state.
5. Deterministic acceptance checks are authoritative for executable correctness claims.
6. Durable orchestration state must exist outside model context and outside any single agent session.
7. Retry, rerouting, repair, and escalation belong to the control plane that owns budgets and workflow state.
8. Parallel work is safe only when canonical write ownership is explicit.

## Architectural stance

The system has three distinct conceptual layers.

### 1. Durable orchestration control plane

Owns long-horizon intent and state:

- Task Contracts
- planner
- task graph compiler
- durable DAG execution
- scheduler and resource leases
- runtime policy and budgets
- semantic model routing
- deterministic verification
- independent critic
- crash recovery
- event telemetry
- learning and routing feedback

This layer is authoritative for workflow state.

### 2. Sandcastle execution kernel

Owns bounded execution mechanics:

- sandbox lifecycle
- worktree lifecycle
- git integration
- agent process invocation
- agent-provider adapters
- stream parsing
- session capture and resume where supported
- execution logs and low-level events

A future control-plane attempt should invoke this kernel as a bounded unit of execution rather than extending `src/Orchestrator.ts` into the durable workflow engine.

### 3. Coding-agent and inference layer

A coding-agent harness, initially Pi, provides the local read/edit/bash/tool loop. OpenRouter provides inference access and provider-level delivery. Neither owns the durable workflow.

Initial intended path:

```text
Durable control plane
        |
        v
Sandcastle execution kernel
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
Explicit free models
```

Pi is an initial implementation choice, not a permanent architectural dependency.

## Pattern-to-product mapping

The `GrandeurVegah/ai-development-patterns` repository is treated as a normative design input for the control plane.

| Development pattern | Product subsystem | Architectural responsibility |
|---|---|---|
| Spec-Driven Development | Task Contracts | Machine-valid objective, inputs, writable resources, executable acceptance, stop conditions, and expected output |
| Planned Implementation | Planner | Propose implementation strategy and candidate tasks without executing them |
| Atomic Decomposition | Task Graph Compiler | Convert plans into bounded, dependency-aware, independently verifiable nodes |
| Parallel Agents | Scheduler | Run independent ready nodes concurrently in isolated worktrees subject to resource ownership |
| Agent Memory | Persistent State | Preserve run, task, attempt, artifact, and recovery state outside model context |
| Model Routing | Model Router | Select a semantic model using capability, health, history, quota, and expected verified progress |
| Adversarial Evaluator | Independent Critic | Provide independent probabilistic review without merge or acceptance authority |
| Agent Observability | Event Telemetry | Record inference, tool, attempt, verification, retry, commit, and state-transition evidence |
| Bounded Autonomy | Runtime Policy Engine | Enforce request, attempt, time, stall, divergence, concurrency, and escalation limits |
| Feedback Flywheel | Learning System | Convert verified model performance and recurring corrections into reviewed routing or harness improvements |
| Workflow Orchestration | DAG Execution | Coordinate explicit sequential, parallel, and human-gated workflow stages |
| Long-Running Orchestration | Durable Run State | Survive process, session, provider, and machine interruptions with recoverable checkpoints |
| Handoff Protocols | Typed Agent Outputs | Define schema-valid returns between planner, implementer, verifier, critic, runtime, and human |

## Non-goals

The initial product is not intended to:

- build a new general-purpose LLM API aggregator
- duplicate OpenRouter's provider-endpoint routing
- make a model its own verifier
- infer correctness from natural-language confidence
- treat a long model conversation as durable state
- maximise parallelism without resource ownership
- silently rewrite protected acceptance or runtime policy through self-learning
- replace Sandcastle's working sandbox, worktree, git, or session machinery without demonstrated need

## Product success criteria

The architecture succeeds when the following becomes normal rather than exceptional:

- a model disappears mid-run and work is rerouted without losing workflow state
- an agent claims completion but failing deterministic checks prevent acceptance
- a process crashes and the run resumes from durable state without blindly repeating model calls
- independent tasks execute concurrently without two writers mutating the same canonical resource
- retries change model, context, repair strategy, or decomposition based on classified evidence rather than repeating the same failed call indefinitely
- model routing improves from verified outcomes collected on the user's real workload
- the system can explain exactly where scarce inference requests were spent and what verified progress they produced

## Core product invariant

> Reliability is produced by contracts, deterministic verification, durable external state, bounded policy, and evidence-driven recovery. It is never produced by assuming the model is reliable.
