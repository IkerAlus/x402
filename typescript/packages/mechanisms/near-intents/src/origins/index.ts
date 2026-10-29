import type { FindDefaultAsset } from "@x402/core/types";

/** A 1Click deposit instrument: the address, and the memo where the origin network needs one. */
export interface DepositInstrument {
  /** CAIP-2 origin network. */
  network: string;
  depositAddress: string;
  depositMemo?: string;
}

/** An instrument together with the asset it must receive. */
export interface DepositTarget extends DepositInstrument {
  /** Asset in the origin network's x402 identifier. */
  asset: string;
}

/** A deposit the client has to make. */
export interface DepositOrder extends DepositTarget {
  /** Base units of `asset`. */
  amount: string;
}

/** What the facilitator learns about a presented transaction. */
export type DepositReading =
  | { state: "unknown" }
  | { state: "pending" }
  | { state: "confirmed-no-match" }
  | { state: "confirmed"; payer: string };

/**
 * Origin-network behaviour of this method, keyed by CAIP-2 namespace. `readDeposit` serves
 * the facilitator, `sendDeposit` the client; a deployment supplies what its role needs.
 */
export interface OriginAdapter {
  /** Reverse lookup for core's USD spend caps. */
  findDefaultAsset?: FindDefaultAsset;

  /**
   * Whether `address` is well-formed for the namespace.
   *
   * @param address - Address as presented
   * @returns `true` when well-formed
   */
  isAddress(address: string): boolean;

  /**
   * Whether `hash` is a well-formed transaction hash for the namespace.
   *
   * @param hash - Hash as presented
   * @returns `true` when well-formed
   */
  isTxHash(hash: string): boolean;

  /**
   * Reads whether `txHash` is a confirmed transfer of the target's asset to its instrument.
   * `txHash` must already satisfy `isTxHash`.
   *
   * @param target - Instrument and asset
   * @param txHash - Transaction to read
   * @returns The reading
   */
  readDeposit?(target: DepositTarget, txHash: string): Promise<DepositReading>;

  /**
   * Transfers the order's amount to its instrument. `onBroadcast` fires with the hash as soon
   * as the transaction is sent, so the caller can persist it before the confirmation wait;
   * the returned hash is the one that confirmed, which differs when the wallet replaced the
   * transaction, or is the broadcast hash when confirmation timed out.
   *
   * @param order - Instrument, asset and amount
   * @param onBroadcast - Called with the broadcast hash before waiting for confirmation
   * @returns The hash to present
   */
  sendDeposit?(
    order: DepositOrder,
    onBroadcast?: (txHash: string) => void | Promise<void>,
  ): Promise<{ txHash: string }>;
}
