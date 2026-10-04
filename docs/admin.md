# The admin app

`apps/admin`, `@dalliance/admin`, is an internal dashboard of product metrics: accounts, paying plans, monthly recurring revenue, active users, model calls and model cost, per day over the last 7, 30 or 90 days, and cost by model. Next.js 16, shadcn and Recharts, on `127.0.0.1:3300`.

It runs on your machine only and is never deployed. It has no sign-in of its own: it reads Convex with the deployment's deploy key, which is an admin key, so anyone who can open the page sees the numbers. That's why the server binds to `127.0.0.1` and not to every interface.

## Running it

```bash
cp apps/admin/.env.example apps/admin/.env.local
pnpm --filter @dalliance/admin dev
```

Fill in `.env.local` first:

| Variable | Value |
| --- | --- |
| `CONVEX_URL` | The deployment to read, its `.convex.cloud` URL. Production for real numbers, your dev deployment while working on it |
| `CONVEX_DEPLOY_KEY` | That deployment's deploy key, from the Convex dashboard under Settings > URL & Deploy Key |

The key stays in `.env.local`, which is gitignored. Never commit it, paste it or put it in a deployed app's settings. Without the two variables the page says which is missing.

The header shows the deployment's name, so you can tell production from dev at a glance.

## How it gets the numbers

1. The page is a server component. It reads `?days=` (7, 30 or 90, 30 when missing) and calls `readMetrics()` in `src/lib/convex.ts`, which is `server-only`.
2. `readMetrics()` makes a `ConvexHttpClient`, gives it the deploy key with `setAdminAuth()`, and runs `metrics:overview` through `metricsApi` from `@dalliance/shared/metrics`. `setAdminAuth()` is public in the client but missing from its types, hence the cast.
3. `metrics:overview` in `packages/backend/convex/metrics.ts` is an `internalQuery`, so no app or browser can call it, only a caller with an admin key. It reads:
   - every account, a page at a time, from the Better Auth component's `adapter.findMany`
   - each account's current subscription, through `polar.getCurrentSubscription`
   - the `usage` ledger since the start of the range, through the built-in `by_creation_time` index
4. `summarize()`, a pure function in the same file, turns those rows into `Metrics`. `metrics.test.ts` tests it.

The range switch pushes `?days=` to the URL, so every view is a link and a reload shows fresh numbers. Nothing updates live.

## What the numbers mean

- **Days** are UTC dates. A 7-day range is today and the six days before it.
- **Paying plans** are active or trialing subscriptions, the ones that let someone run prompts. Trials are counted but bring no revenue.
- **MRR** adds up active subscriptions' prices. Yearly plans count a twelfth of the price.
- **Active users** made at least one model call in the range, or on that day in the chart.
- **Model cost** is what the gateway charged, from the usage ledger, in dollars. Its share of revenue compares it with MRR scaled to the same number of days.

## Limits

The query reads every account and every ledger row in the range. That's fine while Dalliance is small. A Convex query reads at most 32,000 documents, so when accounts plus 90 days of calls near that, keep daily totals in their own table, written by `usage:record` or a cron, and read those instead.

## Changing it

- A new number: add it to `Metrics` in `packages/shared/src/metrics.ts`, compute it in `summarize()`, test it in `metrics.test.ts`, and show it in `src/app/page.tsx`. Deploy Convex before you use it against production.
- `packages/backend/contract.ts` checks that `metricsApi.overview` matches the internal query's arguments and return type, and `contract.test.ts` checks the name, the same way as the app's functions. See [cloud.md](cloud.md#the-contract).
- New shadcn components: `pnpm exec shadcn add <name>` in `apps/admin`. The theme in `src/app/globals.css` is the desktop app's palette, and it follows the system's light or dark setting.
