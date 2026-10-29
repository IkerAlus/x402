import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentRequirements, SettleResponse } from "@x402/core/types";
import {
  InMemoryFacilitatorOperationStore,
  InMemoryServerOperationStore,
} from "../../src/operationStore";

const KEY = "eip155:42161:0x76b4c56085ED136a8744D52bE956396624a730E8";
const T0 = Date.parse("2026-10-29T00:00:00Z");
const DAY = 86_400_000;
const response: SettleResponse = {
  success: true,
  transaction: "0xdest",
  network: "eip155:8453",
  payer: "0xpayer",
};
const requirements = {
  scheme: "exact",
  network: "eip155:42161",
  asset: "0xusdc",
  amount: "",
  payTo: "",
  maxTimeoutSeconds: 900,
} as PaymentRequirements;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InMemoryFacilitatorOperationStore", () => {
  it("hands the claim to exactly one of several concurrent attempts", async () => {
    const store = new InMemoryFacilitatorOperationStore();
    const attempts = [1, 2, 3].map(() => store.claim(KEY, T0 + 60_000));
    expect((await Promise.all(attempts)).filter(Boolean)).toHaveLength(1);
  });

  it("frees the claim on release and on expiry", async () => {
    const store = new InMemoryFacilitatorOperationStore();
    expect(await store.claim(KEY, T0 + 60_000)).toBe(true);
    expect(await store.claim(KEY, T0 + 60_000)).toBe(false);
    await store.release(KEY);
    expect(await store.claim(KEY, T0 + 60_000)).toBe(true);
    vi.setSystemTime(T0 + 60_000);
    expect(await store.claim(KEY, T0 + 120_000)).toBe(true);
  });

  it("returns the first recorded result unchanged until its retention ends", async () => {
    const store = new InMemoryFacilitatorOperationStore();
    expect(await store.get(KEY)).toBeUndefined();
    await store.claim(KEY, T0 + 60_000);
    await store.record(KEY, response, T0 + DAY);
    expect(await store.get(KEY)).toBe(response);
    expect(await store.claim(KEY, T0 + 60_000)).toBe(false);
    await store.record(KEY, { ...response, success: false, errorReason: "late" }, T0 + DAY);
    expect(await store.get(KEY)).toBe(response);
    vi.setSystemTime(T0 + DAY);
    expect(await store.get(KEY)).toBeUndefined();
    expect(await store.claim(KEY, T0 + DAY + 60_000)).toBe(true);
  });
});

describe("InMemoryServerOperationStore", () => {
  it("keeps the quoted entry and marks execution exactly once", async () => {
    const store = new InMemoryServerOperationStore();
    expect(await store.get(KEY)).toBeUndefined();
    expect(await store.markExecuted(KEY)).toBe(false);
    await store.put(KEY, { requirements, facilitator: "default" }, T0 + DAY);
    expect(await store.get(KEY)).toEqual({ requirements, facilitator: "default", executed: false });
    const marks = await Promise.all([store.markExecuted(KEY), store.markExecuted(KEY)]);
    expect(marks).toEqual([true, false]);
    expect((await store.get(KEY))?.executed).toBe(true);
  });

  it("forgets operations past their retention", async () => {
    const store = new InMemoryServerOperationStore();
    await store.put(KEY, { requirements, facilitator: "default" }, T0 + 1_000);
    vi.setSystemTime(T0 + 1_000);
    expect(await store.get(KEY)).toBeUndefined();
    expect(await store.markExecuted(KEY)).toBe(false);
  });
});
