# Dalliance Cloud docs

Dalliance Cloud is the hosted half of Dalliance: accounts, plans and hosted models. The app itself is open source in [amirhesham65/dalliance](https://github.com/amirhesham65/dalliance) and works without this service, on the user's own key. This repo is private.

| Doc | Covers |
| --- | --- |
| [accounts.md](accounts.md) | Signing in from the desktop app, and what keeps it safe |
| [billing.md](billing.md) | Plans, checkout, the model proxy and the credit ledger |
| [deploying.md](deploying.md) | Environments, first-time setup, and shipping a change |
| [roadmap.md](roadmap.md) | What's free and what's paid, the features to build next, and draft plans |

## Rules that break things when ignored

1. **The app contract is public API.** Released copies of the app call everything under [The app contract](#the-app-contract) and can't be updated from here. Add to it freely. Change or remove something only once no supported app version still uses it.
2. **Secrets never leave the service.** `AI_GATEWAY_API_KEY` and `AUTH_PROXY_SECRET` live in Vercel and Convex settings only, never in code, logs, errors sent to the app, or `.env.example`.
3. **Convex decides who a caller is.** Read the user from the JWT or the session, never from a request's arguments or body.
4. **Better Auth stays on 1.6.x, `@polar-sh/sdk` on 0.x.** Both are pinned by the Convex components. See [accounts.md](accounts.md) and [billing.md](billing.md#gotchas).
5. **The two patches in `patches/` are load-bearing.** Bumping either package means checking its patch still applies and is still needed.
6. **Deploy Convex before the cloud site** when a change touches both, so the site never calls a function that isn't there yet.

## The app contract

What the desktop app relies on. The app's side lives in its Cloud client, which is switched off in builds that don't set a Cloud URL.

**Pages on the cloud site**

| Path | The app |
| --- | --- |
| `/sign-in?client_id&state&code_challenge&code_challenge_method` | Opens it in the browser to start a sign-in |
| `/sign-in/done` | Never opens it. The browser lands there, and it hands off to the app |
| `/billing/done` | Never opens it. Polar sends the browser there after checkout and the portal |

**Endpoints on the cloud site**

| Endpoint | Used for |
| --- | --- |
| `/api/auth/*` | Better Auth: `get-session`, `sign-out`, `electron/token`, `convex/token` |
| `POST /api/ai/language-model` | Model calls, in AI Gateway's protocol, with the account's Convex JWT as the key |
| `GET /api/ai/config` | The model list, same auth. Needs a sign-in, not a plan |

Refusals from `/api/ai` use the gateway's error shape with `type: "dalliance_account"`: 401 signed out, 402 no plan or out of credits, 404 not a route, 502 upstream trouble, 503 not configured. The message is written for the user.

**Deep links the cloud site opens**

- `io.dalliance.app://auth/callback#token=<code>`, a one-time sign-in code
- `io.dalliance.app://billing`, which only focuses the app

**Convex functions the app calls**, through `anyApi` on the deployment's `.convex.cloud` URL with the Convex JWT:

| Function | Kind | Returns |
| --- | --- | --- |
| `billing:plans` | query | The plans on offer |
| `billing:status` | query | The signed-in user's subscription and credits this period |
| `billing:checkout({ plan })` | action | A Polar checkout URL |
| `billing:portal` | action | A Polar customer portal URL |

**Shared constants**: the scheme `io.dalliance.app`, and the Better Auth and `@better-auth/electron` versions, which must match the app's.
