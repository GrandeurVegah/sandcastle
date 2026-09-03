import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlInferenceTelemetrySink } from "./telemetry.js";
import type { InferenceTelemetryEvent } from "./types.js";

const event = (requestId: string): InferenceTelemetryEvent => ({
  requestId,
  runId: "run-1",
  taskId: "task-1",
  attemptId: "attempt-1",
  requestedModel: "qwen/qwen3-coder:free",
  servedModel: "qwen/qwen3-coder:free",
  startedAt: "2026-09-03T12:00:00.000Z",
  finishedAt: "2026-09-03T12:00:01.000Z",
  latencyMs: 1_000,
  httpStatus: 200,
  inputTokens: 10,
  outputTokens: 2,
  toolSchemaPresent: true,
  status: "succeeded",
});

describe("JsonlInferenceTelemetrySink", () => {
  it("appends request events as ordered JSONL even when writes overlap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sandcastle-gateway-"));
    const path = join(directory, "events", "inference.jsonl");
    try {
      const sink = new JsonlInferenceTelemetrySink(path);
      await Promise.all([
        sink.record(event("request-1")),
        sink.record(event("request-2")),
      ]);

      const lines = (await readFile(path, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual(event("request-1"));
      expect(JSON.parse(lines[1]!)).toEqual(event("request-2"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
