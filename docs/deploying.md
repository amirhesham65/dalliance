# Deploying

Two things ship besides the app: the Convex backend in `packages/backend`, and the cloud site in `apps/cloud` on Vercel at `cloud.dalliance.io`. The app's own release is in [releasing.md](releasing.md), and the website's in [website.md](website.md).

## Environments

| | Convex | Polar | Cloud site |
| --- | --- | --- | --- |
| Development | A cloud dev deployment per developer, from `npx convex dev` | Sandbox | `pnpm --filter @dalliance/cloud dev` on `localhost:3200` |
| Production | The project's production deployment | Production | Vercel, `cloud.dalliance.io` |

Billing needs a cloud deployment: Polar's webhooks can't reach a local one. For accounts alone, `CONVEX_AGENT_MODE=anonymous npx convex dev` runs one locally without an account. See [accounts.md](accounts.md#running-it-locally).

`packages/backend/.env.local` and `apps/cloud/.env.local` hold each side's local settings. Both are gitignored, and `.env.example` in each package lists what goes there. The deployment's own settings are set with `npx convex env set` from `packages/backend`. [accounts.md](accounts.md#configuration) and [billing.md](billing.md#configuration) list them all.

To try the app against a local cloud site, set `DALLIANCE_CLOUD_URL=http://localhost:3200` in `apps/desktop/.env`. See [cloud.md](cloud.md#where-the-app-finds-it).

## First-time setup

```bash
pnpm install
cd packages/backend && npx convex dev
```

Pick or create the dev deployment when asked. That writes `packages/backend/.env.local` and pushes the functions on every save. Then set the deployment's variables, copy `apps/cloud/.env.example` to `apps/cloud/.env.local`, fill it in, and run `pnpm --filter @dalliance/cloud dev`.

## Shipping a change

1. Open a pull request. CI runs lint, typecheck, test and build for every package, the app included, so a change to [the contract](cloud.md#the-contract) is checked on both sides at once.
2. After merging, deploy Convex first when the change touches the backend:

   ```bash
   cd packages/backend && npx convex deploy
   ```

   Deploy it before the cloud site when a change touches both, so the site never calls a function that isn't there yet. The same goes for an app release that calls a new function.

3. Vercel builds the cloud site from `main`.

Production variables differ from development ones: a production `BETTER_AUTH_SECRET`, `SITE_URL=https://cloud.dalliance.io`, Polar's production token, webhook secret and product ids, and `POLAR_SERVER=production`. The Google OAuth client needs its redirect URI on `cloud.dalliance.io`.

## The Vercel project

The Vercel project for `cloud.dalliance.io` doesn't exist for this repo yet. When it's created, it needs:

- This repo, with `apps/cloud` as the root directory. Vercel then installs the whole pnpm workspace from the root, so `@dalliance/shared` and `@dalliance/brand` resolve, and runs the build in `apps/cloud`.
- The production branch `main`.
- The cloud site's variables from [accounts.md](accounts.md#configuration) and [billing.md](billing.md#configuration): `CONVEX_SITE_URL`, `CONVEX_URL`, `AUTH_PROXY_SECRET`, `AI_GATEWAY_API_KEY` and `AUTH_METHODS`. Never `ZERO_DATA_RETENTION` in production.
- The domain `cloud.dalliance.io`.
- A Pro or Enterprise plan on the team that owns `AI_GATEWAY_API_KEY`, so the gateway accepts zero data retention. See [billing.md](billing.md#zero-data-retention).
