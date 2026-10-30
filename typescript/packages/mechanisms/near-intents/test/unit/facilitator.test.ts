import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { Hash } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_DEPOSIT_NOT_FOUND,
  ERROR_INSUFFICIENT_DEPOSIT,
  ERROR_QUOTE_MISMATCH,
  ERROR_QUOTE_UNAVAILABLE,
  ERROR_TOKEN_EXPIRED,
  ERROR_TOKEN_INVALID,
} from "../../src/errors";
import { ExactNearIntentsScheme } from "../../src/exact/facilitator";
import { createOneClickClient } from "../../src/oneclick/client";
import { InMemoryFacilitatorOperationStore } from "../../src/operationStore";
import { createEvmOrigin } from "../../src/origins/evm";
import type { DestinationTerms } from "../../src/types";
import { checkOperationToken, issueOperationToken } from "../../src/token";
import { operationKey } from "../../src/utils";
import {
  DEPOSIT_TX,
  MERCHANT,
  ORIGIN_NETWORK,
  PAYER,
  REFUND_TO,
  RESOURCE,
  createFacilitatorFixture,
  depositPayload,
  fund,
  keys,
  makeRequirements,
  quotePayload,
  quotedOperation,
} from "./fixtures/facilitator.fixture";
import { createFakeOneClick } from "./fixtures/oneclick.fixture";

const T0 = Date.parse("2026-10-30T10:00:00Z");
const OTHER = "0x2222222222222222222222222222222222222222";
const TX2 = `0x${"cd".repeat(32)}` as Hash;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("facilitator verify (quote)", () => {
  it("mints a quote with the spec's 1Click parameters and a verifiable token", async () => {
    const fx = createFacilitatorFixture({
      referral: "x402",
      appFees: [{ recipient: "fees.near", fee: 10 }],
    });
    const requirements = makeRequirements();
    const result = await fx.scheme.verify(quotePayload(requirements), requirements);
    expect(result.isValid).toBe(true);
    const quote = result.extra!;

    expect(fx.fake.requests.find(r => r.path === "/v0/quote")!.body).toEqual({
      dry: false,
      swapType: "EXACT_OUTPUT",
      depositType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      refundType: "ORIGIN_CHAIN",
      depositMode: "SIMPLE",
      originAsset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
      destinationAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
      amount: "1000000",
      recipient: MERCHANT,
      refundTo: REFUND_TO,
      slippageTolerance: 50,
      deadline: "2026-10-30T10:05:00.000Z",
      referral: "x402",
      appFees: [{ recipient: "fees.near", fee: 10 }],
    });
    expect(quote).toEqual({
      depositAddress: expect.stringMatching(/^0x[0-9a-f]{40}$/),
      amountIn: "1005000",
      refundDeadline: "2026-10-30T10:05:00.000Z",
      operationToken: expect.stringMatching(/^k1\.\d+\.[A-Za-z0-9_-]+$/),
    });
    const token = quote.operationToken as string;
    expect(token.split(".")[1]).toBe(String(Math.floor(T0 / 1000) + 300 + 86_400));
    const destination = requirements.extra.destination as DestinationTerms;
    const input = {
      network: ORIGIN_NETWORK,
      depositAddress: quote.depositAddress as string,
      resource: RESOURCE,
      destination,
    };
    expect(checkOperationToken(keys, token, input)).toBe("ok");
    const minted = fx.fake.quotes.get(quote.depositAddress as string)!;
    expect(minted.quote.deadline).not.toBe(quote.refundDeadline);
  });

  it("clamps slippage into the published range and publishes it in /supported", async () => {
    const fx = createFacilitatorFixture();
    const requirements = makeRequirements();
    for (const [requested, sent] of [
      [500, 300],
      [1, 10],
      [120, 120],
    ]) {
      await fx.scheme.verify(
        quotePayload(requirements, { slippageTolerance: requested }),
        requirements,
      );
      expect(fx.fake.requests.at(-1)!.body).toMatchObject({ slippageTolerance: sent });
    }
    expect(fx.scheme.getExtra("eip155:42161")).toEqual({
      slippageTolerance: { min: 10, max: 300, default: 50 },
    });
    expect(fx.scheme.getSigners("eip155:42161")).toEqual([]);
  });

  it("never reuses a quote", async () => {
    const fx = createFacilitatorFixture();
    const first = await quotedOperation(fx);
    const second = await quotedOperation(fx);
    expect(second.quote.depositAddress).not.toBe(first.quote.depositAddress);
    expect(second.quote.operationToken).not.toBe(first.quote.operationToken);
  });

  it("rejects malformed quote requests without minting anything", async () => {
    const fx = createFacilitatorFixture();
    const requirements = makeRequirements();
    const good = quotePayload(requirements);
    const cases: [PaymentPayload, PaymentRequirements, string][] = [
      [{ ...good, x402Version: 1 }, requirements, "invalid_x402_version"],
      [
        quotePayload({
          ...requirements,
          extra: { ...requirements.extra, assetTransferMethod: "permit2" },
        }),
        requirements,
        "invalid_payload",
      ],
      [{ ...good, resource: undefined }, requirements, "invalid_payload"],
      [quotePayload({ ...requirements, network: "eip155:8453" }), requirements, "invalid_payload"],
      [
        good,
        { ...requirements, extra: { assetTransferMethod: "near-intents" } },
        "invalid_payload",
      ],
      [
        quotePayload({ ...requirements, network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }),
        { ...requirements, network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" },
        "invalid_network",
      ],
      [quotePayload(requirements, { type: "deposit" }), requirements, "invalid_payload"],
      [quotePayload(requirements, { refundTo: "nope" }), requirements, "invalid_payload"],
      [good, { ...requirements, maxTimeoutSeconds: 0 }, "invalid_payload"],
    ];
    for (const [payload, reqs, reason] of cases) {
      const result = await fx.scheme.verify(payload, reqs);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(reason);
    }
    expect(fx.fake.requests.filter(r => r.path === "/v0/quote")).toHaveLength(0);
  });

  it("rate-limits quotes per requester", async () => {
    const fx = createFacilitatorFixture({ quoteRateLimit: { capacity: 2, refillPerMinute: 60 } });
    const requirements = makeRequirements();
    const payload = quotePayload(requirements);
    expect((await fx.scheme.verify(payload, requirements)).isValid).toBe(true);
    expect((await fx.scheme.verify(payload, requirements)).isValid).toBe(true);
    const limited = await fx.scheme.verify(payload, requirements);
    expect(limited.invalidReason).toBe(ERROR_QUOTE_UNAVAILABLE);
    expect(limited.invalidMessage).toMatch(/rate limit/);
    vi.advanceTimersByTime(1_000);
    expect((await fx.scheme.verify(payload, requirements)).isValid).toBe(true);
  });

  it("maps 1Click failures and unlisted assets to quote_unavailable", async () => {
    const fx = createFacilitatorFixture();
    const requirements = makeRequirements();
    fx.fake.failNextRequests(1);
    expect((await fx.scheme.verify(quotePayload(requirements), requirements)).invalidReason).toBe(
      ERROR_QUOTE_UNAVAILABLE,
    );
    const unlisted = makeRequirements({ asset: "0x9999999999999999999999999999999999999999" });
    expect((await fx.scheme.verify(quotePayload(unlisted), unlisted)).invalidReason).toBe(
      ERROR_QUOTE_UNAVAILABLE,
    );
  });

  it("refuses origins that cannot read deposits", () => {
    const oneClick = createOneClickClient({ fetch: createFakeOneClick().fetch });
    expect(
      () =>
        new ExactNearIntentsScheme({
          oneClick,
          tokenKeys: keys,
          origins: { eip155: createEvmOrigin() },
        }),
    ).toThrow(/cannot read deposits/);
  });
});

describe("facilitator settle (deposit)", () => {
  it("settles a funded deposit once 1Click reports delivery, and records the result", async () => {
    const operations = new InMemoryFacilitatorOperationStore();
    const fx = createFacilitatorFixture({ operations });
    const { requirements, quote } = await quotedOperation(fx);
    fund(fx, quote);
    const payload = depositPayload(requirements, quote, DEPOSIT_TX);

    const settling = fx.scheme.settle(payload, requirements);
    await vi.advanceTimersByTimeAsync(1_000);
    fx.fake.setStatus(quote.depositAddress, "SUCCESS");
    await vi.advanceTimersByTimeAsync(1_000);
    const receipt = await settling;

    expect(receipt).toEqual({
      success: true,
      network: "eip155:8453",
      transaction: expect.stringMatching(/^0xdest/),
      payer: PAYER,
      amount: "1000000",
      extra: { originNetwork: ORIGIN_NETWORK, originTxHash: DEPOSIT_TX },
    });
    expect(JSON.stringify(receipt)).not.toContain(quote.operationToken);
    expect(fx.fake.requests.find(r => r.path === "/v0/deposit/submit")!.body).toEqual({
      txHash: DEPOSIT_TX,
      depositAddress: quote.depositAddress,
    });

    const before = fx.fake.requests.length;
    expect(await fx.scheme.settle(payload, requirements)).toBe(receipt);
    expect(fx.fake.requests.length).toBe(before);
    expect(await operations.get(operationKey(ORIGIN_NETWORK, quote.depositAddress))).toBe(receipt);
  });

  it("returns a terminal result from the first status read, without notifying 1Click", async () => {
    const fx = createFacilitatorFixture();
    const { requirements, quote } = await quotedOperation(fx);
    fund(fx, quote);
    fx.fake.setStatus(quote.depositAddress, "SUCCESS", {
      originChainTxHashes: [{ hash: DEPOSIT_TX.toUpperCase().replace("0X", "0x") }],
    });
    const receipt = await fx.scheme.settle(
      depositPayload(requirements, quote, DEPOSIT_TX),
      requirements,
    );
    expect(receipt.success).toBe(true);
    expect(fx.fake.requests.some(r => r.path === "/v0/deposit/submit")).toBe(false);
  });

  it("returns the pending receipt and releases the claim when the window ends", async () => {
    const operations = new InMemoryFacilitatorOperationStore();
    const fx = createFacilitatorFixture({ operations });
    const { requirements, quote } = await quotedOperation(fx);
    fund(fx, quote);

    const settling = fx.scheme.settle(
      depositPayload(requirements, quote, DEPOSIT_TX),
      requirements,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await settling).toEqual({
      success: false,
      errorReason: "settlement_pending",
      network: ORIGIN_NETWORK,
      transaction: DEPOSIT_TX,
      extra: { status: "KNOWN_DEPOSIT_TX" },
    });
    const key = operationKey(ORIGIN_NETWORK, quote.depositAddress);
    expect(await operations.get(key)).toBeUndefined();
    expect(await operations.claim(key, Date.now() + 1)).toBe(true);
  });

  it("records refunds with the spec's terminal reasons", async () => {
    const fx = createFacilitatorFixture();
    const { requirements, quote } = await quotedOperation(fx);
    fund(fx, quote);
    fx.fake.setStatus(quote.depositAddress, "REFUNDED", { refundReason: "PARTIAL_DEPOSIT" });
    const payload = depositPayload(requirements, quote, DEPOSIT_TX);
    const receipt = await fx.scheme.settle(payload, requirements);
    expect(receipt).toEqual({
      success: false,
      errorReason: ERROR_INSUFFICIENT_DEPOSIT,
      network: ORIGIN_NETWORK,
      transaction: "",
      extra: { status: "REFUNDED", refundTo: REFUND_TO },
    });
    expect(await fx.scheme.settle(payload, requirements)).toBe(receipt);
  });

  it("lets exactly one concurrent presentation work on the operation", async () => {
    const fx = createFacilitatorFixture();
    const { requirements, quote } = await quotedOperation(fx);
    fund(fx, quote);
    fx.fake.setStatus(quote.depositAddress, "SUCCESS", {
      originChainTxHashes: [{ hash: DEPOSIT_TX }],
    });
    const payload = depositPayload(requirements, quote, DEPOSIT_TX);
    const [first, second] = await Promise.all([
      fx.scheme.settle(payload, requirements),
      fx.scheme.settle(payload, requirements),
    ]);
    expect(first.success).toBe(true);
    expect(second === first || second.errorReason === "settlement_pending").toBe(true);
  });

  it("rejects expired, tampered or rebound tokens before any 1Click call", async () => {
    const fx = createFacilitatorFixture();
    const { requirements, quote } = await quotedOperation(fx);
    const before = fx.fake.requests.length;
    const [keyId, expiry, mac] = quote.operationToken.split(".");
    const flipped = `${keyId}.${expiry}.${mac.startsWith("A") ? "B" : "A"}${mac.slice(1)}`;

    vi.setSystemTime(T0 + (300 + 86_400 + 1) * 1000);
    const expired = await fx.scheme.settle(
      depositPayload(requirements, quote, DEPOSIT_TX),
      requirements,
    );
    expect(expired.errorReason).toBe(ERROR_TOKEN_EXPIRED);
    vi.setSystemTime(T0);

    const cases: PaymentPayload[] = [
      depositPayload(requirements, quote, DEPOSIT_TX, { operationToken: flipped }),
      {
        ...depositPayload(requirements, quote, DEPOSIT_TX),
        resource: { url: `${RESOURCE}/other` },
      },
      depositPayload(requirements, quote, DEPOSIT_TX, { depositAddress: OTHER }),
    ];
    for (const payload of cases) {
      expect((await fx.scheme.settle(payload, requirements)).errorReason).toBe(ERROR_TOKEN_INVALID);
    }
    expect(fx.fake.requests.length).toBe(before);
  });

  it("rejects malformed deposit payloads", async () => {
    const fx = createFacilitatorFixture();
    const { requirements, quote } = await quotedOperation(fx);
    const cases = [
      depositPayload(requirements, quote, DEPOSIT_TX, { type: "quote" }),
      depositPayload(requirements, quote, "0x12"),
      depositPayload(requirements, quote, DEPOSIT_TX, { depositAddress: "nope" }),
    ];
    for (const payload of cases) {
      const receipt = await fx.scheme.settle(payload, requirements);
      expect(receipt).toMatchObject({
        success: false,
        errorReason: "invalid_payload",
        transaction: "",
      });
    }
  });

  it("answers pending when 1Click does not know the instrument or is unavailable", async () => {
    const operations = new InMemoryFacilitatorOperationStore();
    const fx = createFacilitatorFixture({ operations });
    const requirements = makeRequirements();
    const destination = requirements.extra.destination as DestinationTerms;
    const unknownAddress = "0x4444444444444444444444444444444444444444";
    const token = issueOperationToken(
      keys,
      { network: ORIGIN_NETWORK, depositAddress: unknownAddress, resource: RESOURCE, destination },
      Math.floor(T0 / 1000) + 86_400,
    );
    const quote = {
      depositAddress: unknownAddress,
      amountIn: "1",
      refundDeadline: "",
      operationToken: token,
    };
    const unknown = await fx.scheme.settle(
      depositPayload(requirements, quote, DEPOSIT_TX),
      requirements,
    );
    expect(unknown).toMatchObject({
      errorReason: "settlement_pending",
      extra: { status: "NOT_FOUND" },
    });
    expect(
      await operations.claim(operationKey(ORIGIN_NETWORK, unknownAddress), Date.now() + 1),
    ).toBe(true);

    const quoted = await quotedOperation(fx);
    fx.fake.failNextRequests(1);
    const unavailable = await fx.scheme.settle(
      depositPayload(quoted.requirements, quoted.quote, DEPOSIT_TX),
      quoted.requirements,
    );
    expect(unavailable).toMatchObject({
      errorReason: "settlement_pending",
      extra: { status: "UNAVAILABLE" },
    });
  });

  it("rejects a quote whose 1Click terms differ from the server's destination", async () => {
    const operations = new InMemoryFacilitatorOperationStore();
    const fx = createFacilitatorFixture({ operations });
    const { requirements, quote } = await quotedOperation(fx);
    fund(fx, quote);
    fx.fake.quotes.get(quote.depositAddress)!.quoteRequest.amount = "999";
    const receipt = await fx.scheme.settle(
      depositPayload(requirements, quote, DEPOSIT_TX),
      requirements,
    );
    expect(receipt.errorReason).toBe(ERROR_QUOTE_MISMATCH);
    const key = operationKey(ORIGIN_NETWORK, quote.depositAddress);
    expect(await operations.get(key)).toBeUndefined();
    expect(await operations.claim(key, Date.now() + 1)).toBe(true);
  });

  it("waits for an unknown transaction within the observation window, then rejects it", async () => {
    const operations = new InMemoryFacilitatorOperationStore();
    const fx = createFacilitatorFixture({ operations });
    const { requirements, quote } = await quotedOperation(fx);
    const payload = depositPayload(requirements, quote, DEPOSIT_TX);
    expect(await fx.scheme.settle(payload, requirements)).toMatchObject({
      errorReason: "settlement_pending",
      extra: { status: "PENDING_DEPOSIT" },
    });
    vi.advanceTimersByTime(15 * 60_000);
    const rejected = await fx.scheme.settle(payload, requirements);
    expect(rejected.errorReason).toBe(ERROR_DEPOSIT_NOT_FOUND);
    const key = operationKey(ORIGIN_NETWORK, quote.depositAddress);
    expect(await operations.get(key)).toBeUndefined();
    expect(await operations.claim(key, Date.now() + 1)).toBe(true);
  });

  it("treats a broadcast but unmined transaction as pending", async () => {
    const fx = createFacilitatorFixture();
    const { requirements, quote } = await quotedOperation(fx);
    fx.chain.broadcast(DEPOSIT_TX);
    expect(
      await fx.scheme.settle(depositPayload(requirements, quote, DEPOSIT_TX), requirements),
    ).toMatchObject({
      errorReason: "settlement_pending",
    });
  });

  it("rejects a confirmed transaction that does not pay the instrument, then accepts a later one", async () => {
    const fx = createFacilitatorFixture();
    const { requirements, quote } = await quotedOperation(fx);
    fund(fx, quote, DEPOSIT_TX, { to: OTHER });
    const rejected = await fx.scheme.settle(
      depositPayload(requirements, quote, DEPOSIT_TX),
      requirements,
    );
    expect(rejected.errorReason).toBe(ERROR_DEPOSIT_NOT_FOUND);

    fund(fx, quote, TX2);
    fx.fake.setStatus(quote.depositAddress, "SUCCESS", { originChainTxHashes: [{ hash: TX2 }] });
    const accepted = await fx.scheme.settle(depositPayload(requirements, quote, TX2), requirements);
    expect(accepted.success).toBe(true);
    expect(accepted.extra).toMatchObject({ originTxHash: TX2 });
  });
});
