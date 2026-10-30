import { describe, expect, it } from "vitest";
import {
  DepositPayloadSchema,
  QuotePayloadSchema,
  QuotedExtraSchema,
  UnquotedExtraSchema,
} from "../../src/schemas";

const destination = {
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amount: "1000000",
  recipient: "0xMerchantOnBase",
};
const unquoted = {
  assetTransferMethod: "near-intents",
  paymentFlow: "upfront",
  indicativeAmount: "1005000",
  destination,
};

describe("wire schemas", () => {
  it("accepts the spec's entries and payloads", () => {
    expect(UnquotedExtraSchema.parse(unquoted)).toEqual(unquoted);
    const quoted = {
      ...unquoted,
      refundDeadline: "2026-09-23T10:10:00Z",
      operationToken: "k1.1790244600.Da1hrEbt50TdIbfZb5EhYU9CnB120jf-cs0d189lrvQ",
    };
    expect(QuotedExtraSchema.parse({ ...quoted, unrelated: 1 })).toEqual(quoted);
    expect(QuotePayloadSchema.parse({ type: "quote", refundTo: "0xabc" })).toEqual({
      type: "quote",
      refundTo: "0xabc",
    });
    const deposit = {
      type: "deposit",
      operationToken: "k1.1.mac",
      depositAddress: "GDEPOSIT",
      depositMemo: "777",
      txHash: "abc",
    };
    expect(DepositPayloadSchema.parse(deposit)).toEqual(deposit);
  });

  it("rejects the wrong method, flow, amounts and payload types", () => {
    expect(
      UnquotedExtraSchema.safeParse({ ...unquoted, assetTransferMethod: "permit2" }).success,
    ).toBe(false);
    expect(UnquotedExtraSchema.safeParse({ ...unquoted, paymentFlow: "deferred" }).success).toBe(
      false,
    );
    expect(
      UnquotedExtraSchema.safeParse({ ...unquoted, destination: { ...destination, amount: "1.5" } })
        .success,
    ).toBe(false);
    expect(QuotedExtraSchema.safeParse(unquoted).success).toBe(false);
    expect(
      QuotePayloadSchema.safeParse({ type: "quote", refundTo: "0xabc", slippageTolerance: -1 })
        .success,
    ).toBe(false);
    expect(QuotePayloadSchema.safeParse({ type: "deposit", refundTo: "0xabc" }).success).toBe(
      false,
    );
    expect(
      DepositPayloadSchema.safeParse({ type: "deposit", operationToken: "t", txHash: "x" }).success,
    ).toBe(false);
  });
});
