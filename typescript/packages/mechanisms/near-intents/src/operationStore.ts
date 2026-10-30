import { randomUUID } from "node:crypto";
import type { PaymentRequirements, SettleResponse } from "@x402/core/types";

/**
 * Facilitator-side state of an operation, keyed by `operationKey`: an in-flight claim while
 * one settle attempt works on it, then the single recorded result. A claim is owned: only
 * the attempt holding the returned claim id can release it or record through it, and a
 * lapsed claim records nothing. Multi-instance facilitators must supply a shared
 * implementation whose `claim` and `record` are atomic.
 */
export interface FacilitatorOperationStore {
  /**
   * Returns the recorded result, if the operation reached a terminal outcome.
   *
   * @param key - Operation key
   * @returns The recorded settlement response, or `undefined`
   */
  get(key: string): Promise<SettleResponse | undefined>;

  /**
   * Takes the in-flight claim. Fails when another attempt holds an unexpired claim or a
   * result is already recorded.
   *
   * @param key - Operation key
   * @param expiresAt - Unix time in milliseconds after which the claim lapses
   * @returns The claim id to pass to `release` and `record`, or `undefined`
   */
  claim(key: string, expiresAt: number): Promise<string | undefined>;

  /**
   * Drops the claim if `claimId` still holds it. A lapsed or superseded claim is left alone.
   *
   * @param key - Operation key
   * @param claimId - Id returned by `claim`
   */
  release(key: string, claimId: string): Promise<void>;

  /**
   * Records the terminal result and drops the claim, if `claimId` still holds an unexpired
   * claim. Otherwise records nothing.
   *
   * @param key - Operation key
   * @param claimId - Id returned by `claim`
   * @param response - Settlement response to return to every later presentation
   * @param retainUntil - Unix time in milliseconds until which the record is kept
   * @returns `true` when the result was recorded
   */
  record(
    key: string,
    claimId: string,
    response: SettleResponse,
    retainUntil: number,
  ): Promise<boolean>;
}

/**
 * Per-process {@link FacilitatorOperationStore}. Node.js is single-threaded and the
 * check-and-set in `claim` and `record` has no `await`, so both are atomic within one
 * process. Multi-instance facilitators need a shared implementation (e.g. Redis).
 */
export class InMemoryFacilitatorOperationStore implements FacilitatorOperationStore {
  private readonly claims = new Map<string, { id: string; expiresAt: number }>();
  private readonly records = new Map<string, { response: SettleResponse; retainUntil: number }>();

  /**
   * Returns the recorded result, if any.
   *
   * @param key - Operation key
   * @returns The recorded settlement response, or `undefined`
   */
  async get(key: string): Promise<SettleResponse | undefined> {
    this.prune();
    return this.records.get(key)?.response;
  }

  /**
   * Takes the in-flight claim.
   *
   * @param key - Operation key
   * @param expiresAt - Unix time in milliseconds after which the claim lapses
   * @returns The claim id, or `undefined` when the operation is claimed or recorded
   */
  async claim(key: string, expiresAt: number): Promise<string | undefined> {
    this.prune();
    if (this.records.has(key) || this.claims.has(key)) {
      return undefined;
    }
    const id = randomUUID();
    this.claims.set(key, { id, expiresAt });
    return id;
  }

  /**
   * Drops the claim if `claimId` still holds it.
   *
   * @param key - Operation key
   * @param claimId - Id returned by `claim`
   */
  async release(key: string, claimId: string): Promise<void> {
    if (this.claims.get(key)?.id === claimId) {
      this.claims.delete(key);
    }
  }

  /**
   * Records the terminal result if `claimId` still holds an unexpired claim.
   *
   * @param key - Operation key
   * @param claimId - Id returned by `claim`
   * @param response - Settlement response
   * @param retainUntil - Unix time in milliseconds until which the record is kept
   * @returns `true` when the result was recorded
   */
  async record(
    key: string,
    claimId: string,
    response: SettleResponse,
    retainUntil: number,
  ): Promise<boolean> {
    this.prune();
    if (this.claims.get(key)?.id !== claimId) {
      return false;
    }
    this.claims.delete(key);
    this.records.set(key, { response, retainUntil });
    return true;
  }

  /**
   * Drops lapsed claims and records past their retention.
   */
  private prune(): void {
    const now = Date.now();
    for (const [key, claim] of this.claims) {
      if (claim.expiresAt <= now) {
        this.claims.delete(key);
      }
    }
    for (const [key, record] of this.records) {
      if (record.retainUntil <= now) {
        this.records.delete(key);
      }
    }
  }
}

/** What the resource server keeps per quoted operation. */
export interface ServerOperation {
  /** The unquoted entry the operation was quoted from. Settlement uses it, not the echoed `accepted`. */
  requirements: PaymentRequirements;
  /** Identifier of the facilitator that minted the quote. */
  facilitator: string;
}

export interface ServerOperationRecord extends ServerOperation {
  /** Whether the route handler already ran for this operation. */
  executed: boolean;
}

/**
 * Resource-server-side record of quoted operations, keyed by `operationKey`. Multi-instance
 * servers must supply a shared implementation; `markExecuted` must be atomic.
 */
export interface ServerOperationStore {
  /**
   * Stores a freshly quoted operation.
   *
   * @param key - Operation key
   * @param operation - The quoted entry and the facilitator that quoted it
   * @param retainUntil - Unix time in milliseconds until which the record is kept
   */
  put(key: string, operation: ServerOperation, retainUntil: number): Promise<void>;

  /**
   * Returns the record, if the operation is known and still retained.
   *
   * @param key - Operation key
   * @returns The record, or `undefined`
   */
  get(key: string): Promise<ServerOperationRecord | undefined>;

  /**
   * Marks the operation executed.
   *
   * @param key - Operation key
   * @returns `true` when this call made the mark; `false` when it was already executed or is unknown
   */
  markExecuted(key: string): Promise<boolean>;
}

/**
 * Per-process {@link ServerOperationStore}; `markExecuted` is atomic within one process.
 * Multi-instance servers need a shared implementation.
 */
export class InMemoryServerOperationStore implements ServerOperationStore {
  private readonly records = new Map<
    string,
    { record: ServerOperationRecord; retainUntil: number }
  >();

  /**
   * Stores a freshly quoted operation.
   *
   * @param key - Operation key
   * @param operation - The quoted entry and the facilitator that quoted it
   * @param retainUntil - Unix time in milliseconds until which the record is kept
   */
  async put(key: string, operation: ServerOperation, retainUntil: number): Promise<void> {
    this.records.set(key, { record: { ...operation, executed: false }, retainUntil });
  }

  /**
   * Returns the record, if any.
   *
   * @param key - Operation key
   * @returns The record, or `undefined`
   */
  async get(key: string): Promise<ServerOperationRecord | undefined> {
    this.prune();
    return this.records.get(key)?.record;
  }

  /**
   * Marks the operation executed.
   *
   * @param key - Operation key
   * @returns `true` when this call made the mark
   */
  async markExecuted(key: string): Promise<boolean> {
    this.prune();
    const record = this.records.get(key)?.record;
    if (!record || record.executed) {
      return false;
    }
    record.executed = true;
    return true;
  }

  /**
   * Drops records past their retention.
   */
  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.records) {
      if (entry.retainUntil <= now) {
        this.records.delete(key);
      }
    }
  }
}
