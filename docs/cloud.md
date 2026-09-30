# Dalliance Cloud

Dalliance Cloud is an optional, hosted way to run models: sign in with a Dalliance account and use its plan's credits instead of an API key. The service itself (accounts, billing and the model proxy) is a separate, private product. This repo only has the client for it, in `apps/desktop/electron/cloud/`, and everything else works without it.

## The switch

The client runs only in builds made with `DALLIANCE_CLOUD_URL` set to the service's origin, like `https://cloud.dalliance.io`.

- `vite.config.ts` bakes it into the main process as `__DALLIANCE_CLOUD_URL__`. `turbo.json` lists it in the build's `env`, so changing it rebuilds.
- The release workflow reads it from the repository variable of the same name. Forks without the variable build the app on the user's own key.
- Development builds can set it in `apps/desktop/.env`, for example to a local copy of the service. Packaged builds ignore the environment.

`cloudUrl()` in `electron/cloud/config.ts` reads it. With no URL, `main.ts` makes no `Account` or `Billing`, never registers the `io.dalliance.app` scheme, and answers the account and billing calls as signed out and unavailable. `SettingsView.cloud` is false, so the renderer hides the Dalliance Cloud provider and the Account section.

## Pieces

| Piece | Code | Does |
| --- | --- | --- |
| Config | `electron/cloud/config.ts` | The switch, `/api/config`, and reading sign-in links |
| Account | `electron/cloud/account.ts` | Better Auth's Electron client, in the main process only. Sign-in, the session and the Convex token |
| Billing | `electron/cloud/billing.ts` | A Convex client that follows the plan live, and counts a run's credits for Show costs |
| Models | `cloudGateway()` in `electron/harness/model.ts` | The gateway provider pointed at the service's model proxy |
| Renderer | `src/components/cloud/CloudStatus.tsx`, `src/components/settings/AccountSettings.tsx`, `src/lib/cloud.ts` | The account line under the provider, and the Account section of Settings |

## Startup

1. `main.ts` makes `Account` with the Cloud URL. Its session comes from `account.json` in userData, which the plugin encrypts with `safeStorage`.
2. `watchCloud()` refreshes the session, sends every account and plan change to every tab (the account is the app's, not a tab's), and calls `Billing.connect()`, which asks `<cloud>/api/config` for the Convex deployment's URL. A failure retries every 30 seconds and shows as the plan's `error`. Keeping the deployment URL behind the service means moving it never needs an app release.
3. `Billing` subscribes to `billing:plans` and `billing:status`. It follows the account: signed in, each query carries a Convex JWT from `/api/auth/convex/token`, cached in `Account` until a minute before it expires.

## Signing in

`signIn()` opens `<cloud>/sign-in` in the browser with a PKCE challenge. The page sends the browser back to `io.dalliance.app://auth/callback#token=<code>`, and only this process holds the verifier that redeems the code.

The scheme and the single-instance lock stay `main.ts`'s, so the plugin's `setupMain()` runs with `scheme: false`, `bridges: false` and `csp: false`. `main.ts` registers the scheme with `setAsDefaultProtocolClient()`, and hands links to `openLink()`:

- On macOS they arrive as `open-url`, registered before `ready`.
- On Windows and Linux they arrive on a second launch's command line, through `second-instance`, or on the first launch's. `deepLinkFromArgv()` finds them.

`Account.handleLink()` only tries a sign-in link while a sign-in is pending, so a page that opens the scheme can't do anything or put an error in Settings. `signInCode()` accepts exactly `io.dalliance.app://auth/callback#token=`, the form the plugin itself reads. `io.dalliance.app://billing`, from the page after checkout, only brings the window forward.

When the browser can't open the app, the page shows the code, and Settings > Account takes it. That only works in the same run of the app, since the verifier lives in memory.

Packaged builds register the scheme through `protocols` in the electron-builder config. In development every checkout's Electron binary has the same bundle id, so macOS may hand the link to another copy. The code field still works then.

## Models

`provider: 'cloud'` is a third provider beside `gateway` and `anthropic`. `KeyProvider` is the two that take a key. `SettingsStore.setCloud()` gives it a `CloudAccess`: the proxy's URL, whether someone is signed in, and the token fetcher.

- `resolveModel()` builds the AI Gateway provider on `<cloud>/api/ai`, with a custom `fetch` that puts a fresh Convex JWT on every request. Signed out, it throws a `ModelSetupError` before the run starts, and the session shows its message.
- `agentProviderOptions()` works as it does for the gateway, since Cloud models use gateway ids like `anthropic/claude-sonnet-5.5`. So, like the gateway, it sends no refusal fallback. See [agent-harness.md](agent-harness.md#models-and-providers).
- `titleModel()` uses `openai/gpt-6-luna` through the same proxy.
- `listModels()` lists the gateway's models through the proxy, without dollar prices, because the plan pays in credits.

The proxy checks the plan before each call and records its cost afterwards. Refusals come back in the gateway's error shape with the type `dalliance_account`: signed out, no plan, out of credits, or a model it doesn't offer. The gateway provider wraps that unknown type in a generic error, so `friendlyError()` reads the proxy's own response from the error's cause and shows its message as written, never as a rejected key.

### Zero data retention

Every model call through Dalliance Cloud runs with zero data retention. The proxy enforces it, not the app: it sets the gateway's `zeroDataRetention` flag on every call, overwriting whatever the app sent, and only offers models with a zero-data-retention provider. Its model list leaves the others out, and a call to one is refused with 403. So the app sends no flag of its own, and there's no setting for it.

- `loadModels()` in the store moves a saved Cloud model the list doesn't offer, typed in or saved before the list changed, back to the default, and says so in a notice.
- The own-key routes, AI Gateway and Anthropic, run on the user's own agreements with those providers. Their full model lists stay, and the provider line says: "With your own key, data retention depends on your agreement with the provider." `OWN_KEY_RETENTION` and `CLOUD_RETENTION` in `src/lib/keys.ts` hold the wording. Never let copy claim zero data retention for an own-key route.
- On a direct Anthropic key, a model that needs data retention fails with a 400 when the key's organization has zero data retention. `friendlyError()` turns that into a message that says so.
- The agent sends no refusal fallback on Cloud. The gateway drops the option today, and the model Anthropic picks for `fallbacks: 'default'` isn't published, so it couldn't be held to the list. A fallback on Cloud would need an explicit list of models the proxy offers.
- Zero data retention is not a HIPAA business associate agreement. Don't word it as one.

A settings file that chose `cloud`, opened by a build without it, reads as `gateway` with that provider's default model, and the choice comes back in a build that has it.

## Credits per run

With Show costs on, the Activity pane shows the credits each run used on Dalliance Cloud, counted for every run so turning it on shows earlier ones too, and never dollars, since the plan pays in credits. Each step of a run keeps the gateway's generation id, which the proxy passes through, and the run's cost names those ids. `countCredits()` asks `Billing.credits()`, which subscribes to the service's `usage:credits` query with them. The service answers for the signed-in user's own calls only. Each call's row lands a few seconds after the call, so the subscription stays open until every id is there, or 90 seconds pass, and then closes. See [agent-harness.md](agent-harness.md#costs).

## What the service promises

The app relies on the service's pages, endpoints, deep links and Convex functions staying compatible, since released copies can't be updated. The service's repo lists them as its app contract. The shapes of `PlanOption`, `SubscriptionView` and `BillingView` in `packages/shared/src/ipc.ts` mirror what `billing:plans` and `billing:status` return, and `Billing.credits()` reads `usage:credits` as a list of `{ generationId, credits }`.

## Security

- The session, its cookie and the Convex token never leave the main process. The renderer gets `AccountView` and `BillingView` only.
- `startCheckout()` only takes the plan key `pro`. `redeemSignInCode()` only takes a string.
- Checkout and the billing portal open in the default browser. Card details never pass through the app.
