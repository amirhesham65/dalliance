# Dalliance internals

These docs are for people and agents changing the code. The [repo README](../README.md) covers what Dalliance is and how to get it running.

Dalliance is an Electron app. You write a notebook cell in plain language, an agent turns it into Python, runs it on a local kernel, fixes it until it works, and keeps the code. Notebooks save as ordinary `.ipynb` files. Models run through Dalliance Cloud, on the user's Dalliance account and plan. The cloud site and its Convex backend live in this repo too.

## Where to start

| If you're working on | Read |
| --- | --- |
| Anything, for the first time | [architecture.md](architecture.md) |
| What a cell is, its states, how it saves | [notebook-model.md](notebook-model.md) |
| The agent: tools, prompts, models | [agent-harness.md](agent-harness.md) |
| The Python process and its protocol | [kernel.md](kernel.md) |
| Calls between the renderer and the main process | [ipc.md](ipc.md) |
| React, the store, panes, shortcuts, theming | [renderer.md](renderer.md) |
| Settings, drafts, logs and other files on disk | [storage.md](storage.md) |
| Dalliance Cloud from the app's side, and the contract between the app, the cloud site and the backend | [cloud.md](cloud.md) |
| Accounts and signing in, on the service's side | [accounts.md](accounts.md) |
| Plans, checkout, the model proxy, zero data retention and the credit ledger | [billing.md](billing.md) |
| Deploying the backend and the cloud site | [deploying.md](deploying.md) |
| What Dalliance Cloud sells next, and draft plans | [roadmap.md](roadmap.md) |
| Running tests or writing new ones | [testing.md](testing.md) |
| Setup, commands, conventions | [development.md](development.md) |
| Building the .dmg and publishing a release | [releasing.md](releasing.md) |
| dalliance.io and the shared web brand | [website.md](website.md) |
| Adding a tool, a setting, an IPC call, a pane, a Convex function | [recipes.md](recipes.md) |

## The repo in one screen

```
apps/desktop/         the Electron app, @dalliance/desktop
  electron/           main process: window, menus, settings, the agent, the kernel
    cloud/            the Dalliance Cloud client: account, plan, credits
  src/                renderer: React 19, zustand, shadcn, Tailwind v4
apps/web/             dalliance.io, Next.js 16, @dalliance/web
apps/cloud/           cloud.dalliance.io, Next.js 16, @dalliance/cloud: sign-in, billing pages, the auth and model proxies
packages/backend/     the Convex backend, @dalliance/backend: Better Auth, Polar billing, the usage ledger
packages/shared/      types and pure functions every side imports, @dalliance/shared, including the Cloud contract
packages/brand/       the web brand dalliance.io and the cloud site share, @dalliance/brand
patches/              pnpm patches, applied through patchedDependencies in pnpm-workspace.yaml
.github/              CI on every pull request, the release build on version tags, Dependabot, CODEOWNERS
docs/                 you are here
```

The repo is private and the code is proprietary, see `LICENSE`. Dalliance was published under the Apache License 2.0 until October 2026. `THIRD_PARTY_NOTICES.md` lists the contributions made under it, and the fonts and logos the app includes. `licenses/Apache-2.0.txt` holds that license's text.

## Rules that break things when ignored

1. **The model's history is append-only.** With thinking on, Anthropic's API rejects any edit to earlier turns, through the gateway too. Don't add message pruning or rewriting to the agent loop. The step cap and bounded tool output keep runs small. See [agent-harness.md](agent-harness.md#context-and-caching).
2. **The system prompt must stay stable across cells.** It sits before the cache breakpoint. Put anything that changes per cell in `buildCellPrompt`, never in `buildSystemPrompt`.
3. **Every tool result is bounded.** A new tool clips its output with `clip()` or returns a fixed-size summary.
4. **Every tool call goes through `guarded()`** so the event bus can block it and the log sees it.
5. **The kernel talks on fd 3, not stdout.** Libraries print to stdout freely. Protocol messages go to fd 3 only.
6. **The renderer never touches Node or `ipcRenderer`.** It gets `window.dalliance`, typed by `DallianceApi` in `packages/shared/src/ipc.ts`.
7. **One cell runs at a time.** The renderer queues cells and the kernel queues requests. Don't add parallel runs without reworking both.
8. **`.ipynb` stays valid nbformat 4.** Dalliance fields live under `metadata.dalliance`. Jupyter must still open the file.
9. **No AI attribution** in commits, PRs, comments or docs. See [AGENTS.md](../AGENTS.md).
10. **Every model call runs with zero data retention.** The app has no route to a model but Dalliance Cloud, and the cloud site's proxy sets the flag on every call and offers only qualifying models. Don't add a model route that skips `apps/cloud/src/lib/zdr.ts`, and never give the app a way to call a provider directly. `ZERO_DATA_RETENTION=off` exists only until the Vercel team is on a paid plan, and is never set in production. Copy may say every model call runs with zero data retention, never that it's a HIPAA business associate agreement. See [billing.md](billing.md#zero-data-retention).
11. **The Cloud contract changes in one pull request.** The app, the cloud site and the backend share names, constants and shapes through `packages/shared/src/cloud.ts` and `cloud-api.ts`, and `packages/backend/contract.ts` checks them. Nothing is released to users yet, so the contract can change freely. Once a version ships, released copies can't be updated, so from then on change it additively. See [cloud.md](cloud.md#the-contract).
12. **Secrets never leave the service.** `AI_GATEWAY_API_KEY` and `AUTH_PROXY_SECRET` live in Vercel and Convex settings only, never in code, logs, errors sent to the app, or `.env.example`. The only gateway key on the app's side is the one the end-to-end test reads from `apps/desktop/.env`.
13. **Convex decides who a caller is.** Read the user from the JWT or the session, never from a request's arguments or body.
14. **Better Auth stays on 1.6.x, `@polar-sh/sdk` on 0.x.** Both are pinned by the Convex components. Better Auth and the Electron plugin's exact peers come from the catalog, one version for every package. See [accounts.md](accounts.md) and [billing.md](billing.md#gotchas).
15. **The two patches in `patches/` are load-bearing.** Bumping either package means checking its patch still applies and is still needed.
16. **Deploy Convex before the cloud site** when a change touches both, so the site never calls a function that isn't there yet. See [deploying.md](deploying.md#shipping-a-change).

## Words used in the code

| Term | Meaning |
| --- | --- |
| Prompt cell | A cell written in plain language. Holds the prompt, the generated code and the outputs. `kind: 'prompt'`. |
| Note cell | A Markdown cell. `kind: 'note'`. |
| Generate | Ask the agent to write the code. The opposite is a plain run of saved code. |
| Interpretation | The agent's reading of the prompt. Assumptions sit in `[[double brackets]]`. |
| Correction | The user's replacement for one assumption. Forces the next run to regenerate. |
| Answer | Short prose from the agent, grounded in the outputs. |
| Suggestions | Up to three follow-up prompts the agent proposes. The `next` field of `finish`. |
| Revision | A saved working version of a cell. Up to 12 per cell. |
| Stale | Out of date because an earlier cell reran or the kernel restarted. |
| Workspace | The folder in use, which is the open notebook's folder. It is the kernel's working directory, where new notebooks go, and the only folder the agent can read. |
| Brief | `AGENTS.md` in the workspace. The agent reads it before every cell. |
| Explore | Running a quick snippet to look at data, without it becoming the cell. |
| Verify | Restart Python, rerun every cell's saved code without the agent, and report what came out the same, changed or failed. Leaves the saved outputs alone. |
| Harness | `apps/desktop/electron/harness/`, the agent loop and its tools. |
