/** 1Click Swap API base URL. */
export const ONE_CLICK_BASE_URL = "https://1click.chaindefuser.com";

/**
 * `status` values 1Click documents for `GET /v0/status`. The live service can return values
 * outside this list (e.g. compliance holds), so callers must treat unknown values as unknown,
 * never as success.
 */
export const SWAP_STATUSES = [
  "KNOWN_DEPOSIT_TX",
  "PENDING_DEPOSIT",
  "INCOMPLETE_DEPOSIT",
  "PROCESSING",
  "SUCCESS",
  "REFUNDED",
  "FAILED",
] as const;
export type SwapStatus = (typeof SWAP_STATUSES)[number];

/** CAIP-2 network to the `blockchain` code 1Click uses in `GET /v0/tokens`. */
export const ONE_CLICK_BLOCKCHAINS: Readonly<Record<string, string>> = {
  "eip155:1": "eth",
  "eip155:10": "op",
  "eip155:56": "bsc",
  "eip155:100": "gnosis",
  "eip155:137": "pol",
  "eip155:143": "monad",
  "eip155:196": "xlayer",
  "eip155:8453": "base",
  "eip155:42161": "arb",
  "eip155:43114": "avax",
  "eip155:80094": "bera",
  "eip155:534352": "scroll",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "sol",
  "near:mainnet": "near",
};

/** `extra.assetTransferMethod` of this method. */
export const ASSET_TRANSFER_METHOD = "near-intents";

/** The only `paymentFlow` of this method. */
export const PAYMENT_FLOW = "upfront";

/** Smallest operation-token grace after the refund deadline the spec allows: 24 h. */
export const MIN_GRACE_SECONDS = 86_400;

/** Operation-token grace after the refund deadline, in seconds. */
export const DEFAULT_GRACE_SECONDS = MIN_GRACE_SECONDS;

/** Slippage tolerance range and default published in `/supported`, in basis points. */
export const DEFAULT_SLIPPAGE_TOLERANCE = { min: 10, max: 300, default: 50 };

/** Polling budget of one `/settle` call, under the facilitator HTTP client's 90 s timeout. */
export const DEFAULT_SETTLE_WINDOW_MS = 20_000;

/** Interval between `GET /v0/status` polls inside the settle window. */
export const DEFAULT_POLL_INTERVAL_MS = 2_000;

/** How long a transaction may stay unknown to the origin network before it is rejected. */
export const DEFAULT_OBSERVATION_WINDOW_MS = 900_000;

/** In-flight claim lifetime; an attempt that outlives its claim does not record a result. */
export const DEFAULT_CLAIM_TTL_MS = 60_000;

/** Lifetime of the cached `GET /v0/tokens` list. */
export const DEFAULT_TOKENS_TTL_MS = 600_000;

/** Quote rate limit, applied per `refundTo` and per resource URL. */
export const DEFAULT_QUOTE_RATE_LIMIT = { capacity: 10, refillPerMinute: 10 };
