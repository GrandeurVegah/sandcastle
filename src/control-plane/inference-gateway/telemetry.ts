import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  InferenceTelemetryEvent,
  InferenceTelemetrySink,
} from "./types.js";

const freezeEvent = (
  event: InferenceTelemetryEvent,
): InferenceTelemetryEvent => Object.freeze({ ...event });

export class InMemoryInferenceTelemetrySink implements InferenceTelemetrySink {
  private readonly recorded: InferenceTelemetryEvent[] = [];

  record(event: InferenceTelemetryEvent): void {
    this.recorded.push(freezeEvent(event));
  }

  events(): readonly InferenceTelemetryEvent[] {
    return [...this.recorded];
  }
}

/**
 * Append-only JSONL telemetry for local operation.
 *
 * Task 5 will introduce the durable orchestration store. This sink exists so
 * inference evidence is not trapped in process memory while preserving the
 * separation between request telemetry and workflow state.
 */
export class JsonlInferenceTelemetrySink implements InferenceTelemetrySink {
  private directoryReady: Promise<void> | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  record(event: InferenceTelemetryEvent): Promise<void> {
    const immutableEvent = freezeEvent(event);
    const write = async (): Promise<void> => {
      this.directoryReady ??= mkdir(dirname(this.path), {
        recursive: true,
      }).then(() => undefined);
      await this.directoryReady;
      await appendFile(
        this.path,
        `${JSON.stringify(immutableEvent)}\n`,
        "utf8",
      );
    };

    const currentWrite = this.writeChain.then(write, write);
    // Keep later appends usable after a failed write. The failing record() call
    // still returns currentWrite and therefore surfaces its error to the caller.
    this.writeChain = currentWrite.catch(() => undefined);
    return currentWrite;
  }
}
