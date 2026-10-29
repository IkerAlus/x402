import type { OneClickClient, QuoteRequest } from "./client";

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_STALE_MS = 600_000;

export interface DryQuoteCacheConfig {
  oneClick: OneClickClient;
  /** Age below which a cached amount is served without a refresh. Defaults to 60 000. */
  ttlMs?: number;
  /** Age below which a cached amount is still served while a refresh runs. Defaults to 600 000. */
  staleMs?: number;
}

export interface DryQuoteCache {
  /**
   * Indicative `amountIn` for the request, from a `dry: true` quote. Keyed by origin asset,
   * destination asset, amount and slippage; the other fields only shape the request sent.
   *
   * @param request - Quote request without `dry`
   * @returns The indicative amount in base units of the origin asset
   */
  indicativeAmount(request: Omit<QuoteRequest, "dry">): Promise<string>;
}

/**
 * Caches dry quotes for `extra.indicativeAmount`: fresh entries are served as is, stale
 * entries are served while one refresh runs in the background, and a failed refresh keeps
 * the stale value until the stale window passes.
 *
 * @param config - 1Click client and cache windows
 * @returns The cache
 */
export function createDryQuoteCache(config: DryQuoteCacheConfig): DryQuoteCache {
  const ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
  const staleMs = config.staleMs ?? DEFAULT_STALE_MS;
  const entries = new Map<string, { amountIn: string; fetchedAt: number }>();
  const inFlight = new Map<string, Promise<string>>();

  const load = (key: string, request: Omit<QuoteRequest, "dry">): Promise<string> => {
    const running = inFlight.get(key);
    if (running) {
      return running;
    }
    const pending = config.oneClick
      .quote({ ...request, dry: true })
      .then(response => {
        entries.set(key, { amountIn: response.quote.amountIn, fetchedAt: Date.now() });
        return response.quote.amountIn;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  };

  return {
    async indicativeAmount(request) {
      const { originAsset, destinationAsset, amount, slippageTolerance } = request;
      const key = `${originAsset}|${destinationAsset}|${amount}|${slippageTolerance}`;
      const now = Date.now();
      for (const [staleKey, entry] of entries) {
        if (now - entry.fetchedAt >= staleMs) {
          entries.delete(staleKey);
        }
      }
      const entry = entries.get(key);
      if (entry && now - entry.fetchedAt < ttlMs) {
        return entry.amountIn;
      }
      const refresh = load(key, request);
      if (entry) {
        refresh.catch(() => undefined);
        return entry.amountIn;
      }
      return refresh;
    },
  };
}
