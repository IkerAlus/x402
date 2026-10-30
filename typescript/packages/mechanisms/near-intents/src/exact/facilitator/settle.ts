import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import {
  ERROR_DEPOSIT_NOT_FOUND,
  ERROR_QUOTE_MISMATCH,
  ERROR_TOKEN_EXPIRED,
  ERROR_TOKEN_INVALID,
} from "../../errors";
import { findToken } from "../../oneclick/assets";
import { OneClickError } from "../../oneclick/client";
import type { StatusResponse } from "../../oneclick/client";
import { outcomeOf } from "../../oneclick/status";
import type { Outcome } from "../../oneclick/status";
import type { DepositTarget } from "../../origins";
import { DepositPayloadSchema } from "../../schemas";
import { checkOperationToken } from "../../token";
import { operationKey } from "../../utils";
import { failureResponse, pendingResponse, successResponse } from "../wire";
import type { FacilitatorRuntime } from "./runtime";

/**
 * `/settle` with a `deposit` payload, in the spec's order: structural checks, token,
 * recorded result, quote terms, claim, deposit, outcome, record.
 *
 * @param rt - Facilitator runtime
 * @param payload - Payment payload
 * @param requirements - The resource server's recorded unquoted entry
 * @returns The settlement receipt
 */
export async function settle(
  rt: FacilitatorRuntime,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<SettleResponse> {
  const inspected = rt.inspect(payload, requirements);
  if (!inspected.ok) {
    return failureResponse({
      errorReason: inspected.reason,
      errorMessage: inspected.message,
      originNetwork: requirements.network,
    });
  }
  const { network, asset, resource, destination, origin } = inspected;
  const fail = (errorReason: string, errorMessage?: string): SettleResponse =>
    failureResponse({ errorReason, errorMessage, originNetwork: network });

  const parsed = DepositPayloadSchema.safeParse(payload.payload);
  if (!parsed.success) {
    return fail("invalid_payload", "payload is not a deposit payload");
  }
  const { operationToken, depositAddress, depositMemo, txHash } = parsed.data;
  if (!origin.isAddress(depositAddress) || !origin.isTxHash(txHash)) {
    return fail("invalid_payload", `depositAddress or txHash is malformed for ${network}`);
  }

  const tokenCheck = checkOperationToken(rt.config.tokenKeys, operationToken, {
    network,
    depositAddress,
    depositMemo,
    resource,
    destination,
  });
  if (tokenCheck === "expired") {
    return fail(ERROR_TOKEN_EXPIRED);
  }
  if (tokenCheck === "invalid") {
    return fail(ERROR_TOKEN_INVALID);
  }
  const key = operationKey(network, depositAddress, depositMemo);
  const { operations, oneClick } = rt.config;
  const recorded = await operations.get(key);
  if (recorded) {
    return recorded;
  }
  const pending = (status: string): SettleResponse =>
    pendingResponse({ originNetwork: network, txHash, status });

  let status: StatusResponse | null;
  try {
    status = await oneClick.status(depositAddress, depositMemo);
  } catch (error) {
    if (error instanceof OneClickError) {
      return pending("UNAVAILABLE");
    }
    throw error;
  }
  if (status === null) {
    return pending("NOT_FOUND");
  }
  const { quoteRequest } = status.quoteResponse;
  const destinationToken = findToken(await rt.tokens(), destination.network, destination.asset);
  if (
    destinationToken === undefined ||
    quoteRequest.destinationAsset !== destinationToken.assetId ||
    quoteRequest.recipient !== destination.recipient ||
    quoteRequest.amount !== destination.amount
  ) {
    return fail(ERROR_QUOTE_MISMATCH);
  }

  const claimExpiresAt = Date.now() + rt.config.claimTtlMs;
  if (!(await operations.claim(key, claimExpiresAt))) {
    return (await operations.get(key)) ?? pending(status.status);
  }
  let recordedNow = false;
  try {
    const target: DepositTarget = { network, depositAddress, depositMemo, asset };
    const reading = await origin.readDeposit!(target, txHash);
    if (reading.state === "confirmed-no-match") {
      return fail(ERROR_DEPOSIT_NOT_FOUND, "txHash does not pay the instrument");
    }
    if (reading.state === "unknown") {
      const age = Date.now() - rt.firstSeen(`${key}:${txHash}`);
      return age >= rt.config.observationWindowMs
        ? fail(ERROR_DEPOSIT_NOT_FOUND, "txHash is still unknown to the origin network")
        : pending(status.status);
    }
    if (reading.state === "pending") {
      return pending(status.status);
    }

    let outcome = outcomeOf(status, txHash);
    if (outcome.kind === "pending") {
      outcome = await observe(rt, depositAddress, depositMemo, txHash, outcome);
    }
    if (outcome.kind === "pending") {
      return pending(outcome.status);
    }
    const response =
      outcome.kind === "success"
        ? successResponse({
            destinationNetwork: destination.network,
            deliveryTxHash: outcome.destinationTxHash,
            payer: reading.payer,
            amount: destination.amount,
            originNetwork: network,
            originTxHash: txHash,
          })
        : failureResponse({
            errorReason: outcome.errorReason,
            originNetwork: network,
            status: outcome.status,
            refundTo: quoteRequest.refundTo,
          });
    const endsOperation =
      outcome.kind === "success" || outcome.errorReason !== ERROR_DEPOSIT_NOT_FOUND;
    if (endsOperation && Date.now() < claimExpiresAt) {
      const retainUntil = Number(operationToken.split(".")[1]) * 1000;
      await operations.record(key, response, retainUntil);
      recordedNow = true;
    }
    return response;
  } finally {
    if (!recordedNow) {
      await operations.release(key);
    }
  }
}

/**
 * Notifies 1Click of the deposit, then polls the status until a terminal outcome or the end
 * of the settle window. 1Click failures end the observation with the last outcome.
 *
 * @param rt - Facilitator runtime
 * @param depositAddress - Deposit address
 * @param depositMemo - Deposit memo, where the origin needs one
 * @param txHash - Presented deposit transaction
 * @param initial - Outcome read before the notification
 * @returns The last observed outcome
 */
async function observe(
  rt: FacilitatorRuntime,
  depositAddress: string,
  depositMemo: string | undefined,
  txHash: string,
  initial: Outcome,
): Promise<Outcome> {
  const { oneClick, settleWindowMs, pollIntervalMs } = rt.config;
  const deadline = Date.now() + settleWindowMs;
  let outcome = initial;
  try {
    const submitted = await oneClick.submitDeposit({
      txHash,
      depositAddress,
      ...(depositMemo !== undefined && { memo: depositMemo }),
    });
    outcome = outcomeOf(submitted, txHash);
    while (outcome.kind === "pending" && Date.now() + pollIntervalMs <= deadline) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      const status = await oneClick.status(depositAddress, depositMemo);
      if (status === null) {
        break;
      }
      outcome = outcomeOf(status, txHash);
    }
  } catch (error) {
    if (!(error instanceof OneClickError)) {
      throw error;
    }
  }
  return outcome;
}
