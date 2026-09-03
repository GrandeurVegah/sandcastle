export type BudgetRejection =
  | {
      readonly allowed: false;
      readonly reason: "LOCAL_DAILY_BUDGET_EXHAUSTED";
      readonly retryAfterMs: number;
    }
  | {
      readonly allowed: false;
      readonly reason: "LOCAL_RATE_LIMITED";
      readonly retryAfterMs: number;
    };

export type BudgetDecision = { readonly allowed: true } | BudgetRejection;

const utcDayKey = (now: Date): string => now.toISOString().slice(0, 10);

const millisUntilNextUtcDay = (now: Date): number => {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, next - now.getTime());
};

/**
 * In-memory hard request budget for the Task 3 gateway.
 *
 * Durable counters belong to the later durable-state phase. This guard is still
 * authoritative for one running gateway process and deliberately counts an
 * upstream attempt before its outcome is known because failed inference calls
 * can still consume provider quota.
 */
export class InferenceRequestBudget {
  private currentDay: string | undefined;
  private dailyCount = 0;
  private readonly minuteTimestamps: number[] = [];

  constructor(
    private readonly dailyRequestLimit: number,
    private readonly requestsPerMinute: number,
  ) {}

  tryConsume(now: Date = new Date()): BudgetDecision {
    const day = utcDayKey(now);
    if (this.currentDay !== day) {
      this.currentDay = day;
      this.dailyCount = 0;
      this.minuteTimestamps.length = 0;
    }

    const cutoff = now.getTime() - 60_000;
    while (
      this.minuteTimestamps.length > 0 &&
      this.minuteTimestamps[0]! <= cutoff
    ) {
      this.minuteTimestamps.shift();
    }

    if (this.dailyCount >= this.dailyRequestLimit) {
      return {
        allowed: false,
        reason: "LOCAL_DAILY_BUDGET_EXHAUSTED",
        retryAfterMs: millisUntilNextUtcDay(now),
      };
    }

    if (this.minuteTimestamps.length >= this.requestsPerMinute) {
      const oldest = this.minuteTimestamps[0]!;
      return {
        allowed: false,
        reason: "LOCAL_RATE_LIMITED",
        retryAfterMs: Math.max(1, oldest + 60_000 - now.getTime()),
      };
    }

    this.dailyCount++;
    this.minuteTimestamps.push(now.getTime());
    return { allowed: true };
  }

  snapshot(now: Date = new Date()): {
    readonly day: string;
    readonly dailyCount: number;
    readonly minuteCount: number;
    readonly dailyRequestLimit: number;
    readonly requestsPerMinute: number;
  } {
    const day = utcDayKey(now);
    const minuteCount = this.minuteTimestamps.filter(
      (timestamp) => timestamp > now.getTime() - 60_000,
    ).length;
    return {
      day,
      dailyCount: this.currentDay === day ? this.dailyCount : 0,
      minuteCount: this.currentDay === day ? minuteCount : 0,
      dailyRequestLimit: this.dailyRequestLimit,
      requestsPerMinute: this.requestsPerMinute,
    };
  }
}
