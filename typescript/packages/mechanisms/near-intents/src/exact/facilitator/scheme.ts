import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { quote } from "./quote";
import { createRuntime } from "./runtime";
import type { ExactNearIntentsFacilitatorConfig, FacilitatorRuntime } from "./runtime";
import { settle } from "./settle";

/**
 * Facilitator side of the `near-intents` asset transfer method for the `exact` scheme.
 * `verify` mints a 1Click quote for a `quote` payload; `settle` redeems a `deposit` payload.
 * Register it once per concrete origin network.
 */
export class ExactNearIntentsScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "near-intents:*";

  private readonly runtime: FacilitatorRuntime;

  /**
   * Creates the facilitator scheme.
   *
   * @param config - 1Click client, token keys, origin adapters and tuning
   */
  constructor(config: ExactNearIntentsFacilitatorConfig) {
    this.runtime = createRuntime(config);
  }

  /**
   * Publishes the permitted slippage range and default (spec, Slippage).
   *
   * @param _ - Unused; the range is the same for every origin
   * @returns `{ slippageTolerance: { min, max, default } }`
   */
  getExtra(_: Network): Record<string, unknown> {
    return { slippageTolerance: { ...this.runtime.config.slippageTolerance } };
  }

  /**
   * This method holds no funds and signs nothing.
   *
   * @param _ - Unused
   * @returns An empty list
   */
  getSigners(_: string): string[] {
    return [];
  }

  /**
   * Mints a quote for a `quote` payload.
   *
   * @param payload - Payment payload
   * @param requirements - The resource server's unquoted entry
   * @returns The quote in `extra`, or the rejection
   */
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return quote(this.runtime, payload, requirements);
  }

  /**
   * Redeems a `deposit` payload.
   *
   * @param payload - Payment payload
   * @param requirements - The resource server's recorded unquoted entry
   * @returns The settlement receipt
   */
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    return settle(this.runtime, payload, requirements);
  }
}
