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
