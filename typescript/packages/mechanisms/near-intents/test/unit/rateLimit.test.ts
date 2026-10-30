import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenBucket } from "../../src/rateLimit";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TokenBucket", () => {
  it("allows a burst, then refills at the configured rate, per key", () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerMinute: 60 });
    expect(bucket.take("a")).toBe(true);
    expect(bucket.take("a")).toBe(true);
    expect(bucket.take("a")).toBe(false);
    expect(bucket.take("b")).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(bucket.take("a")).toBe(true);
    expect(bucket.take("a")).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(bucket.take("a")).toBe(true);
    expect(bucket.take("a")).toBe(true);
    expect(bucket.take("a")).toBe(false);
  });
});
