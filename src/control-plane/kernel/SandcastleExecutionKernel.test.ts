import { describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "../../AgentProvider.js";
import type { RunOptions, RunResult } from "../../run.js";
import { testStubProvider } from "../../sandboxes/test-shared.js";
import {
  createSandcastleExecutionKernel,
  type SandcastleRunner,
} from "./SandcastleExecutionKernel.js";

const testAgent: AgentProvider = {
  name: "test-agent",
  env: {},
  captureSessions: false,
  buildPrintCommand: ({ prompt }) => ({
    command: "test-agent",
    stdin: prompt,
  }),
  parseStreamLine: () => [],
};

const makeResult = (): RunResult => ({
  iterations: [{ sessionId: "session-1" }],
  completionSignal: "<promise>COMPLETE</promise>",
  stdout: "done",
  commits: [{ sha: "abc123" }],
  branch: "sandcastle/task",
  logFilePath: "/tmp/task.log",
  preservedWorktreePath: "/tmp/worktree",
  resume: async () => makeResult(),
  fork: async () => makeResult(),
});

describe("SandcastleExecutionKernel", () => {
  it("forces each control-plane attempt to exactly one Sandcastle iteration", async () => {
    let received: RunOptions | undefined;
    const runner: SandcastleRunner = vi.fn(async (options) => {
      received = options;
      return makeResult();
    });
    const kernel = createSandcastleExecutionKernel(runner);

    await kernel.executeAttempt({
      agent: testAgent,
      sandbox: testStubProvider().provider,
      prompt: "Implement one bounded task",
    });

    expect(received?.maxIterations).toBe(1);
  });

  it("returns execution evidence without leaking resume or fork policy closures", async () => {
    const runner: SandcastleRunner = vi.fn(async () => makeResult());
    const kernel = createSandcastleExecutionKernel(runner);

    const result = await kernel.executeAttempt({
      agent: testAgent,
      sandbox: testStubProvider().provider,
      prompt: "Implement one bounded task",
    });

    expect(result).toEqual({
      iterations: [{ sessionId: "session-1" }],
      completionSignal: "<promise>COMPLETE</promise>",
      stdout: "done",
      commits: [{ sha: "abc123" }],
      branch: "sandcastle/task",
      logFilePath: "/tmp/task.log",
      preservedWorktreePath: "/tmp/worktree",
    });
    expect("resume" in result).toBe(false);
    expect("fork" in result).toBe(false);
  });
});
