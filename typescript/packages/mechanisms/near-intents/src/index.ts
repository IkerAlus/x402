// Constants
export { ONE_CLICK_BASE_URL, ONE_CLICK_BLOCKCHAINS, SWAP_STATUSES } from "./constants";
export type { SwapStatus } from "./constants";

// Error reasons
export {
  ERROR_DEPOSIT_NOT_FOUND,
  ERROR_INSUFFICIENT_DEPOSIT,
  ERROR_OPERATION_EXECUTED,
  ERROR_PAYMENT_FAILED,
  ERROR_QUOTE_MISMATCH,
  ERROR_QUOTE_UNAVAILABLE,
  ERROR_TOKEN_EXPIRED,
  ERROR_TOKEN_INVALID,
} from "./errors";

// 1Click Swap API client, asset mapping, outcome mapping and dry-quote cache
export { createOneClickClient, OneClickError, OneClickUnavailableError } from "./oneclick/client";
export type {
  OneClickClient,
  OneClickConfig,
  QuoteRequest,
  QuoteResponse,
  StatusResponse,
  SubmitDepositRequest,
  Token,
} from "./oneclick/client";
export { findToken } from "./oneclick/assets";
export { outcomeOf } from "./oneclick/status";
export type { Outcome } from "./oneclick/status";
export { createDryQuoteCache } from "./oneclick/dryQuote";
export type { DryQuoteCache, DryQuoteCacheConfig } from "./oneclick/dryQuote";

// Operation token
export { checkOperationToken, destinationHash, issueOperationToken } from "./token";
export type { TokenCheck, TokenInput, TokenKeys } from "./token";

// Operation stores
export { InMemoryFacilitatorOperationStore, InMemoryServerOperationStore } from "./operationStore";
export type {
  FacilitatorOperationStore,
  ServerOperation,
  ServerOperationRecord,
  ServerOperationStore,
} from "./operationStore";

// Origin adapters (implementations live under `./origins/*` subpaths)
export type {
  DepositInstrument,
  DepositOrder,
  DepositReading,
  DepositTarget,
  OriginAdapter,
} from "./origins";

// Types
export type { DestinationTerms } from "./types";

// Utilities
export { normalizeTxHash, operationKey } from "./utils";
