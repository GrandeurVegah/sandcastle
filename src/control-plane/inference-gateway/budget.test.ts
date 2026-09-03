import { describe, expect, it } from "vitest";
import { InferenceRequestBudget } from "./budget.js";

describe("InferenceRequestBudget", () => {
  it("enforces the daily request budget", () => {
    const budget = new InferenceRequestBudget(2, 20);
    const now = new Date("2026-09-03T12:00:00.000Z");

    expect(budget.tryConsume(now)).toEqual({ allowed: true });
    expect(budget.tryConsume(new Date(now.getTime() + 1_000))).toEqual({
      allowed: true,
    });

    const rejected = budget.tryConsume(new Date(now.getTime() + 2_000));
    expect(rejected.allowed).toBe(false);
    if (!rejected.allowed) {
      expect(rejected.reason).toBe("LOCAL_DAILY_BUDGET_EXHAUSTED");
      expect(rejected.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("enforces rolling per-minute limits", () => {
    const budget = new InferenceRequestBudget(10, 2);
    const start = new Date("2026-09-03T12:00:00.000Z");

    expect(budget.tryConsume(start)).toEqual({ allowed: true });
    expect(budget.tryConsume(new Date(start.getTime() + 10_000))).toEqual({
      allowed: true,
    });

    const rejected = budget.tryConsume(new Date(start.getTime() + 20_000));
    expect(rejected).toEqual({
      allowed: false,
      reason: "LOCAL_RATE_LIMITED",
      retryAfterMs: 40_000,
    });

    expect(budget.tryConsume(new Date(start.getTime() + 60_001))).toEqual({
      allowed: true,
    });
  });

  it("resets daily accounting on a new UTC day", () => {
    const budget = new InferenceRequestBudget(1, 20);
    expect(
      budget.tryConsume(new Date("2026-09-03T23:59:59.000Z")),
    ).toEqual({ allowed: true });
    expect(
      budget.tryConsume(new Date("2026-09-04T00:00:01.000Z")),
    ).toEqual({ allowed: true });
  });
});
