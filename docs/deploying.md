# Deploying

Two things ship: the Convex backend in `backend/`, and the cloud site in `web/` on Vercel at `cloud.dalliance.io`.

## Environments

| | Convex | Polar | Cloud site |
| --- | --- | --- | --- |
| Development | A cloud dev deployment per developer, from `npx convex dev` | Sandbox | `pnpm dev` on `localhost:3200` |
| Production | The project's production deployment | Production | Vercel, `cloud.dalliance.io` |

Billing needs a cloud deployment: Polar's webhooks can't reach a local one. For accounts alone, `CONVEX_AGENT_MODE=anonymous npx convex dev` runs one locally without an account.

`backend/.env.local` and `web/.env.local` hold each side's local settings. Both are gitignored, and `.env.example` in each package lists what goes there. The deployment's own settings are set with `npx convex env set` from `backend/`. [accounts.md](accounts.md#configuration) and [billing.md](billing.md#configuration) list them all.

## First-time setup

```bash
pnpm install
cd backend && npx convex dev
```

Pick or create the dev deployment when asked. That writes `backend/.env.local` and pushes the functions on every save. Then set the deployment's variables, copy `web/.env.example` to `web/.env.local`, fill it in, and run `pnpm --filter @dalliance-cloud/web dev`.

## Shipping a change

1. Open a pull request. CI runs lint, typecheck and build.
2. After merging, deploy Convex first when the change touches the backend:

   ```bash
   cd backend && npx convex deploy
   ```

3. Vercel builds the cloud site from `main`, with `web` as the project's root directory.

Production variables differ from development ones: a production `BETTER_AUTH_SECRET`, `SITE_URL=https://cloud.dalliance.io`, Polar's production token, webhook secret and product ids, and `POLAR_SERVER=production`. The GitHub and Google OAuth apps need callback URLs on `cloud.dalliance.io`.
