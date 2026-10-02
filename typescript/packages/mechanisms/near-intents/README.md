# @x402/near-intents

TypeScript implementation of the `near-intents` asset transfer method for the x402 `exact` scheme: a client pays a source asset on any origin network 1Click supports into a single-use deposit address, and the merchant receives an exact amount of a destination asset on its own network. Spec: [`specs/schemes/exact/scheme_exact_nearintents.md`](../../../../specs/schemes/exact/scheme_exact_nearintents.md) (PR #3370, under review).

Work in progress. Currently shipped:

- `createOneClickClient` — thin typed client for the four 1Click Swap API endpoints the method uses (`/v0/tokens`, `/v0/quote`, `/v0/deposit/submit`, `/v0/status`), authenticated with `X-API-Key`.

Client, resource-server and facilitator schemes follow once the spec settles.
