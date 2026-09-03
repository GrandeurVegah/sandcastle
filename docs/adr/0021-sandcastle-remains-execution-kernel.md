# Sandcastle remains the execution kernel beneath a durable control plane

## Context

The fork is intended to support long-horizon coding workflows over heterogeneous, unreliable, quota-constrained models. That requires capabilities beyond Sandcastle's current execution loop, including durable run state, task contracts, DAG scheduling, resource ownership, model routing, request budgets, failure classification, independent verification, recovery, and learning.

Sandcastle already contains mature execution mechanics that the fork should preserve: sandbox lifecycle, worktrees, git setup and synchronization, agent-provider adapters, process invocation, stream parsing, abort/timeout handling, and session capture/resume where supported.

`src/Orchestrator.ts` currently coordinates one configured `AgentProvider` through a configured number of iterations inside Sandcastle's sandbox lifecycle. Its output includes execution results such as commits, stdout, branch, iteration/session information, and preserved-worktree information.

There is a temptation to make this existing orchestrator own the new durable workflow simply because it already contains a loop. Doing so would mix two different responsibilities:

1. bounded execution of an agent in a repository environment
2. durable policy and workflow coordination across tasks, attempts, models, failures, restarts, and human gates

Existing Sandcastle design already points toward keeping retry policy at the higher layer. ADR 0020 states that retry belongs at the layer that owns parallelism rather than inside prompt expansion, and adds typed diagnostics so a downstream orchestrator can decide what to do.

The `ai-development-patterns` Loop Engineering and Long-Running Orchestration guidance reinforces the same boundary: keep state outside model context, require executable done-checks, let deterministic checks arbitrate, bound autonomous loops, and recover from durable known-good state.

## Decision

Sandcastle will remain the **execution kernel**.

A new **durable orchestration control plane** will be introduced above it.

The execution kernel owns bounded mechanics such as:

- sandbox provisioning and lifecycle
- worktree creation and lifecycle
- git setup, synchronization, and commit observation
- coding-agent process invocation
- `AgentProvider` adapters
- stream parsing and low-level execution events
- prompt preprocessing
- timeout and abort mechanics
- coding-agent session capture/resume where supported

The control plane owns long-horizon policy such as:

- Task Contracts
- planning and deterministic task-graph compilation
- DAG execution state
- scheduling and resource leases
- request, attempt, time, and concurrency budgets
- semantic model routing
- deterministic verification
- critic policy
- retry, repair, rerouting, and escalation decisions
- crash reconciliation and last-known-green recovery
- durable event/state persistence
- model-performance and harness-learning feedback

A Sandcastle execution will eventually be treated as a **bounded attempt** within a task's outer lifecycle.

`src/Orchestrator.ts` will not become the durable DAG state machine.

Where the control plane requires additional evidence from the kernel, prefer a narrow adapter or upstream-compatible interface extension over embedding workflow concepts into kernel modules.

## Consequences

- Existing Sandcastle kernel code can remain close to upstream, reducing long-term merge cost.
- The fork can change planner, scheduler, policy, routing, persistence, and learning behaviour without destabilising sandbox/worktree execution.
- `maxIterations` remains useful as a bounded kernel mechanism but is not the primary long-horizon retry strategy.
- The outer runtime can vary model, context, repair mode, decomposition, critic use, or escalation between attempts.
- Session state remains useful attempt context but is not promoted into durable workflow truth.
- Task 1 must create an explicit dependency boundary so kernel modules cannot import control-plane planner, scheduler, router, learning, or durable-run modules.

## Considered Options

1. **Expand `src/Orchestrator.ts` into the complete durable workflow engine** - rejected. It would conflate bounded execution with long-horizon policy, increase upstream divergence, and make crash recovery and model routing harder to reason about.
2. **Replace Sandcastle with a new orchestration runtime** - rejected. Sandcastle already provides valuable sandbox, worktree, git, agent-provider, session, and event primitives. Rebuilding them would add risk without differentiating the product.
3. **Keep all new functionality in user templates** - rejected. Templates are suitable for example workflows but do not provide a durable shared control plane with enforceable state, budgets, recovery, and resource ownership.
4. **Add a durable control plane above Sandcastle** - chosen. It preserves the kernel while placing policy at the layer that owns the necessary state and evidence.

## Architectural rule

The intended dependency direction is:

```text
control plane
    |
    v
execution-kernel adapter
    |
    v
Sandcastle kernel
```

The inverse dependency is forbidden unless superseded by a later ADR.
