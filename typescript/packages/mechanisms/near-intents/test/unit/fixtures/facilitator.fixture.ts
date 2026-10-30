import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { Address, Hash } from "viem";
import { ExactNearIntentsScheme } from "../../../src/exact/facilitator";
import type { ExactNearIntentsFacilitatorConfig } from "../../../src/exact/facilitator";
import { createOneClickClient } from "../../../src/oneclick/client";
import { createEvmOrigin } from "../../../src/origins/evm";
import type { QuoteExtra } from "../../../src/schemas";
import type { TokenKeys } from "../../../src/token";
import { createFakeEvmChain } from "./evm.fixture";
import type { FakeEvmChain, FakeTransfer } from "./evm.fixture";
import { createFakeOneClick } from "./oneclick.fixture";
import type { FakeOneClick } from "./oneclick.fixture";

export const RESOURCE = "https://api.example.com/premium-data";
export const ORIGIN_NETWORK = "eip155:42161";
export const DESTINATION_NETWORK = "eip155:8453";
export const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const MERCHANT = "0x3333333333333333333333333333333333333333";
export const REFUND_TO = "0x2527D02599Ba641c19Fea793Cd0f9A6e8457c317";
export const PAYER = "0x1111111111111111111111111111111111111111" as Address;
export const DEPOSIT_TX = `0x${"ab".repeat(32)}` as Hash;
export const keys: TokenKeys = { keys: { k1: "k1-secret" }, activeKeyId: "k1" };

/**
 * The resource server's unquoted entry: USDC on Arbitrum in, USDC on Base to the merchant.
 *
 * @param overrides - Field overrides
 * @returns The entry
 */
export function makeRequirements(
  overrides: Partial<PaymentRequirements> = {},
): PaymentRequirements {
  return {
    scheme: "exact",
    network: ORIGIN_NETWORK,
    asset: USDC_ARBITRUM,
    amount: "",
    payTo: "",
    maxTimeoutSeconds: 300,
    extra: {
      assetTransferMethod: "near-intents",
      paymentFlow: "upfront",
      indicativeAmount: "1005000",
      destination: {
        network: DESTINATION_NETWORK,
        asset: USDC_BASE,
        amount: "1000000",
        recipient: MERCHANT,
      },
    },
    ...overrides,
  };
}

/**
 * A `quote` payload for `accepted`.
 *
 * @param accepted - The unquoted entry
 * @param payload - Payload field overrides
 * @returns The payment payload
 */
export function quotePayload(
  accepted: PaymentRequirements,
  payload: Record<string, unknown> = {},
): PaymentPayload {
  return {
    x402Version: 2,
    resource: { url: RESOURCE },
    accepted,
    payload: { type: "quote", refundTo: REFUND_TO, ...payload },
  };
}

/**
 * A `deposit` payload echoing the unquoted entry and carrying the quoted instrument.
 *
 * @param accepted - The unquoted entry
 * @param quote - The facilitator's quote
 * @param txHash - Deposit transaction
 * @param payload - Payload field overrides
 * @returns The payment payload
 */
export function depositPayload(
  accepted: PaymentRequirements,
  quote: QuoteExtra,
  txHash: string,
  payload: Record<string, unknown> = {},
): PaymentPayload {
  return {
    x402Version: 2,
    resource: { url: RESOURCE },
    accepted,
    payload: {
      type: "deposit",
      operationToken: quote.operationToken,
      depositAddress: quote.depositAddress,
      ...(quote.depositMemo !== undefined && { depositMemo: quote.depositMemo }),
      txHash,
      ...payload,
    },
  };
}

export interface FacilitatorFixture {
  scheme: ExactNearIntentsScheme;
  fake: FakeOneClick;
  chain: FakeEvmChain;
}

/**
 * A facilitator over a fake 1Click and a fake EVM chain, with short windows for tests.
 *
 * @param overrides - Configuration overrides
 * @returns The fixture
 */
export function createFacilitatorFixture(
  overrides: Partial<ExactNearIntentsFacilitatorConfig> = {},
): FacilitatorFixture {
  const fake = createFakeOneClick();
  const chain = createFakeEvmChain();
  const scheme = new ExactNearIntentsScheme({
    oneClick: createOneClickClient({ fetch: fake.fetch }),
    tokenKeys: keys,
    origins: {
      [ORIGIN_NETWORK]: createEvmOrigin({
        network: ORIGIN_NETWORK,
        publicClient: chain.publicClient,
      }),
    },
    settleWindowMs: 5_000,
    pollIntervalMs: 1_000,
    ...overrides,
  });
  return { scheme, fake, chain };
}

/**
 * Mints a quote for the default entry.
 *
 * @param fx - Fixture
 * @param requirements - The unquoted entry
 * @returns The entry and the quote
 */
export async function quotedOperation(
  fx: FacilitatorFixture,
  requirements: PaymentRequirements = makeRequirements(),
): Promise<{ requirements: PaymentRequirements; quote: QuoteExtra }> {
  const result = await fx.scheme.verify(quotePayload(requirements), requirements);
  if (!result.isValid) {
    throw new Error(`quote failed: ${result.invalidReason}`);
  }
  return { requirements, quote: result.extra as QuoteExtra };
}

/**
 * Mines a deposit transaction on the fake chain.
 *
 * @param fx - Fixture
 * @param quote - The quote being funded
 * @param txHash - Transaction hash to mine
 * @param overrides - Transfer overrides, e.g. a wrong recipient
 */
export function fund(
  fx: FacilitatorFixture,
  quote: QuoteExtra,
  txHash: Hash = DEPOSIT_TX,
  overrides: Partial<FakeTransfer> = {},
): void {
  fx.chain.mine(txHash, [
    {
      asset: USDC_ARBITRUM as Address,
      from: PAYER,
      to: quote.depositAddress as Address,
      amount: BigInt(quote.amountIn),
      ...overrides,
    },
  ]);
}
