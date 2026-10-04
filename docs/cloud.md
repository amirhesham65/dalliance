# Dalliance Cloud

Dalliance Cloud is how the app runs models. The user signs in with a Dalliance account, and every model call goes through the service's proxy on that account's plan, paid in credits. There are no API keys in the app and no other route to a model.

All of it lives in this repo:

| Part | Code | Does |
| --- | --- | --- |
| The app's client | `apps/desktop/electron/cloud/`, `cloudGateway()` in `electron/harness/model.ts` | Signs in, follows the plan, runs models through the proxy, counts credits for Show costs |
| The cloud site | `apps/cloud`, `@dalliance/cloud` | cloud.dalliance.io: the sign-in and billing pages, `/api/auth/*` proxied to Convex, the model proxy at `/api/ai/*` with zero data retention, and `/api/config`. Next.js 16 on port 3200 |
| The backend | `packages/backend`, `@dalliance/backend` | Convex: Better Auth accounts, Polar billing, and the usage ledger behind the credits |
| The contract | `packages/shared/src/cloud.ts`, `packages/shared/src/cloud-api.ts` | The names, constants and shapes all three sides import. See [The contract](#the-contract) |

This page covers the app's side and the contract. [accounts.md](accounts.md) covers signing in on the service's side, [billing.md](billing.md) the plan, the proxy and the ledger, and [deploying.md](deploying.md) shipping the site and the backend.

## Where the app finds it

`cloudUrl(packaged)` in `electron/cloud/config.ts` returns `https://cloud.dalliance.io`. A development build can point at another copy, like the cloud site running on `http://localhost:3200`, with `DALLIANCE_CLOUD_URL` in `apps/desktop/.env`. `main.ts` loads that file only in development, and packaged builds ignore the variable. Nothing about the service is baked in at build time.

`main.ts` always creates `Account` and `Billing`, and always registers the `io.dalliance.app` scheme.

## Pieces

| Piece | Code | Does |
| --- | --- | --- |
| Config | `electron/cloud/config.ts` | The Cloud URL, `/api/config`, and reading sign-in links |
| Account | `electron/cloud/account.ts` | Better Auth's Electron client, in the main process only. Sign-in, the session and the Convex token |
| Billing | `electron/cloud/billing.ts` | A Convex client that follows the plan live, and counts a run's credits for Show costs. Calls the backend through `cloudApi` |
| Models | `cloudGateway()` in `electron/harness/model.ts` | The gateway provider pointed at the service's model proxy |
| Renderer | `src/components/cloud/CloudStatus.tsx`, `src/components/settings/AccountSettings.tsx`, `src/lib/cloud.ts` | The account and the plan in Settings and in the first-run setup |

## Startup

1. `main.ts` makes `Account` with the Cloud URL. Its session comes from `account.json` in userData, which the plugin encrypts with `safeStorage`.
2. `watchCloud()` refreshes the session and calls `Billing.connect()`, which asks `<cloud>/api/config` for the Convex deployment's URL. A failure retries every 30 seconds and shows as the plan's `error`. Keeping the deployment URL behind the service means moving it never needs an app release.
3. `Billing` subscribes to `billing:plans` and `billing:status`. It follows the account: signed in, each query carries a Convex JWT from `/api/auth/convex/token`, cached in `Account` until a minute before it expires.

## Signing in

`signIn()` opens `<cloud>/sign-in` in the browser with a PKCE challenge. The page sends the browser back to `io.dalliance.app://auth/callback#token=<code>`, and only this process holds the verifier that redeems the code.

The scheme and the single-instance lock stay `main.ts`'s, so the plugin's `setupMain()` runs with `scheme: false`, `bridges: false` and `csp: false`. `main.ts` registers the scheme with `setAsDefaultProtocolClient()`, and hands links to `openLink()`:

- On macOS they arrive as `open-url`, registered before `ready`.
- On Windows and Linux they arrive on a second launch's command line, through `second-instance`, or on the first launch's. `deepLinkFromArgv()` finds them.

A second launch calls `app.exit(0)` as soon as it fails to get the single-instance lock, so it never starts its own copy of the app.

`Account.handleLink()` only tries a sign-in link while a sign-in is pending, so a page that opens the scheme can't do anything or put an error in Settings. `signInCode()` accepts exactly `SIGN_IN_CALLBACK` followed by `#token=`, the form the plugin itself reads. `BILLING_LINK`, `io.dalliance.app://billing`, from the page after checkout, only brings the window forward.

When the browser can't open the app, the page shows the code, and Settings > Account takes it. That only works in the same run of the app, since the verifier lives in memory.

Packaged builds register the scheme through `protocols` in the electron-builder config. In development every checkout's Electron binary has the same bundle id, so macOS may hand the link to another copy. The code field still works then.

The service's side of signing in is in [accounts.md](accounts.md#signing-in).

## Models

`SettingsStore` takes a `CloudAccess` when `main.ts` creates it: the proxy's URL, `<cloud>/api/ai`, whether someone is signed in, and the token fetcher. `modelConfig()` returns it with the model and effort.

- `resolveModel()` builds the AI Gateway provider on `<cloud>/api/ai`, with a custom `fetch` that puts a fresh Convex JWT on every request. Signed out, it throws a `ModelSetupError` before the run starts, and the session shows its message.
- Models use gateway ids like `anthropic/claude-sonnet-5.5`, so `agentProviderOptions()` maps effort by the id's prefix. See [agent-harness.md](agent-harness.md#models).
- `titleModel()` uses `openai/gpt-6-luna` through the same proxy, and returns null signed out.
- `listModels()` lists the gateway's models through the proxy, without dollar prices, because the plan pays in credits.

The proxy checks the plan before each call and records its cost afterwards. Refusals come back in the gateway's error shape with the type `dalliance_account` (`REFUSAL_TYPE`): signed out, no plan, out of credits, or a model it doesn't offer. The gateway provider wraps that unknown type in a generic error, so `friendlyError()` reads the proxy's own response from the error's cause and shows its message as written, never as a rejected key. Any other 401 or 403 tells the user to sign in again in Settings > Account.

### Zero data retention

Every model call runs with zero data retention. The proxy enforces it, not the app: it sets the gateway's `zeroDataRetention` flag on every call, overwriting whatever the app sent, and only offers models with a zero-data-retention provider. They must also read images, since the agent looks at the charts it draws and the images in the notebook's folder. Its model list leaves the others out, and a call to one is refused with 403. So the app sends no flag of its own, and there's no setting for it. How the proxy does it is in [billing.md](billing.md#zero-data-retention).

- `loadModels()` in the store moves a saved model the list doesn't offer, typed in or saved before the list changed, back to the default, and says so in a notice.
- The agent sends no refusal fallback. The gateway drops the option today, and the model Anthropic picks for `fallbacks: 'default'` isn't published, so it couldn't be held to the list. A fallback would need an explicit list of models the proxy offers.
- Copy may say every model call runs with zero data retention. Zero data retention is not a HIPAA business associate agreement. Don't word it as one.

## Credits per run

With Show costs on, the Activity pane shows the credits each run used, counted for every run so turning it on shows earlier ones too, and never dollars, since the plan pays in credits. Each step of a run keeps the gateway's generation id, which the proxy passes through, and the run's cost names those ids. `countCredits()` asks `Billing.credits()`, which subscribes to the service's `usage:credits` query with them. The service answers for the signed-in user's own calls only. Each call's row lands a few seconds after the call, so the subscription stays open until every id is there, or 90 seconds pass, and then closes. See [agent-harness.md](agent-harness.md#costs).

## The contract

What the app relies on from the cloud site and the backend. The three sides import it from `packages/shared` rather than mirroring it by hand:

- `packages/shared/src/cloud.ts`, `@dalliance/shared/cloud`: `DESKTOP_SCHEME` (`io.dalliance.app`), `SIGN_IN_CALLBACK`, `BILLING_LINK`, `REFUSAL_TYPE` (`dalliance_account`), `PROXY_HEADER`, `CLIENT_IP_HEADER`, and the types `PlanKey`, `PlanOption`, `SubscriptionView`, `PlanUsage`, `BillingStatus` and `CallCredits`. `BillingView` in `ipc.ts` is built from them.
- `packages/shared/src/cloud-api.ts`, `@dalliance/shared/cloud-api`: `cloudApi`, typed references to the Convex functions the app calls. `electron/cloud/billing.ts` calls the backend through it, never through an untyped `anyApi`.
- The backend annotates its handlers with the same types. `packages/backend/contract.ts` checks at typecheck that each function in `cloudApi` matches the backend's own, its kind, arguments and return type, and `contract.test.ts` checks the names. The admin app's `metricsApi` gets the same checks against the internal `metrics:overview`, see [admin.md](admin.md).

So renaming a function or changing a shape fails typecheck or tests on both sides, in one pull request. Better Auth and `@better-auth/electron` come from one catalog version in `pnpm-workspace.yaml`, so the app's client and the backend's server always match.

**Pages on the cloud site**

| Path | The app |
| --- | --- |
| `/sign-in?client_id&state&code_challenge&code_challenge_method` | Opens it in the browser to start a sign-in |
| `/sign-in/done` | Never opens it. The browser lands there, and it hands off to the app |
| `/billing/done` | Never opens it. Polar sends the browser there after checkout and the portal |

**Endpoints on the cloud site**

| Endpoint | Used for |
| --- | --- |
| `GET /api/config` | `{ convexUrl }`, the deployment the plan comes from. Asked once per launch, so the Cloud URL is the only thing a build knows |
| `/api/auth/*` | Better Auth: `get-session`, `sign-out`, `electron/token`, `convex/token` |
| `POST /api/ai/language-model` | Model calls, in AI Gateway's protocol, with the account's Convex JWT as the key. Always run with zero data retention, see [billing.md](billing.md#zero-data-retention) |
| `GET /api/ai/config` | The model list, same auth, with only the models that qualify for zero data retention. Needs a sign-in, not a plan |

Refusals from `/api/ai` use the gateway's error shape with `type: "dalliance_account"`: 400 a call that isn't valid JSON, 401 signed out, 402 no plan or out of credits, 403 a model that doesn't qualify for zero data retention, 404 not a route, 502 upstream trouble, 503 not configured or hosted models unavailable (such as the gateway refusing zero data retention on an unpaid Vercel plan). The message is written for the user.

**Deep links the cloud site opens**

- `SIGN_IN_CALLBACK#token=<code>`, `io.dalliance.app://auth/callback#token=<code>`, a one-time sign-in code
- `BILLING_LINK`, `io.dalliance.app://billing`, which only focuses the app

**Convex functions the app calls**, through `cloudApi` on the deployment's `.convex.cloud` URL with the Convex JWT:

| Function | Kind | Returns |
| --- | --- | --- |
| `billing:plans` | query | The plans on offer, `PlanOption[]` |
| `billing:status` | query | The signed-in user's subscription and credits this period, a `BillingStatus`. Null when signed out |
| `billing:checkout({ plan })` | action | `{ url }`, a Polar checkout |
| `billing:portal` | action | `{ url }`, a Polar customer portal |
| `usage:credits({ generationIds })` | query | The credits each of the signed-in user's calls used, for the ids that have a ledger row yet, as `CallCredits[]`. Null when signed out. At most 100 ids are looked up |

### Changing it

Nothing is released to users yet, so the contract can change freely: change all three sides in one pull request, and let typecheck and the tests find what's left. Deploy Convex before the cloud site when a change touches both, see [deploying.md](deploying.md#shipping-a-change).

Once a version of the app ships, released copies call everything above and can't be updated from here. From then on, change the contract additively: add freely, and change or remove something only once no supported app version still uses it.

## Security

- The session, its cookie and the Convex token never leave the main process. The renderer gets `AccountView` and `BillingView` only.
- `startCheckout()` only takes the plan key `pro`. `redeemSignInCode()` only takes a string.
- Checkout and the billing portal open in the default browser. Card details never pass through the app.
- The app holds no model keys. Dalliance's own AI Gateway key lives only on the cloud site, see [billing.md](billing.md#security).
