import type { Network, PaymentRequirements, SettleResponse } from "@x402/core/types";
import type { QuoteExtra } from "../schemas";

/**
 * Builds the quoted entry of the corrective 402 from the unquoted entry and the quote.
 * `maxTimeoutSeconds` and every other field stay as advertised.
 *
 * @param unquoted - The unquoted entry the quote was minted for
 * @param quote - `VerifyResponse.extra` of the successful quote
 * @returns The quoted entry
 */
export function quotedEntryFrom(
  unquoted: PaymentRequirements,
  quote: QuoteExtra,
): PaymentRequirements {
  return {
    ...unquoted,
    payTo: quote.depositAddress,
    amount: quote.amountIn,
    extra: {
      ...unquoted.extra,
      refundDeadline: quote.refundDeadline,
      operationToken: quote.operationToken,
      ...(quote.depositMemo !== undefined && { depositMemo: quote.depositMemo }),
    },
  };
}

/**
 * Settlement receipt for a delivered payment. `network` and `transaction` identify the
 * delivery on the destination network.
 *
 * @param args - Delivery and deposit facts
 * @param args.destinationNetwork - Network the merchant received on
 * @param args.deliveryTxHash - Delivery transaction on the destination network
 * @param args.payer - Account debited on the origin network, when known
 * @param args.amount - Destination amount in base units
 * @param args.originNetwork - Origin network
 * @param args.originTxHash - Presented deposit transaction
 * @returns The receipt
 */
export function successResponse(args: {
  destinationNetwork: string;
  deliveryTxHash: string;
  payer?: string;
  amount: string;
  originNetwork: Network;
  originTxHash: string;
}): SettleResponse {
  return {
    success: true,
    network: args.destinationNetwork as Network,
    transaction: args.deliveryTxHash,
    ...(args.payer !== undefined && { payer: args.payer }),
    amount: args.amount,
    extra: { originNetwork: args.originNetwork, originTxHash: args.originTxHash },
  };
}

/**
 * Terminal failure receipt: nothing was delivered.
 *
 * @param args - Failure facts
 * @param args.errorReason - Error reason
 * @param args.originNetwork - Origin network
 * @param args.errorMessage - Human-readable detail
 * @param args.status - 1Click status that ended the operation, when one exists
 * @param args.refundTo - Address 1Click refunds, when known
 * @returns The receipt
 */
export function failureResponse(args: {
  errorReason: string;
  originNetwork: Network;
  errorMessage?: string;
  status?: string;
  refundTo?: string;
}): SettleResponse {
  const extra = {
    ...(args.status !== undefined && { status: args.status }),
    ...(args.refundTo !== undefined && { refundTo: args.refundTo }),
  };
  return {
    success: false,
    errorReason: args.errorReason,
    ...(args.errorMessage !== undefined && { errorMessage: args.errorMessage }),
    network: args.originNetwork,
    transaction: "",
    ...(Object.keys(extra).length > 0 && { extra }),
  };
}

/**
 * Not-yet-final receipt: the client retries with the same operation token.
 *
 * @param args - Pending facts
 * @param args.originNetwork - Origin network
 * @param args.txHash - Presented deposit transaction
 * @param args.status - Last observed status
 * @returns The receipt
 */
export function pendingResponse(args: {
  originNetwork: Network;
  txHash: string;
  status: string;
}): SettleResponse {
  return {
    success: false,
    errorReason: "settlement_pending",
    network: args.originNetwork,
    transaction: args.txHash,
    extra: { status: args.status },
  };
}
