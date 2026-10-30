import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import {
  ERROR_DEPOSIT_NOT_FOUND,
  ERROR_QUOTE_MISMATCH,
  ERROR_TOKEN_EXPIRED,
  ERROR_TOKEN_INVALID,
} from "../../errors";
import { findToken } from "../../oneclick/assets";
import { OneClickError } from "../../oneclick/client";
import type { StatusResponse, Token } from "../../oneclick/client";
import { outcomeOf } from "../../oneclick/status";
import type { Outcome } from "../../oneclick/status";
import type { DepositReading, DepositTarget } from "../../origins";
import { DepositPayloadSchema } from "../../schemas";
import { checkOperationToken } from "../../token";
import { operationKey } from "../../utils";
import { failureResponse, pendingResponse, successResponse } from "../wire";
import type { FacilitatorRuntime } from "./runtime";

/** The settle window elapsed while waiting on an external call. */
class DeadlineError extends Error {}

/**
 * `/settle` with a `deposit` payload, in the spec's order: structural checks, token,
 * recorded result, quote terms, claim, deposit, outcome, record. The whole attempt ends
 * within `settleWindowMs`: every external call gets the remaining budget.
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
  const deadline = Date.now() + rt.config.settleWindowMs;
  const remaining = (): number => Math.max(0, deadline - Date.now());

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
    status = await oneClick.status(depositAddress, depositMemo, { timeoutMs: remaining() });
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
  let tokens: Token[];
  try {
    tokens = await withinDeadline(rt.tokens(remaining()), remaining());
  } catch (error) {
    if (error instanceof OneClickError || error instanceof DeadlineError) {
      return pending("UNAVAILABLE");
    }
    throw error;
  }
  const destinationToken = findToken(tokens, destination.network, destination.asset);
  const assetMatches =
    destinationToken === undefined || quoteRequest.destinationAsset === destinationToken.assetId;
  if (
    !assetMatches ||
    quoteRequest.recipient !== destination.recipient ||
    quoteRequest.amount !== destination.amount
  ) {
    return fail(ERROR_QUOTE_MISMATCH);
  }

  const claimId = await operations.claim(key, Date.now() + rt.config.claimTtlMs);
  if (claimId === undefined) {
    return (await operations.get(key)) ?? pending(status.status);
  }
  let recordedNow = false;
  try {
    const target: DepositTarget = { network, depositAddress, depositMemo, asset };
    let reading: DepositReading;
    try {
      reading = await withinDeadline(origin.readDeposit!(target, txHash), remaining());
    } catch (error) {
      if (error instanceof DeadlineError) {
        return pending(status.status);
      }
      throw error;
    }
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
      outcome = await observe(rt, depositAddress, depositMemo, txHash, outcome, deadline);
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
    if (!endsOperation) {
      return response;
    }
    const retainUntil = Number(operationToken.split(".")[1]) * 1000;
    if (await operations.record(key, claimId, response, retainUntil)) {
      recordedNow = true;
      return response;
    }
    return (await operations.get(key)) ?? pending(outcome.status);
  } finally {
    if (!recordedNow) {
      await operations.release(key, claimId);
    }
  }
}

/**
 * Notifies 1Click of the deposit (best effort), then polls the status until a terminal
 * outcome or the attempt deadline. A 1Click failure ends the observation with the last
 * outcome.
 *
 * @param rt - Facilitator runtime
 * @param depositAddress - Deposit address
 * @param depositMemo - Deposit memo, where the origin needs one
 * @param txHash - Presented deposit transaction
 * @param initial - Outcome read before the notification
 * @param deadline - Attempt deadline in milliseconds
 * @returns The last observed outcome
 */
async function observe(
  rt: FacilitatorRuntime,
  depositAddress: string,
  depositMemo: string | undefined,
  txHash: string,
  initial: Outcome,
  deadline: number,
): Promise<Outcome> {
  const { oneClick, pollIntervalMs } = rt.config;
  const remaining = (): number => Math.max(0, deadline - Date.now());
  let outcome = initial;
  try {
    const submitted = await oneClick.submitDeposit(
      { txHash, depositAddress, ...(depositMemo !== undefined && { memo: depositMemo }) },
      { timeoutMs: remaining() },
    );
    outcome = outcomeOf(submitted, txHash);
  } catch (error) {
    if (!(error instanceof OneClickError)) {
      throw error;
    }
  }
  while (outcome.kind === "pending" && remaining() > pollIntervalMs) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    let polled: StatusResponse | null;
    try {
      polled = await oneClick.status(depositAddress, depositMemo, { timeoutMs: remaining() });
    } catch (error) {
      if (error instanceof OneClickError) {
        break;
      }
      throw error;
    }
    if (polled === null) {
      break;
    }
    outcome = outcomeOf(polled, txHash);
  }
  return outcome;
}

/**
 * Bounds a call by the remaining attempt budget. A late answer is discarded.
 *
 * @param promise - The call
 * @param ms - Remaining budget in milliseconds
 * @returns The call's result
 */
function withinDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) {
    return Promise.reject(new DeadlineError("near-intents: settle window elapsed"));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new DeadlineError("near-intents: settle window elapsed")),
      ms,
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
