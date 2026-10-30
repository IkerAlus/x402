import { describe, expect, it } from "vitest";
import {
  failureResponse,
  pendingResponse,
  quotedEntryFrom,
  successResponse,
} from "../../src/exact/wire";
import { makeRequirements } from "./fixtures/facilitator.fixture";

describe("wire builders", () => {
  it("fills the vacant terms of the unquoted entry and leaves the rest untouched", () => {
    const unquoted = makeRequirements();
    const quoted = quotedEntryFrom(unquoted, {
      depositAddress: "0xDeposit",
      amountIn: "1005000",
      refundDeadline: "2026-09-23T10:10:00Z",
      operationToken: "k1.1.mac",
    });
    expect(quoted).toEqual({
      ...unquoted,
      payTo: "0xDeposit",
      amount: "1005000",
      extra: {
        ...unquoted.extra,
        refundDeadline: "2026-09-23T10:10:00Z",
        operationToken: "k1.1.mac",
      },
    });
    expect(unquoted.payTo).toBe("");
    expect(
      quotedEntryFrom(unquoted, {
        depositAddress: "GDEPOSIT",
        amountIn: "1",
        refundDeadline: "d",
        operationToken: "t",
        depositMemo: "777",
      }).extra,
    ).toMatchObject({ depositMemo: "777" });
  });

  it("builds the three receipt shapes", () => {
    expect(
      successResponse({
        destinationNetwork: "eip155:8453",
        deliveryTxHash: "0xdelivery",
        payer: "0xpayer",
        amount: "1000000",
        originNetwork: "eip155:42161",
        originTxHash: "0xdeposit",
      }),
    ).toEqual({
      success: true,
      network: "eip155:8453",
      transaction: "0xdelivery",
      payer: "0xpayer",
      amount: "1000000",
      extra: { originNetwork: "eip155:42161", originTxHash: "0xdeposit" },
    });
    expect(
      failureResponse({ errorReason: "invalid_payload", originNetwork: "eip155:42161" }),
    ).toEqual({
      success: false,
      errorReason: "invalid_payload",
      network: "eip155:42161",
      transaction: "",
    });
    expect(
      pendingResponse({ originNetwork: "eip155:42161", txHash: "0xdeposit", status: "PROCESSING" }),
    ).toEqual({
      success: false,
      errorReason: "settlement_pending",
      network: "eip155:42161",
      transaction: "0xdeposit",
      extra: { status: "PROCESSING" },
    });
  });
});
