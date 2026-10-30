import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  ASSET_TRANSFER_METHOD,
  DEFAULT_CLAIM_TTL_MS,
  DEFAULT_GRACE_SECONDS,
  DEFAULT_OBSERVATION_WINDOW_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_QUOTE_RATE_LIMIT,
  DEFAULT_SETTLE_WINDOW_MS,
  DEFAULT_SLIPPAGE_TOLERANCE,
  DEFAULT_TOKENS_TTL_MS,
} from "../../constants";
import type { OneClickClient, QuoteRequest, Token } from "../../oneclick/client";
import { InMemoryFacilitatorOperationStore } from "../../operationStore";
import type { FacilitatorOperationStore } from "../../operationStore";
import type { OriginAdapter } from "../../origins";
import { TokenBucket } from "../../rateLimit";
import type { RateLimit } from "../../rateLimit";
import { UnquotedExtraSchema } from "../../schemas";
import type { TokenKeys } from "../../token";
import type { DestinationTerms } from "../../types";

export interface ExactNearIntentsFacilitatorConfig {
  oneClick: OneClickClient;
  tokenKeys: TokenKeys;
  /** Origin adapters by CAIP-2 namespace (e.g. `eip155`). Each must implement `readDeposit`. */
  origins: Record<string, OriginAdapter>;
  /** Operation claims and recorded results. Defaults to an in-memory, single-process store. */
  operations?: FacilitatorOperationStore;
  /** Token grace after the refund deadline, in seconds. Defaults to 86 400. */
  graceSeconds?: number;
  /** Slippage range and default, in basis points. */
  slippageTolerance?: { min: number; max: number; default: number };
  /** 1Click `appFees` added to every quote. */
  appFees?: QuoteRequest["appFees"];
  /** 1Click `referral` added to every quote. */
  referral?: string;
  /** Polling budget of one `/settle`, in milliseconds. Defaults to 20 000. */
  settleWindowMs?: number;
  /** Interval between status polls, in milliseconds. Defaults to 2 000. */
  pollIntervalMs?: number;
  /** How long a transaction may stay unknown to the origin network. Defaults to 15 minutes. */
  observationWindowMs?: number;
  /** In-flight claim lifetime, in milliseconds. Defaults to 60 000. */
  claimTtlMs?: number;
  /** Quote rate limit per `refundTo` and per resource URL. */
  quoteRateLimit?: RateLimit;
  /** Lifetime of the cached token list, in milliseconds. Defaults to 10 minutes. */
  tokensTtlMs?: number;
}

type OptionalKeys = "appFees" | "referral";
export type ResolvedFacilitatorConfig = Required<
  Omit<ExactNearIntentsFacilitatorConfig, OptionalKeys>
> &
  Pick<ExactNearIntentsFacilitatorConfig, OptionalKeys>;

/** Facts shared by the quote and the settle paths after the structural checks. */
export type Inspection =
  | {
      ok: true;
      network: Network;
      asset: string;
      resource: string;
      destination: DestinationTerms;
      origin: OriginAdapter;
    }
  | { ok: false; reason: string; message: string };

export interface FacilitatorRuntime {
  readonly config: ResolvedFacilitatorConfig;
  /** Cached `GET /v0/tokens`. */
  tokens(): Promise<Token[]>;
  /** Takes one quote slot for the requester and one for the resource. */
  takeQuoteSlot(refundTo: string, resource: string): boolean;
  /** When `key` was first presented, recording now for a new key. */
  firstSeen(key: string): number;
  /** Structural checks shared by quote and deposit payloads (spec quote step 1, settle step 1). */
  inspect(payload: PaymentPayload, requirements: PaymentRequirements): Inspection;
}

/**
 * Resolves the configuration and builds the per-process state the scheme needs.
 *
 * @param config - Facilitator configuration
 * @returns The runtime
 */
export function createRuntime(config: ExactNearIntentsFacilitatorConfig): FacilitatorRuntime {
  for (const [namespace, origin] of Object.entries(config.origins)) {
    if (!origin.readDeposit) {
      throw new Error(`near-intents: origin adapter for "${namespace}" cannot read deposits`);
    }
  }
  const resolved: ResolvedFacilitatorConfig = {
    ...config,
    operations: config.operations ?? new InMemoryFacilitatorOperationStore(),
    graceSeconds: config.graceSeconds ?? DEFAULT_GRACE_SECONDS,
    slippageTolerance: config.slippageTolerance ?? DEFAULT_SLIPPAGE_TOLERANCE,
    settleWindowMs: config.settleWindowMs ?? DEFAULT_SETTLE_WINDOW_MS,
    pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    observationWindowMs: config.observationWindowMs ?? DEFAULT_OBSERVATION_WINDOW_MS,
    claimTtlMs: config.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS,
    quoteRateLimit: config.quoteRateLimit ?? DEFAULT_QUOTE_RATE_LIMIT,
    tokensTtlMs: config.tokensTtlMs ?? DEFAULT_TOKENS_TTL_MS,
  };
  const quoteSlots = new TokenBucket(resolved.quoteRateLimit);
  const seen = new Map<string, number>();
  let tokenList: { tokens: Token[]; fetchedAt: number } | undefined;
  let loading: Promise<Token[]> | undefined;

  return {
    config: resolved,
    tokens() {
      if (tokenList && Date.now() - tokenList.fetchedAt < resolved.tokensTtlMs) {
        return Promise.resolve(tokenList.tokens);
      }
      loading ??= resolved.oneClick
        .tokens()
        .then(tokens => {
          tokenList = { tokens, fetchedAt: Date.now() };
          return tokens;
        })
        .finally(() => {
          loading = undefined;
        });
      return loading;
    },
    takeQuoteSlot(refundTo, resource) {
      return quoteSlots.take(`refundTo:${refundTo}`) && quoteSlots.take(`resource:${resource}`);
    },
    firstSeen(key) {
      const now = Date.now();
      for (const [seenKey, at] of seen) {
        if (now - at >= 2 * resolved.observationWindowMs) {
          seen.delete(seenKey);
        }
      }
      const at = seen.get(key) ?? now;
      seen.set(key, at);
      return at;
    },
    inspect(payload, requirements) {
      return inspect(resolved.origins, payload, requirements);
    },
  };
}

/**
 * Runs the structural checks shared by both payload types.
 *
 * @param origins - Origin adapters by namespace
 * @param payload - Payment payload
 * @param requirements - The resource server's unquoted entry
 * @returns The shared facts, or the rejection
 */
function inspect(
  origins: Record<string, OriginAdapter>,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Inspection {
  if (payload.x402Version !== 2) {
    return { ok: false, reason: "invalid_x402_version", message: "x402Version must be 2" };
  }
  if (payload.accepted.scheme !== "exact" || requirements.scheme !== "exact") {
    return { ok: false, reason: "unsupported_scheme", message: "scheme must be exact" };
  }
  if (payload.accepted.extra?.assetTransferMethod !== ASSET_TRANSFER_METHOD) {
    return {
      ok: false,
      reason: "invalid_payload",
      message: `accepted.extra.assetTransferMethod must be ${ASSET_TRANSFER_METHOD}`,
    };
  }
  const resource = payload.resource?.url;
  if (!resource) {
    return { ok: false, reason: "invalid_payload", message: "resource.url is required" };
  }
  if (
    payload.accepted.network !== requirements.network ||
    payload.accepted.asset !== requirements.asset
  ) {
    return {
      ok: false,
      reason: "invalid_payload",
      message: "accepted.network and accepted.asset must equal the requirements",
    };
  }
  const extra = UnquotedExtraSchema.safeParse(requirements.extra);
  if (!extra.success) {
    return {
      ok: false,
      reason: "invalid_payload",
      message: "paymentRequirements.extra is not a near-intents entry",
    };
  }
  const origin = origins[requirements.network.split(":")[0]];
  if (!origin) {
    return {
      ok: false,
      reason: "invalid_network",
      message: `no origin adapter for ${requirements.network}`,
    };
  }
  return {
    ok: true,
    network: requirements.network,
    asset: requirements.asset,
    resource,
    destination: extra.data.destination,
    origin,
  };
}
