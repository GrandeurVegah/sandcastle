# Control-plane namespace and bounded execution kernel port

## Context

ADR 0021 establishes Sandcastle as the execution kernel beneath a durable orchestration control plane. Task 1 needs to turn that architectural direction into a concrete code boundary without moving mature Sandcastle files or making the fork difficult to rebase onto upstream.

The current public `run()` API already represents the highest-level bounded Sandcastle execution surface. It resolves repository and prompt configuration, configures sandbox/worktree lifecycle, invokes `orchestrate()`, and returns execution evidence including iterations, stdout, commits, branch, log path, preserved worktree path, and captured session metadata.

The new control plane needs a stable internal seam to invoke this capability while retaining ownership of long-horizon retry, routing, scheduling, verification, and recovery policy.

## Decision

All fork-specific durable orchestration code will live beneath:

```text
src/control-plane/**
```

Existing Sandcastle source outside that namespace is treated as execution-kernel code unless a later ADR explicitly reclassifies it.

The control plane receives an internal attempt-level port:

```ts
interface ExecutionKernel {
  executeAttempt(input: ExecutionAttemptInput): Promise<ExecutionAttemptResult>;
}
```

The initial `SandcastleExecutionKernel` adapter delegates to the existing `run()` implementation.

Each control-plane attempt is forced to exactly one Sandcastle iteration. The `maxIterations` option is therefore omitted from `ExecutionAttemptInput` and set to `1` by the adapter.

The port deliberately does not expose Sandcastle's `RunResult.resume` and `RunResult.fork` convenience closures. Captured session identifiers remain available in iteration evidence, but a future durable runtime must explicitly decide whether a later attempt resumes, reroutes, forks, or starts fresh.

Structured-output and session-forking controls are not included in the initial attempt input. Their semantics belong to later typed-handoff and orchestration phases and should be added only when their ownership is clear.

The boundary is internal. Task 1 does not add a new package-root export or commit the upstream Sandcastle public API to the control-plane design.

A Vitest architecture test mechanically enforces dependency direction. It parses TypeScript source files outside `src/control-plane/**` and fails if a kernel source file imports a relative module that resolves inside the control-plane namespace.

## Consequences

- Existing Sandcastle files do not need to move into a new `kernel/` directory, minimizing upstream merge churn.
- The durable control plane can depend on the kernel through one explicit attempt-level seam.
- Kernel code cannot acquire planner, scheduler, router, learning, or durable-run dependencies through the control-plane namespace without failing tests.
- Long-horizon retry behaviour cannot accidentally be implemented by increasing `maxIterations` through this port.
- Session IDs remain evidence, while session continuation remains a policy decision for later phases.
- Task 2 can prove OpenRouter execution through the existing Sandcastle/Pi path while using the internal bounded-attempt adapter where appropriate.
- Task 4 may extend the port for typed handoff output once the Task Contract and handoff ownership model is implemented.

## Considered options

1. **Move existing Sandcastle files under `src/kernel/`** - rejected. The filesystem purity is not worth the upstream merge cost and churn across mature modules.
2. **Have the control plane call `run()` directly everywhere** - rejected. It provides no explicit ownership seam and makes it easy for higher-level policy to depend on convenience behaviours such as multi-iteration runs or result closures.
3. **Build a new low-level execution runtime beside `run()`** - rejected. It would duplicate existing Sandcastle lifecycle behaviour and create two execution paths to maintain.
4. **Add an internal one-iteration adapter above `run()` and mechanically enforce reverse-dependency rules** - chosen.

## Architectural rule

```text
src/control-plane/**
        |
        v
ExecutionKernel
        |
        v
Sandcastle run()/execution kernel
```

Source outside `src/control-plane/**` must not import back into `src/control-plane/**`.
