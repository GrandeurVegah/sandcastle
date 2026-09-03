# Architectural Invariants

These invariants define properties the free-model orchestration fork must preserve across implementation phases.

They are stronger than implementation preferences. A later design that violates one requires an explicit ADR explaining why the invariant is being changed.

## I1. Model output is never authoritative state

A model may propose, claim, diagnose, or review. It does not define repository truth, workflow truth, or acceptance truth.

Consequences:

- "tests pass" is not evidence until the engine runs the tests
- `changed_paths` in an agent handoff must be compared with Git
- a completion token such as `<promise>COMPLETE</promise>` is only a process signal
- model confidence must not substitute for executable evidence

## I2. No executable done-check, no autonomous task loop

Every autonomously executed Task Contract must contain credible executable acceptance criteria.

If the desired result cannot be checked deterministically and failure is not cheaply reversible, the task must be interactive, human-gated, or explicitly classified for a different policy.

The Task Graph Compiler must reject structurally autonomous tasks that lack executable acceptance.

## I3. The implementing agent never certifies its own work

Producer and grader are separate roles.

Acceptance authority belongs to:

1. deterministic verification, and
2. explicit human override where policy allows it.

An independent critic may add semantic evidence, but it does not erase deterministic failures.

## I4. Git is authoritative for repository state

The engine derives changed paths, revisions, commits, base SHA, HEAD, and last-known-green revision from Git rather than from natural-language agent reports.

Agent-reported repository facts are claims to compare against observed state.

## I5. Durable workflow state lives outside model context

A run must remain understandable and recoverable without replaying a model conversation.

Long-running state must be persisted independently of:

- ChatGPT conversation state
- Pi session state
- any specific model's context window
- process memory

Agent session persistence is useful attempt evidence, not the primary workflow database.

## I6. Sandcastle remains the bounded execution kernel

Existing Sandcastle responsibilities such as sandbox lifecycle, worktrees, git setup, agent invocation, stream parsing, and session capture remain below the durable orchestration layer.

The fork must not grow planner, scheduler, routing, learning, or durable DAG state directly into `src/Orchestrator.ts` merely because that file already loops over agent iterations.

## I7. Long-horizon retry policy belongs to the control plane

Each Sandcastle execution is treated as a bounded attempt.

The outer runtime owns whether the next action is:

- repair with the same model
- retry with a different model
- reduce context
- re-decompose the task
- invoke a critic
- restore last green
- escalate to a human
- stop because policy is exhausted

Blindly repeating the same provider through a high `maxIterations` value is not the long-running orchestration strategy.

## I8. One active writer per canonical resource

Parallel execution is allowed only when canonical write scopes do not conflict.

The scheduler, not the agents themselves, enforces write ownership through durable resource leases.

Worktree isolation does not remove this requirement because conflicting changes can still collide during integration.

## I9. Hard autonomy limits are deterministic

Request budgets, attempt budgets, wall-time caps, stall limits, concurrency limits, resource ownership, and escalation thresholds are enforced without another model call.

A probabilistic actor cannot decide whether it is allowed to exceed its own hard boundary.

## I10. Every actual inference request must be observable

A coding-agent run may contain multiple inference requests.

The system must therefore meter at the inference boundary rather than inferring request usage from Sandcastle iteration counts.

Every request should eventually be attributable to at least:

- run
- task
- attempt
- requested model
- served model when observable
- timestamp
- outcome/failure class

## I11. Optimisation is based on verified outcomes

Model routing and learning must use independently observed results.

A model does not receive a positive performance signal merely because it says the task is complete.

The primary routing-economic direction is verified progress per scarce request, supported by measures such as:

- verified success rate
- requests to acceptance
- repair success
- schema compliance
- tool-call reliability
- model availability

## I12. Infrastructure failure and semantic failure remain distinct

Failure classification must not conflate unavailable infrastructure with poor coding performance.

Examples:

- HTTP 429 should affect model/provider health and retry policy, not coding-quality score
- unavailable model should trigger rerouting rather than semantic repair
- failing TypeScript produced repeatedly should affect implementation-performance estimates
- sandbox provisioning failure should not be learned as evidence against the selected model

## I13. Semantic model routing and provider routing are separate

The fork selects which model is appropriate for the task.

OpenRouter selects which eligible provider endpoint serves that model according to its routing behaviour and request configuration.

The control plane should not duplicate provider-endpoint routing unless a concrete capability gap is documented.

## I14. The coding-agent harness is replaceable

Pi is the initial coding-agent harness because Sandcastle already supports it and its session lifecycle.

Control-plane contracts must not encode Pi-specific semantics where a generic attempt, session, tool, or inference abstraction is sufficient.

## I15. Typed handoffs are claims with provenance

Planner, implementer, verifier, critic, runtime, and human boundaries must use schema-valid handoffs.

Typed output improves coordination but does not make the content true. Important claims must carry or reference evidence and be checked by the owning authoritative subsystem.

## I16. Protected policy cannot silently self-modify

The Feedback Flywheel and learning subsystems may propose changes to rules, prompts, decomposition heuristics, routing rules, or verification configuration.

They must not silently weaken or replace:

- acceptance policy
- runtime hard limits
- protected path policy
- human-approval requirements
- safety controls

Protected harness changes require an explicit governed update path.

## I17. Recovery inspects before it retries

After interruption, the runtime first reconciles durable state, process state, Git state, worktree state, and deterministic verification evidence.

It must not spend another scarce inference request simply because the previous orchestrator process disappeared.

## I18. State transitions are explicit and inspectable

Important run, task, attempt, verification, routing, resource, and human-action transitions must be persisted as events or equivalent durable evidence.

There must be no correctness-critical workflow state that exists only as an unlogged in-memory branch.

## I19. Parallelism is earned by independence

A task is parallelizable only when both are true:

1. its dependency constraints allow it, and
2. its canonical write resources do not conflict with active work.

Maximising worker count is not a goal by itself.

## I20. Upstream compatibility is a design constraint

Fork-specific control-plane functionality should be added behind modular boundaries rather than by pervasive edits to Sandcastle kernel files.

When a new kernel capability is required, prefer:

1. an adapter around existing behaviour
2. a narrow upstream-compatible interface extension
3. a documented kernel change

in that order.

## Invariant hierarchy

When implementation tradeoffs conflict, prefer in this order:

1. acceptance correctness and protected policy
2. durable recoverability
3. resource and budget safety
4. evidence quality and observability
5. upstream compatibility
6. throughput and parallelism
7. convenience of implementation

This ordering prevents request efficiency or implementation speed from weakening the mechanisms that make unreliable-model orchestration trustworthy.
