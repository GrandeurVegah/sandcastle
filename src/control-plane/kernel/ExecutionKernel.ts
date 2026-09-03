import type { AgentProvider } from "../../AgentProvider.js";
import type { IterationResult, RunOptions } from "../../run.js";

/**
 * Input accepted by the durable control plane for one bounded coding-agent
 * attempt.
 *
 * `maxIterations` is intentionally absent: the adapter fixes every control-plane
 * attempt to exactly one Sandcastle iteration. Long-horizon retry, repair, and
 * rerouting policy belongs to the durable orchestration layer.
 *
 * Structured output and session forking are also intentionally deferred until
 * their control-plane contracts are defined. Task 4 owns typed handoffs; later
 * phases may extend this port through an explicit ADR if needed.
 *
 * @internal
 */
export type ExecutionAttemptInput = Omit<
  RunOptions<AgentProvider>,
  "maxIterations" | "output" | "forkSession"
>;

/**
 * Kernel-observed evidence returned from one bounded attempt.
 *
 * The result excludes `RunResult.resume` and `RunResult.fork` convenience
 * closures. Session IDs remain available through `iterations`; the control
 * plane must make any later resume/reroute decision explicitly.
 *
 * This is execution evidence, not task acceptance. Git inspection and
 * deterministic verification remain separate authoritative control-plane
 * responsibilities.
 *
 * @internal
 */
export interface ExecutionAttemptResult {
  readonly iterations: IterationResult[];
  readonly completionSignal?: string;
  readonly stdout: string;
  readonly commits: { readonly sha: string }[];
  readonly branch: string;
  readonly logFilePath?: string;
  readonly preservedWorktreePath?: string;
}

/**
 * Port through which the durable orchestration control plane invokes the
 * existing Sandcastle execution kernel.
 *
 * Implementations execute exactly one bounded attempt and return observed
 * execution evidence. They do not decide task readiness, retries, routing,
 * acceptance, or recovery policy.
 *
 * @internal
 */
export interface ExecutionKernel {
  executeAttempt(input: ExecutionAttemptInput): Promise<ExecutionAttemptResult>;
}
