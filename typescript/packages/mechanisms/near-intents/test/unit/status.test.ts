import { describe, expect, it } from "vitest";
import {
  ERROR_DEPOSIT_NOT_FOUND,
  ERROR_INSUFFICIENT_DEPOSIT,
  ERROR_PAYMENT_FAILED,
} from "../../src/errors";
import { createOneClickClient } from "../../src/oneclick/client";
import { outcomeOf } from "../../src/oneclick/status";
import type { StatusResponse } from "../../src/oneclick/client";
import { createFakeOneClick } from "./fixtures/oneclick.fixture";

const TX = "0xAAAA";

/**
 * Mints a quote on the fake, moves it to `status` and reads it back through the real client.
 *
 * @param status - 1Click status to set
 * @param swapDetails - `swapDetails` overrides
 * @returns The status response as the client parses it
 */
async function statusAfter(
  status: string,
  swapDetails: Record<string, unknown> = {},
): Promise<StatusResponse> {
  const fake = createFakeOneClick();
  const client = createOneClickClient({ fetch: fake.fetch });
  const { quote } = await client.quote({
    dry: false,
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
    deadline: new Date(0).toISOString(),
  });
  fake.setStatus(quote.depositAddress!, status, swapDetails);
  return (await client.status(quote.depositAddress!))!;
}

describe("outcomeOf", () => {
  it("is pending on non-terminal statuses and on statuses 1Click does not document", async () => {
    const statuses = ["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING"];
    for (const status of [...statuses, "KYT_BLOCKED", ""]) {
      expect(outcomeOf(await statusAfter(status), TX)).toEqual({ kind: "pending", status });
    }
  });

  it("succeeds only when the presented transaction funded the swap", async () => {
    const funded = await statusAfter("SUCCESS", {
      originChainTxHashes: [{ hash: "0xaaaa" }],
      amountOut: "1000000",
    });
    expect(outcomeOf(funded, TX)).toEqual({
      kind: "success",
      status: "SUCCESS",
      destinationTxHash: expect.stringMatching(/^0xdest/),
      amountOut: "1000000",
    });
    const other = await statusAfter("SUCCESS", { originChainTxHashes: [{ hash: "0xbbbb" }] });
    expect(outcomeOf(other, TX)).toEqual({
      kind: "failed",
      status: "SUCCESS",
      errorReason: ERROR_DEPOSIT_NOT_FOUND,
    });
  });

  it("waits for the delivery transaction before reporting success", async () => {
    const early = await statusAfter("SUCCESS", {
      originChainTxHashes: [{ hash: TX }],
      destinationChainTxHashes: [],
    });
    expect(outcomeOf(early, TX)).toEqual({ kind: "pending", status: "SUCCESS" });
  });

  it("maps refunds and failures to the spec's terminal reasons", async () => {
    const failed = (status: string, errorReason: string) => ({
      kind: "failed",
      status,
      errorReason,
    });
    expect(
      outcomeOf(await statusAfter("REFUNDED", { refundReason: "PARTIAL_DEPOSIT" }), TX),
    ).toEqual(failed("REFUNDED", ERROR_INSUFFICIENT_DEPOSIT));
    expect(outcomeOf(await statusAfter("REFUNDED", { refundReason: "DEADLINE" }), TX)).toEqual(
      failed("REFUNDED", ERROR_PAYMENT_FAILED),
    );
    expect(outcomeOf(await statusAfter("REFUNDED"), TX)).toEqual(
      failed("REFUNDED", ERROR_PAYMENT_FAILED),
    );
    expect(outcomeOf(await statusAfter("FAILED"), TX)).toEqual(
      failed("FAILED", ERROR_PAYMENT_FAILED),
    );
  });
});
