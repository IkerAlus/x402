import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOneClickClient, OneClickUnavailableError } from "../../src/oneclick/client";
import { createDryQuoteCache } from "../../src/oneclick/dryQuote";
import type { DryQuoteCacheConfig } from "../../src/oneclick/dryQuote";
import { createFakeOneClick, type FakeOneClick } from "./fixtures/oneclick.fixture";

const request = {
  swapType: "EXACT_OUTPUT",
  depositType: "ORIGIN_CHAIN",
  recipientType: "DESTINATION_CHAIN",
  refundType: "ORIGIN_CHAIN",
  originAsset: "usdc-arb",
  destinationAsset: "usdc-base",
  amount: "1000000",
  recipient: "0xMerchant",
  refundTo: "0xRefund",
  slippageTolerance: 100,
  deadline: "2026-01-01T00:00:00.000Z",
} as const;

/**
 * Builds a cache over the real client and a fake 1Click.
 *
 * @param config - Cache windows
 * @returns The fake and the cache
 */
function setup(config: Omit<DryQuoteCacheConfig, "oneClick"> = {}) {
  const fake = createFakeOneClick();
  const oneClick = createOneClickClient({ fetch: fake.fetch });
  return { fake, cache: createDryQuoteCache({ oneClick, ...config }) };
}

const quoteRequests = (fake: FakeOneClick) => fake.requests.filter(r => r.path === "/v0/quote");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDryQuoteCache", () => {
  it("quotes dry once and serves the amount from memory within the TTL", async () => {
    const { fake, cache } = setup();
    expect(await cache.indicativeAmount(request)).toBe("1010000");
    expect(quoteRequests(fake)).toHaveLength(1);
    expect(quoteRequests(fake)[0].body).toMatchObject({ dry: true, swapType: "EXACT_OUTPUT" });
    vi.advanceTimersByTime(59_000);
    expect(await cache.indicativeAmount(request)).toBe("1010000");
    expect(quoteRequests(fake)).toHaveLength(1);
  });

  it("shares one in-flight quote between concurrent misses and keys on slippage", async () => {
    const { fake, cache } = setup();
    await Promise.all([cache.indicativeAmount(request), cache.indicativeAmount(request)]);
    expect(quoteRequests(fake)).toHaveLength(1);
    expect(await cache.indicativeAmount({ ...request, slippageTolerance: 50 })).toBe("1005000");
    expect(quoteRequests(fake)).toHaveLength(2);
  });

  it("serves a stale amount while refreshing and keeps it when the refresh fails", async () => {
    const { fake, cache } = setup();
    await cache.indicativeAmount(request);
    vi.advanceTimersByTime(61_000);
    fake.failNextRequests(1);
    expect(await cache.indicativeAmount(request)).toBe("1010000");
    expect(quoteRequests(fake)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(await cache.indicativeAmount(request)).toBe("1010000");
    expect(quoteRequests(fake)).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await cache.indicativeAmount(request)).toBe("1010000");
    expect(quoteRequests(fake)).toHaveLength(3);
  });

  it("fails once the stale window has passed and 1Click is unavailable", async () => {
    const { fake, cache } = setup({ ttlMs: 1_000, staleMs: 5_000 });
    await cache.indicativeAmount(request);
    vi.advanceTimersByTime(5_000);
    fake.failNextRequests(1);
    await expect(cache.indicativeAmount(request)).rejects.toBeInstanceOf(OneClickUnavailableError);
    expect(await cache.indicativeAmount(request)).toBe("1010000");
  });
});
