import type { Token } from "../../../src/oneclick/client";

/** Token entries shaped like live `GET /v0/tokens` data (2026-09). */
export const defaultTokens: Token[] = [
  {
    assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    decimals: 6,
    blockchain: "arb",
    symbol: "USDC",
    contractAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  },
  {
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    decimals: 6,
    blockchain: "base",
    symbol: "USDC",
    contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  { assetId: "nep141:arb.omft.near", decimals: 18, blockchain: "arb", symbol: "ETH" },
  {
    assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    decimals: 6,
    blockchain: "sol",
    symbol: "USDC",
    contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  {
    assetId: "nep141:wrap.near",
    decimals: 24,
    blockchain: "near",
    symbol: "wNEAR",
    contractAddress: "wrap.near",
  },
];

export interface FakeQuote {
  depositAddress: string;
  depositMemo?: string;
  quoteRequest: Record<string, unknown>;
  quote: Record<string, unknown>;
  /** Any string, like the live service: documented values or undocumented ones. */
  status: string;
  submittedTxHashes: string[];
  swapDetails: Record<string, unknown>;
}

export interface FakeRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeOneClick {
  /** Pass as `fetch` to the client under test. */
  fetch: typeof globalThis.fetch;
  requests: FakeRequest[];
  /** Minted wet quotes by deposit address. */
  quotes: Map<string, FakeQuote>;
  tokens: Token[];
  /** Answers the next `n` requests with HTTP 500. */
  failNextRequests(n: number): void;
  /** Overrides fields of the next wet quote (e.g. `depositMemo`). */
  nextQuote(overrides: Record<string, unknown>): void;
  /** Moves a quote to `status` and merges `swapDetails` overrides. */
  setStatus(depositAddress: string, status: string, swapDetails?: Record<string, unknown>): void;
}

/**
 * In-memory stand-in for the four 1Click endpoints this mechanism uses, exposed as a
 * `fetch` function so the real client code path (URL, headers, parsing) is exercised.
 * Pricing is deterministic: 1:1 rate, `amountIn` = `amount` plus the slippage buffer.
 *
 * @param options - Token list override
 * @param options.tokens - Tokens served by `GET /v0/tokens`
 * @returns The fake and its inspection handles
 */
export function createFakeOneClick(options: { tokens?: Token[] } = {}): FakeOneClick {
  const tokens = options.tokens ?? defaultTokens;
  const quotes = new Map<string, FakeQuote>();
  const requests: FakeRequest[] = [];
  let failCount = 0;
  let mintCounter = 0;
  let nextOverrides: Record<string, unknown> = {};

  const json = (status: number, payload: unknown): Response =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });

  const statusPayload = (q: FakeQuote): unknown => ({
    correlationId: "fake",
    status: q.status,
    updatedAt: new Date(0).toISOString(),
    quoteResponse: { quoteRequest: q.quoteRequest, quote: q.quote, signature: "fake-sig" },
    swapDetails: {
      originChainTxHashes: q.submittedTxHashes.map(hash => ({ hash })),
      destinationChainTxHashes:
        q.status === "SUCCESS" ? [{ hash: `0xdest${q.depositAddress.slice(2)}` }] : [],
      ...q.swapDetails,
    },
  });

  const handle = (request: FakeRequest): Response => {
    if (failCount > 0) {
      failCount -= 1;
      return json(500, { message: "fake internal error" });
    }
    if (request.method === "GET" && request.path === "/v0/tokens") {
      return json(200, tokens);
    }
    if (request.method === "POST" && request.path === "/v0/quote") {
      const body = request.body as Record<string, unknown>;
      const amount = BigInt(String(body.amount ?? "0"));
      const slippage = BigInt(Number(body.slippageTolerance ?? 0));
      const amountIn = (amount * (10_000n + slippage) + 9_999n) / 10_000n;
      const quote: Record<string, unknown> = {
        amountIn: amountIn.toString(),
        minAmountIn: amount.toString(),
        amountOut: amount.toString(),
        minAmountOut: amount.toString(),
        timeEstimate: 60,
        refundFee: "0",
      };
      if (body.dry === true) {
        return json(200, { quoteRequest: body, quote });
      }
      mintCounter += 1;
      const depositAddress = `0x${mintCounter.toString(16).padStart(40, "0")}`;
      const minted: FakeQuote = {
        depositAddress,
        quoteRequest: body,
        quote: {
          ...quote,
          depositAddress,
          ...(body.depositMode === "MEMO" && { depositMemo: `${mintCounter}` }),
          deadline: new Date(Date.parse(String(body.deadline)) + 3 * 86_400_000).toISOString(),
          ...nextOverrides,
        },
        status: "PENDING_DEPOSIT",
        submittedTxHashes: [],
        swapDetails: {},
      };
      if (typeof minted.quote.depositMemo === "string") {
        minted.depositMemo = minted.quote.depositMemo;
      }
      nextOverrides = {};
      quotes.set(String(minted.quote.depositAddress), minted);
      return json(200, {
        correlationId: "fake",
        timestamp: new Date(0).toISOString(),
        signature: "fake-sig",
        quoteRequest: body,
        quote: minted.quote,
      });
    }
    if (request.method === "POST" && request.path === "/v0/deposit/submit") {
      const body = request.body as { txHash?: string; depositAddress?: string };
      const q = quotes.get(String(body.depositAddress));
      if (!q || typeof body.txHash !== "string") {
        return json(404, { message: "Deposit address not found" });
      }
      q.submittedTxHashes.push(body.txHash);
      if (q.status === "PENDING_DEPOSIT") {
        q.status = "KNOWN_DEPOSIT_TX";
      }
      return json(200, statusPayload(q));
    }
    if (request.method === "GET" && request.path === "/v0/status") {
      const q = quotes.get(request.query.depositAddress ?? "");
      if (!q || (q.depositMemo !== undefined && request.query.depositMemo !== q.depositMemo)) {
        return json(404, { message: "Deposit address not found" });
      }
      return json(200, statusPayload(q));
    }
    return json(404, { message: `no route for ${request.method} ${request.path}` });
  };

  const fetchFn: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const request: FakeRequest = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    return handle(request);
  };

  return {
    fetch: fetchFn,
    requests,
    quotes,
    tokens,
    failNextRequests(n) {
      failCount = n;
    },
    nextQuote(overrides) {
      nextOverrides = overrides;
    },
    setStatus(depositAddress, status, swapDetails = {}) {
      const q = quotes.get(depositAddress);
      if (!q) {
        throw new Error(`fake 1Click: unknown deposit address ${depositAddress}`);
      }
      q.status = status;
      q.swapDetails = { ...q.swapDetails, ...swapDetails };
    },
  };
}
