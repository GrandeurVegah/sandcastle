import { run, type RunOptions, type RunResult } from "../../run.js";
import type {
  ExecutionAttemptInput,
  ExecutionAttemptResult,
  ExecutionKernel,
} from "./ExecutionKernel.js";

/** @internal */
export type SandcastleRunner = (
  options: RunOptions,
) => Promise<RunResult>;

const defaultRunner: SandcastleRunner = (options) => run(options);

const toExecutionAttemptResult = (
  result: RunResult,
): ExecutionAttemptResult => ({
  iterations: result.iterations,
  completionSignal: result.completionSignal,
  stdout: result.stdout,
  commits: result.commits,
  branch: result.branch,
  logFilePath: result.logFilePath,
  preservedWorktreePath: result.preservedWorktreePath,
});

/**
 * Adapt the existing Sandcastle `run()` API to the control plane's bounded
 * attempt port without changing Sandcastle runtime behaviour.
 *
 * The adapter always executes exactly one Sandcastle iteration. It deliberately
 * strips the `resume`/`fork` closures from the result so retry and session policy
 * stays with the future durable control plane rather than leaking through a
 * convenience callback.
 *
 * @internal
 */
export const createSandcastleExecutionKernel = (
  runner: SandcastleRunner = defaultRunner,
): ExecutionKernel => ({
  async executeAttempt(
    input: ExecutionAttemptInput,
  ): Promise<ExecutionAttemptResult> {
    const result = await runner({
      ...input,
      maxIterations: 1,
    });
    return toExecutionAttemptResult(result);
  },
});

/** Default adapter used by the control plane. @internal */
export const sandcastleExecutionKernel: ExecutionKernel =
  createSandcastleExecutionKernel();
