import {
  ERROR_DEPOSIT_NOT_FOUND,
  ERROR_INSUFFICIENT_DEPOSIT,
  ERROR_PAYMENT_FAILED,
} from "../errors";
import { normalizeTxHash } from "../utils";
import type { StatusResponse } from "./client";

export type Outcome =
  | { kind: "pending"; status: string }
  | { kind: "success"; status: "SUCCESS"; destinationTxHash: string; amountOut?: string }
  | { kind: "failed"; status: string; errorReason: string };

/**
 * Reads a `GET /v0/status` answer as the outcome of presenting `txHash`. Only the documented
 * terminal statuses end an operation; anything else, including statuses 1Click does not
 * document, is pending. `SUCCESS` counts only when `txHash` is among the deposits that funded
 * the swap and the delivery transaction is known.
 *
 * @param status - Status response for the instrument
 * @param txHash - The presented deposit transaction hash
 * @returns The outcome
 */
export function outcomeOf(status: StatusResponse, txHash: string): Outcome {
  const { swapDetails } = status;
  switch (status.status) {
    case "SUCCESS": {
      const presented = normalizeTxHash(txHash);
      const funded = swapDetails.originChainTxHashes.some(
        tx => normalizeTxHash(tx.hash) === presented,
      );
      if (!funded) {
        return { kind: "failed", status: "SUCCESS", errorReason: ERROR_DEPOSIT_NOT_FOUND };
      }
      const delivery = swapDetails.destinationChainTxHashes[0]?.hash;
      if (delivery === undefined) {
        return { kind: "pending", status: "SUCCESS" };
      }
      return {
        kind: "success",
        status: "SUCCESS",
        destinationTxHash: delivery,
        ...(swapDetails.amountOut !== undefined && { amountOut: swapDetails.amountOut }),
      };
    }
    case "REFUNDED": {
      const partial = swapDetails.refundReason?.toUpperCase().includes("PARTIAL") ?? false;
      return {
        kind: "failed",
        status: "REFUNDED",
        errorReason: partial ? ERROR_INSUFFICIENT_DEPOSIT : ERROR_PAYMENT_FAILED,
      };
    }
    case "FAILED":
      return { kind: "failed", status: "FAILED", errorReason: ERROR_PAYMENT_FAILED };
    default:
      return { kind: "pending", status: status.status };
  }
}
