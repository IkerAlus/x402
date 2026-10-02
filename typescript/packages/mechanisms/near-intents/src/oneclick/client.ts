import { z } from "zod";
import { ONE_CLICK_BASE_URL } from "../constants";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface OneClickConfig {
  /** API base URL. Defaults to {@link ONE_CLICK_BASE_URL}. */
  baseUrl?: string;
  /** Partner key or JWT, sent as `X-API-Key`. Unauthenticated quotes pay an extra fee. */
  apiKey?: string;
  /** Fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in milliseconds, covering headers and body. Defaults to 30 000. */
  timeoutMs?: number;
}

/** `POST /v0/quote` request body (the fields this mechanism uses). */
export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT";
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  originAsset: string;
  destinationAsset: string;
  /** Base units. Interpreted per `swapType`. */
  amount: string;
  recipient: string;
  refundTo: string;
  /** Basis points. */
  slippageTolerance: number;
  /** ISO 8601. The refund deadline. */
  deadline: string;
  depositMode?: "SIMPLE" | "MEMO";
  appFees?: { recipient: string; fee: number }[];
  referral?: string;
  quoteWaitingTimeMs?: number;
}

export interface SubmitDepositRequest {
  txHash: string;
  depositAddress: string;
  memo?: string;
}

const QuoteRequestEchoSchema = z.object({
  originAsset: z.string(),
  destinationAsset: z.string(),
  amount: z.string(),
  recipient: z.string(),
  refundTo: z.string(),
  deadline: z.string(),
  slippageTolerance: z.number().optional(),
});

const QuoteSchema = z.object({
  depositAddress: z.string().optional(),
  depositMemo: z.string().optional(),
  amountIn: z.string(),
  minAmountIn: z.string(),
  amountOut: z.string(),
  minAmountOut: z.string(),
  /** Time when the deposit address becomes inactive. Absent on dry quotes. */
  deadline: z.string().optional(),
  timeWhenInactive: z.string().optional(),
  timeEstimate: z.number(),
  refundFee: z.string().optional(),
});

const QuoteResponseSchema = z.object({
  correlationId: z.string().optional(),
  timestamp: z.string().optional(),
  signature: z.string().optional(),
  quoteRequest: QuoteRequestEchoSchema,
  quote: QuoteSchema,
});
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

const TransactionSchema = z.object({
  hash: z.string(),
  explorerUrl: z.string().optional(),
});

const SwapDetailsSchema = z.object({
  originChainTxHashes: z.array(TransactionSchema).default([]),
  destinationChainTxHashes: z.array(TransactionSchema).default([]),
  amountIn: z.string().optional(),
  amountOut: z.string().optional(),
  depositedAmount: z.string().optional(),
  refundedAmount: z.string().optional(),
  refundReason: z.string().optional(),
});

const StatusResponseSchema = z.object({
  /** Any string: see {@link SWAP_STATUSES} for the documented values. */
  status: z.string(),
  updatedAt: z.string().optional(),
  quoteResponse: QuoteResponseSchema,
  swapDetails: SwapDetailsSchema.default({}),
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

const TokenSchema = z.object({
  assetId: z.string(),
  decimals: z.number(),
  blockchain: z.string(),
  symbol: z.string(),
  /** Absent for chain-native assets. */
  contractAddress: z.string().optional(),
});
export type Token = z.infer<typeof TokenSchema>;
const TokensSchema = z.array(TokenSchema);

/**
 * The 1Click API answered with an application error (4xx) or an unusable body.
 */
export class OneClickError extends Error {
  /** HTTP status, or 0 when no response was received. */
  readonly status: number;
  readonly body: unknown;

  /**
   * Creates a 1Click API error.
   *
   * @param message - Human-readable description
   * @param options - HTTP status, response body and underlying cause
   * @param options.status - HTTP status of the response, when one was received
   * @param options.body - Parsed response body, when one was received
   * @param options.cause - Underlying error
   */
  constructor(message: string, options: { status?: number; body?: unknown; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OneClickError";
    this.status = options.status ?? 0;
    this.body = options.body;
  }
}

/**
 * The 1Click API was unreachable, timed out, answered 5xx, or its answer could not be read.
 * The outcome is unknown: callers must not treat it as a failed payment.
 */
export class OneClickUnavailableError extends OneClickError {
  /**
   * Creates a 1Click unavailability error.
   *
   * @param message - Human-readable description
   * @param options - HTTP status, response body and underlying cause
   * @param options.status - HTTP status of the response, when one was received
   * @param options.body - Parsed response body, when one was received
   * @param options.cause - Underlying error
   */
  constructor(message: string, options: { status?: number; body?: unknown; cause?: unknown } = {}) {
    super(message, options);
    this.name = "OneClickUnavailableError";
  }
}

export interface OneClickClient {
  /** `GET /v0/tokens`. */
  tokens(): Promise<Token[]>;
  /** `POST /v0/quote`. A wet quote (`dry: false`) mints a single-use deposit address. */
  quote(request: QuoteRequest): Promise<QuoteResponse>;
  /** `POST /v0/deposit/submit`. Speeds up deposit detection. */
  submitDeposit(request: SubmitDepositRequest): Promise<StatusResponse>;
  /** `GET /v0/status`. Resolves to `null` when the deposit address is unknown. */
  status(depositAddress: string, depositMemo?: string): Promise<StatusResponse | null>;
}

interface RawResponse {
  status: number;
  body: unknown;
}

/**
 * Builds a 1Click API client over `fetch`.
 *
 * @param config - Base URL, API key, fetch implementation and timeout
 * @returns Client for the four endpoints this mechanism uses
 */
export function createOneClickClient(config: OneClickConfig = {}): OneClickClient {
  return {
    async tokens() {
      const response = await call(config, "GET", "/v0/tokens");
      return parse(TokensSchema, expectOk(response, "GET /v0/tokens"), "tokens");
    },
    async quote(request) {
      const response = await call(config, "POST", "/v0/quote", { body: request });
      return parse(QuoteResponseSchema, expectOk(response, "POST /v0/quote"), "quote");
    },
    async submitDeposit(request) {
      const response = await call(config, "POST", "/v0/deposit/submit", { body: request });
      return parse(StatusResponseSchema, expectOk(response, "POST /v0/deposit/submit"), "status");
    },
    async status(depositAddress, depositMemo) {
      const response = await call(config, "GET", "/v0/status", {
        query: { depositAddress, ...(depositMemo !== undefined && { depositMemo }) },
      });
      if (response.status === 404) {
        return null;
      }
      return parse(StatusResponseSchema, expectOk(response, "GET /v0/status"), "status");
    },
  };
}

/**
 * Performs one HTTP call. Network failures, timeouts, 5xx and unreadable 2xx bodies become
 * {@link OneClickUnavailableError}; other statuses are returned for the caller to judge.
 *
 * @param config - Client configuration
 * @param method - HTTP method
 * @param path - Endpoint path
 * @param options - JSON body and query parameters
 * @param options.body - JSON-encoded request body
 * @param options.query - Query string parameters
 * @returns HTTP status and parsed JSON body (undefined when an error body is not JSON)
 */
async function call(
  config: OneClickConfig,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; query?: Record<string, string> } = {},
): Promise<RawResponse> {
  const fetchFn = config.fetch ?? globalThis.fetch;
  const url = new URL(path, config.baseUrl ?? ONE_CLICK_BASE_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetchFn(url, {
      method,
      headers: {
        accept: "application/json",
        ...(options.body !== undefined && { "content-type": "application/json" }),
        ...(config.apiKey !== undefined && { "x-api-key": config.apiKey }),
      },
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new OneClickUnavailableError(`1Click request failed: ${method} ${path}`, {
      cause: error,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (response.ok) {
      throw new OneClickUnavailableError(`1Click response could not be read: ${method} ${path}`, {
        status: response.status,
        cause: error,
      });
    }
    body = undefined;
  }
  if (response.status >= 500) {
    throw new OneClickUnavailableError(`1Click returned ${response.status} for ${method} ${path}`, {
      status: response.status,
      body,
    });
  }
  return { status: response.status, body };
}

/**
 * Rejects non-2xx responses with the 1Click error message.
 *
 * @param response - Raw HTTP outcome
 * @param label - Endpoint label for the error message
 * @returns The response body
 */
function expectOk(response: RawResponse, label: string): unknown {
  if (response.status < 200 || response.status >= 300) {
    throw new OneClickError(
      `1Click returned ${response.status} for ${label}: ${detailOf(response.body)}`,
      {
        status: response.status,
        body: response.body,
      },
    );
  }
  return response.body;
}

/**
 * Validates a response body against its schema.
 *
 * @param schema - Expected shape
 * @param value - Parsed JSON body
 * @param label - Endpoint label for the error message
 * @returns The validated value
 */
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new OneClickError(`1Click ${label} response has an unexpected shape`, {
      body: value,
      cause: result.error,
    });
  }
  return result.data;
}

/**
 * Extracts the `message` field 1Click puts on error bodies.
 *
 * @param body - Parsed response body
 * @returns The message, or a placeholder when absent
 */
function detailOf(body: unknown): string {
  if (body !== null && typeof body === "object" && "message" in body) {
    return String((body as { message: unknown }).message);
  }
  return "no response body";
}
