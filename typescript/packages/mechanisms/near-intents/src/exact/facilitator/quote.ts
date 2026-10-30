import type { PaymentPayload, PaymentRequirements, VerifyResponse } from "@x402/core/types";
import { ERROR_QUOTE_UNAVAILABLE } from "../../errors";
import { findToken } from "../../oneclick/assets";
import { OneClickError } from "../../oneclick/client";
import type { QuoteRequest, QuoteResponse, Token } from "../../oneclick/client";
import { QuoteExtraSchema, QuotePayloadSchema } from "../../schemas";
import { issueOperationToken } from "../../token";
import type { FacilitatorRuntime } from "./runtime";

/**
 * `/verify` with a `quote` payload: mints one 1Click quote and the operation token
 * (spec, Quote steps 1 to 4). Commits no funds.
 *
 * @param rt - Facilitator runtime
 * @param payload - Payment payload
 * @param requirements - The resource server's unquoted entry
 * @returns The quote in `extra`, or the rejection
 */
export async function quote(
  rt: FacilitatorRuntime,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<VerifyResponse> {
  const inspected = rt.inspect(payload, requirements);
  if (!inspected.ok) {
    return invalid(inspected.reason, inspected.message);
  }
  const parsed = QuotePayloadSchema.safeParse(payload.payload);
  if (!parsed.success) {
    return invalid("invalid_payload", "payload is not a quote payload");
  }
  const { network, asset, resource, destination, origin } = inspected;
  const { refundTo, slippageTolerance } = parsed.data;
  if (!origin.isAddress(refundTo)) {
    return invalid("invalid_payload", `refundTo is not a valid ${network} address`);
  }
  if (!Number.isInteger(requirements.maxTimeoutSeconds) || requirements.maxTimeoutSeconds <= 0) {
    return invalid("invalid_payload", "maxTimeoutSeconds must be a positive integer");
  }
  if (!rt.takeQuoteSlot(refundTo, resource)) {
    return invalid(ERROR_QUOTE_UNAVAILABLE, "quote rate limit exceeded");
  }

  let tokens: Token[];
  try {
    tokens = await rt.tokens();
  } catch (error) {
    return oneClickFailure(error);
  }
  const originToken = findToken(tokens, network, asset);
  const destinationToken = findToken(tokens, destination.network, destination.asset);
  if (!originToken || !destinationToken) {
    return invalid(ERROR_QUOTE_UNAVAILABLE, "origin or destination asset is not listed by 1Click");
  }

  const { min, max, default: fallback } = rt.config.slippageTolerance;
  const slippage = Math.min(max, Math.max(min, slippageTolerance ?? fallback));
  const deadlineMs = Date.now() + requirements.maxTimeoutSeconds * 1000;
  const deadline = new Date(deadlineMs).toISOString();
  const request: QuoteRequest = {
    dry: false,
    swapType: "EXACT_OUTPUT",
    depositType: "ORIGIN_CHAIN",
    recipientType: "DESTINATION_CHAIN",
    refundType: "ORIGIN_CHAIN",
    depositMode: origin.requiresMemo ? "MEMO" : "SIMPLE",
    originAsset: originToken.assetId,
    destinationAsset: destinationToken.assetId,
    amount: destination.amount,
    recipient: destination.recipient,
    refundTo,
    slippageTolerance: slippage,
    deadline,
    ...(rt.config.appFees !== undefined && { appFees: rt.config.appFees }),
    ...(rt.config.referral !== undefined && { referral: rt.config.referral }),
  };
  let response: QuoteResponse;
  try {
    response = await rt.config.oneClick.quote(request);
  } catch (error) {
    return oneClickFailure(error);
  }

  const { depositAddress, depositMemo, amountIn } = response.quote;
  const usable =
    depositAddress !== undefined &&
    origin.isAddress(depositAddress) &&
    /^\d+$/.test(amountIn) &&
    BigInt(amountIn) > 0n &&
    (!origin.requiresMemo || depositMemo !== undefined);
  if (!usable) {
    return invalid(ERROR_QUOTE_UNAVAILABLE, "1Click returned an unusable quote");
  }
  const expiry = Math.floor(deadlineMs / 1000) + rt.config.graceSeconds;
  const operationToken = issueOperationToken(
    rt.config.tokenKeys,
    { network, depositAddress, depositMemo, resource, destination },
    expiry,
  );
  const extra = QuoteExtraSchema.parse({
    depositAddress,
    amountIn,
    refundDeadline: deadline,
    operationToken,
    ...(depositMemo !== undefined && { depositMemo }),
  });
  return { isValid: true, extra };
}

/**
 * Rejection response.
 *
 * @param reason - Error reason
 * @param message - Human-readable detail
 * @returns The response
 */
function invalid(reason: string, message: string): VerifyResponse {
  return { isValid: false, invalidReason: reason, invalidMessage: message };
}

/**
 * Maps a 1Click failure to `quote_unavailable`; anything else propagates.
 *
 * @param error - Thrown error
 * @returns The rejection
 */
function oneClickFailure(error: unknown): VerifyResponse {
  if (error instanceof OneClickError) {
    return invalid(ERROR_QUOTE_UNAVAILABLE, error.message);
  }
  throw error;
}
