// Error reasons from the spec's error table. Core's `settlement_pending` is used unchanged.

/** 1Click returned no quote for the requested entry. */
export const ERROR_QUOTE_UNAVAILABLE = "invalid_exact_near_intents_quote_unavailable";
/** The operation token does not verify, or its key id is unknown. */
export const ERROR_TOKEN_INVALID = "invalid_exact_near_intents_token_invalid";
/** The operation token is past its expiry. */
export const ERROR_TOKEN_EXPIRED = "invalid_exact_near_intents_token_expired";
/** 1Click's `quoteRequest` does not match the server's destination terms. */
export const ERROR_QUOTE_MISMATCH = "invalid_exact_near_intents_quote_mismatch";
/** `txHash` does not pay the instrument. Never recorded: another transaction may be presented. */
export const ERROR_DEPOSIT_NOT_FOUND = "invalid_exact_near_intents_deposit_not_found";
/** Refunded because the deposit was partial. */
export const ERROR_INSUFFICIENT_DEPOSIT = "exact_near_intents_insufficient_deposit";
/** No delivery. */
export const ERROR_PAYMENT_FAILED = "exact_near_intents_payment_failed";
/** The resource server already executed this operation. */
export const ERROR_OPERATION_EXECUTED = "exact_near_intents_operation_executed";
