# System Architecture

## Architectural objective

The fork introduces a durable orchestration control plane above Sandcastle while preserving Sandcastle as the execution kernel for bounded agent work.

The system is designed for long-running coding workflows where inference models are heterogeneous, probabilistic, quota-constrained, replaceable, and intermittently unavailable.

## High-level architecture

```text
User specification
      |
      v
Task Contract Compiler
      |
      v
Planner
      |
      v
Task Graph Compiler
      |
      v
Durable Run Engine
  |       |        |        |
  |       |        |        +--> Runtime Policy
  |       |        +-----------> Resource Leases
  |       +--------------------> Scheduler
  +----------------------------> Checkpoints / Recovery
      |
      v
Semantic Model Router
      |
      v
Local Inference Gateway
      |
      v
OpenRouter
      |
      v
Explicit free model

In parallel with the model path:

Durable Run Engine
      |
      v
Sandcastle Execution Kernel
      |
      v
Coding-Agent Harness (initially Pi)
      |
      +--> repository read/edit/bash/tool loop
      |
      v
Isolated sandbox + worktree + Git
      |
      v
Deterministic Verification
      |
      +--> Independent Critic when policy requires
      |
      v
Durable task result + event stream
```

## Authority model

The architecture deliberately separates probabilistic actors from authoritative state.

| Concern | Authoritative source |
|---|---|
| Repository contents | Git and the filesystem |
| Changed paths | Git diff, not agent claims |
| Commit identity | Git |
| Executable acceptance | Engine-run deterministic checks |
| Run/task/attempt state | Durable orchestration store |
| Request budget consumption | Inference gateway request ledger |
| Workflow dependency satisfaction | Durable task graph state |
| Resource ownership | Scheduler leases |
| Model recommendation | Router policy and empirical statistics |
| Semantic review | Critic output is advisory or policy-gated, never self-authoritative |
| Human approval | Explicit human action recorded by the runtime |

## Major subsystems

### Task Contract Compiler

Transforms a user specification or planner proposal into a machine-valid contract.

A Task Contract is expected to define:

- identity and objective
- dependencies
- required and optional context
- read, write, and protected resources
- task class and required model capabilities
- executable acceptance commands
- runtime limits
- expected typed output

The compiler must reject autonomous execution when no credible executable done-check exists.

### Planner

Uses a model to propose an implementation strategy and candidate tasks. Planner output is probabilistic and must pass deterministic graph compilation before execution.

The planner does not directly schedule work, mutate repository files, or certify that its own plan is executable.

### Task Graph Compiler

Converts planner output into the canonical executable DAG. It validates identities, dependencies, acyclicity, acceptance coverage, resource declarations, protected resources, and policy structure.

The compiled Task Graph, not raw planner prose, becomes the workflow input to the durable run engine.

### Durable Run Engine

Owns long-running workflow state and state transitions.

Expected responsibilities:

- run lifecycle
- task lifecycle
- attempt lifecycle
- checkpointing
- retry and repair coordination
- deterministic transition rules
- human escalation
- crash reconciliation
- last-known-green tracking
- durable event emission

The run engine invokes Sandcastle for bounded attempts. Sandcastle does not become the durable run engine.

### Scheduler

Evaluates which DAG nodes are eligible to run.

A task may become ready only when:

- all dependencies have passed
- required resources are available
- policy permits another attempt
- required execution capabilities are available

The scheduler owns concurrency and resource leasing.

### Resource Lease Manager

Canonicalizes writable resources and enforces one active writer per canonical resource.

Example logical keys may include:

```text
file:src/auth/**
file:package.json
global:database-schema
global:dependency-graph
```

Parallelism is therefore dependency-aware and resource-aware.

### Runtime Policy Engine

Enforces bounded autonomy deterministically.

Expected controls include:

- requests per task
- requests per run
- attempts per task
- wall-clock duration
- consecutive stalls
- semantic failure limits
- concurrency
- critic requirements
- human approval thresholds

Hard budget decisions must not require another model call.

### Semantic Model Router

Chooses which model should handle a task attempt.

It may use:

- task class
- language and framework
- context requirements
- tool-call requirements
- structured-output requirements
- model availability
- recent 429s or failures
- verified historical success
- schema compliance
- repair success
- expected requests to acceptance
- remaining quota

This router owns semantic model choice only.

### Local Inference Gateway

Sits between the coding-agent harness and OpenRouter so every actual inference request is observable and budgetable.

Expected responsibilities:

- request IDs
- run/task/attempt tagging
- requested and served model capture
- request counting
- rate and quota enforcement
- latency and usage telemetry
- error classification
- free-model allowlisting

A Sandcastle run is not assumed to equal one model request.

### OpenRouter

Provides inference access and provider-endpoint routing.

The fork should not duplicate provider-level failover that OpenRouter already owns. The control plane selects the semantic model; OpenRouter determines which eligible endpoint serves that model.

### Coding-Agent Harness

Initially Pi.

Owns the local model/tool loop needed to read files, edit files, invoke shell commands, and interact with the repository.

The coding-agent harness is replaceable. It must not own durable workflow truth.

### Sandcastle Execution Kernel

Owns bounded execution mechanics already implemented by Sandcastle:

- sandbox provisioning and lifecycle
- worktree creation and lifecycle
- git setup and application
- agent process execution
- agent-provider adapters
- stream parsing
- session capture/resume where supported
- low-level execution events
- abort and timeout mechanics

The control plane calls the kernel for one bounded attempt with an explicit scope and policy.

### Deterministic Verification Engine

Runs acceptance checks independently after an attempt.

Expected evidence includes:

- actual git diff
- actual commits
- dirty state
- acceptance command exit codes
- test output
- type-check output
- lint output
- deterministic invariant results

Only this subsystem, or an explicit human override path, may move a task into an accepted state.

### Independent Critic

Performs semantic review independently of the implementing agent when runtime policy requires it.

The critic can produce findings but cannot mutate implementation files, merge code, or make deterministic checks disappear.

Critic use should be risk-based because every critic invocation consumes scarce inference requests.

### Persistent State

The intended truth split is:

- source code and revisions: Git
- orchestration metadata: embedded durable database, initially expected to be SQLite
- large evidence and context artifacts: filesystem artifacts referenced from durable state

Persistent state must survive process restarts and model-session loss.

### Event Telemetry

Records significant system activity so runs are inspectable and replayable.

Expected event families include:

- run transitions
- task transitions
- attempt transitions
- model requests
- tool calls
- agent process lifecycle
- verification outcomes
- critic outcomes
- retries
- routing decisions
- commits
- resource leases
- human actions

### Learning System

Consumes verified outcomes rather than unverified self-reports.

Two feedback loops are distinct:

1. Model learning: improve routing estimates by task class and workload.
2. Harness learning: identify recurring corrections or missing controls and propose reviewed changes to rules, prompts, verification, decomposition, or routing policy.

The learning system must not silently weaken protected acceptance, runtime, or safety policy.

## Attempt lifecycle

The target outer-loop abstraction is:

```text
Task
  |
  v
Attempt 1
  -> select model
  -> run bounded Sandcastle execution
  -> inspect Git
  -> run deterministic verification
  -> classify result
       |
       +--> pass
       |
       +--> repair with same model if policy permits
       |
       +--> retry with different model
       |
       +--> reduce context / re-decompose
       |
       +--> critic diagnosis
       |
       +--> human escalation
```

This is intentionally different from blindly repeating the same provider through `maxIterations`.

## Failure taxonomy direction

The control plane should eventually distinguish at least:

- RATE_LIMITED
- MODEL_UNAVAILABLE
- CONTEXT_OVERFLOW
- INVALID_TOOL_CALL
- INVALID_HANDOFF
- AGENT_STALLED
- VERIFICATION_FAILED
- RESOURCE_CONFLICT
- REPEATED_SEMANTIC_FAILURE
- POLICY_EXHAUSTED
- INFRA_FAILURE

Infrastructure failures must not be learned as evidence that a model is bad at coding.

## Recovery model

Every bounded attempt should eventually persist enough evidence to reconcile after interruption, including:

- run ID
- task ID
- attempt ID
- base SHA
- current HEAD
- last-green SHA
- branch/worktree identity
- agent session ID when available
- model selection
- request ledger references
- verification state

Recovery should inspect durable and deterministic state before issuing any replacement model request.

## Architectural dependency direction

The intended dependency direction is:

```text
control-plane policy / workflow
          |
          v
control-plane contracts and ports
          |
          v
Sandcastle execution adapter
          |
          v
existing Sandcastle kernel
```

The kernel must not import planner, scheduler, router, learning, or durable workflow state modules.

A later phase should enforce this boundary mechanically.
