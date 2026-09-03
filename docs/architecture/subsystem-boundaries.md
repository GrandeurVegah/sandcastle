# Subsystem Boundaries

## Purpose

This document defines which responsibilities remain in the Sandcastle execution kernel and which belong to the new durable orchestration control plane.

The boundary exists for two reasons:

1. Preserve Sandcastle's proven sandbox, worktree, git, agent-process, and session machinery.
2. Keep future upstream Sandcastle changes reasonably mergeable by preventing fork-specific workflow policy from spreading through kernel files.

## Boundary rule

> The execution kernel answers "run this bounded agent attempt safely in an isolated repository environment." The control plane answers "what work should run, when, with which model, under which budget, how it is verified, and what happens next."

## Existing Sandcastle modules that should remain close to upstream

The following modules are kernel concerns unless a later ADR demonstrates otherwise.

| Existing area | Kernel responsibility | Fork guidance |
|---|---|---|
| `src/run.ts` | Public bounded run entry point and execution configuration | Preserve existing API where practical; adapt from the control plane rather than embedding workflow state |
| `src/Orchestrator.ts` | Execute configured agent iterations inside sandbox/worktree lifecycle | Treat as bounded execution machinery; do not make it the durable DAG engine |
| `src/AgentProvider.ts` | Coding-agent CLI adapters, command construction, stream parsing, session support | Extend only for agent-runtime integration needs, not semantic model routing policy |
| `src/SandboxFactory.ts` | Provision sandbox execution environment | Preserve |
| `src/SandboxLifecycle.ts` | Setup, git lifecycle, hooks, apply/sync behaviour | Preserve |
| `src/SandboxProvider.ts` and `src/sandboxes/**` | Provider abstraction and concrete sandbox implementations | Preserve |
| `src/WorktreeManager.ts` | Local worktree mechanics | Preserve; scheduler-level resource ownership lives above it |
| `src/SessionStore.ts` | Coding-agent session transfer/capture mechanics | Preserve; durable run state is a separate control-plane concern |
| `src/AgentStreamEmitter.ts` | Low-level agent stream events | Preserve and adapt into higher-level telemetry |
| `src/PromptPreprocessor.ts` | Deterministic prompt expansion within an execution attempt | Preserve |
| `src/createSandbox.ts` | Reusable sandbox handle | Preserve |
| `src/createWorktree.ts` | Reusable worktree handle | Preserve |
| `src/syncIn.ts`, `src/syncOut.ts` | Repository synchronization mechanics | Preserve |
| `src/errors.ts`, `src/ErrorHandler.ts` | Kernel-level typed execution failures and presentation | Preserve; control plane later maps these to workflow failure classes |

These modules may expose new ports or evidence required by the control plane, but workflow policy must not migrate into them merely for convenience.

## New control-plane subsystems

The fork introduces new responsibilities above the kernel.

| Subsystem | Owns | Must not own |
|---|---|---|
| Contracts | Task, graph, handoff, verification, event, and policy schemas | Runtime execution |
| Planner | Probabilistic decomposition proposal | Scheduling or acceptance |
| Task Graph Compiler | Deterministic graph validation and canonicalization | Model-driven repair |
| Durable Run Engine | Run/task/attempt state machine and recovery coordination | Sandbox implementation |
| Scheduler | Dependency readiness, concurrency, resource leases | Git worktree implementation |
| Runtime Policy | Budgets, caps, escalation thresholds | Probabilistic reasoning about correctness |
| Model Router | Semantic model selection | OpenRouter endpoint routing |
| Inference Gateway | Per-request accounting, rate/quota enforcement, inference telemetry | Coding-agent workflow state |
| Verification Engine | Independent deterministic acceptance evidence | Code generation |
| Critic | Independent semantic findings | Deterministic acceptance or merge authority |
| Persistent State | Durable orchestration metadata | Source-control truth |
| Telemetry | Workflow, inference, verification, and policy event history | Hidden state transitions |
| Learning | Evidence-based routing estimates and proposed harness improvements | Silent mutation of protected policy |

## Boundary between Sandcastle and the control plane

The eventual integration should converge on an explicit attempt-level port conceptually similar to:

```ts
interface ExecutionKernel {
  executeAttempt(input: ExecutionAttemptInput): Promise<ExecutionAttemptResult>;
}
```

This is illustrative, not a Task 0 public API commitment.

The control plane should supply bounded execution intent such as:

- repository/worktree target
- coding-agent provider
- prompt/context payload
- environment references
- timeouts
- abort signal
- session-resume information if policy permits

The kernel should return observed execution evidence such as:

- branch/worktree identity
- commits
- stdout/event stream references
- session ID where available
- process/execution failure
- preserved worktree where applicable

The control plane then independently inspects Git and runs acceptance checks.

## Boundary between coding agent and inference provider

A coding agent and an inference provider are separate abstractions.

### Coding-agent harness

Examples: Pi, Claude Code, Codex, OpenCode.

Owns:

- conversation/tool loop
- file reads
- file writes
- shell commands
- local context handling
- tool invocation protocol

### Inference provider

Initial provider: OpenRouter.

Owns:

- model API access
- provider-endpoint availability
- provider-level routing/failover according to OpenRouter policy
- inference response delivery

OpenRouter does not replace the coding-agent harness because an inference API does not itself provide the repository read/edit/bash loop expected by Sandcastle's `AgentProvider` abstraction.

## Boundary between semantic routing and provider routing

The fork owns **semantic model routing**:

```text
Which model should handle this task attempt?
```

OpenRouter owns **provider-endpoint routing**:

```text
Which eligible inference endpoint should serve the selected model?
```

The scheduler and semantic router must not reproduce provider-level failover already delegated to OpenRouter.

## Boundary between agent output and verification

Agent output may contain claims such as:

- completion signal emitted
- tests passed
- changed paths
- commit created
- issue resolved

These claims are not authoritative.

The engine must determine independently:

- actual changed paths from Git
- actual commits from Git
- actual dirty state
- actual acceptance-command exit codes
- actual test/typecheck/lint results

The implementing agent is a producer, never the final grader.

## Boundary between session state and durable run state

Sandcastle session capture exists to preserve coding-agent conversation state where supported.

Durable orchestration state is broader and cannot depend on session persistence.

A run must remain recoverable if:

- the coding-agent session cannot be resumed
- the model disappears
- the model provider changes
- the process crashes
- the machine restarts

Therefore:

```text
agent session state != workflow state
```

Agent session IDs are evidence attached to an attempt, not the primary run database.

## Boundary between scheduler locks and worktrees

Worktrees provide filesystem/git isolation. They do not by themselves establish logical ownership of canonical resources.

The scheduler must determine resource conflicts before launching writers. Worktree mechanics remain in the kernel.

Example:

```text
Task A writes src/auth/**
Task B writes src/billing/**
Task C writes package.json + package-lock.json
```

A and B may be scheduled concurrently if their dependencies permit. C must be serialized against any task whose declared canonical write scope conflicts.

## Boundary between deterministic policy and probabilistic reasoning

The following must be deterministic:

- request budget exhausted?
- attempt budget exhausted?
- wall-time exceeded?
- dependency passed?
- resource lease available?
- protected path touched?
- acceptance command passed?
- task contract structurally valid?

Models may advise on:

- implementation strategy
- decomposition proposal
- semantic failure diagnosis
- code generation
- review findings

A model call must never be required to determine whether a hard autonomy limit has already been breached.

## Dependency rules

The intended direction is one-way:

```text
control-plane application layer
        |
        v
control-plane ports/contracts
        |
        v
kernel adapter
        |
        v
Sandcastle kernel
```

Forbidden direction:

```text
Sandcastle kernel
        X
        |
planner / scheduler / model router / learning / durable run engine
```

Task 1 should turn this documented rule into a mechanically enforceable dependency boundary.
