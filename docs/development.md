# Development

## Setup

You need Node 24 or newer, pnpm 10 and Python 3.9 or newer. The root `package.json` pins `pnpm@10.11.0`, so `corepack enable` picks the right one.

```bash
pnpm install
cp apps/desktop/.env.example apps/desktop/.env
pnpm dev
```

The app runs models only through Dalliance Cloud, so running a prompt needs a Dalliance account with a plan. Sign in from Settings > Account. A development build talks to `https://cloud.dalliance.io` unless `DALLIANCE_CLOUD_URL` in `apps/desktop/.env` points it somewhere else, such as the cloud site running locally on `http://localhost:3200`. `electron/main.ts` loads that file only in development, and packaged builds ignore it. See [cloud.md](cloud.md), and [accounts.md](accounts.md#running-it-locally) for running the backend and the cloud site yourself.

`AI_GATEWAY_API_KEY` in the same file is only for the paid end-to-end test, which calls the gateway directly, see [testing.md](testing.md). The app itself never reads it.

`pnpm-workspace.yaml` allows only `electron` to run install scripts. If you add a dependency that needs a postinstall step, add it to `onlyBuiltDependencies`.

## Dependencies

The repo is one pnpm workspace, `apps/*` and `packages/*`, with one lockfile. A dependency that more than one package uses gets one version, in the `catalog` in `pnpm-workspace.yaml`. Packages refer to it as `"catalog:"`. React, Next, Convex, TypeScript, Tailwind, Vitest, the `@types` packages, and Better Auth with its Electron plugin work this way. To bump one, change the catalog, not the package files.

Better Auth is pinned to an exact version, 1.6.33, with the plugin's exact peers `@better-auth/utils` and `@better-fetch/fetch`. Every package that uses the plugin lists those peers itself. See [accounts.md](accounts.md#the-patch) and rule 14 in [README.md](README.md#rules-that-break-things-when-ignored).

Patches live in `patches/`, and `patchedDependencies` in `pnpm-workspace.yaml` applies them. `pnpm install` fails if one no longer applies.

`oxlint` and `turbo` are installed once, at the root. One `.oxlintrc.json` at the root covers every package. `.node-version` says 24.

Dependabot opens weekly grouped pull requests for npm packages and GitHub Actions, from `.github/dependabot.yml`. It skips minor and major bumps of Better Auth and major bumps of `@polar-sh/sdk`, which the Convex components pin. `.github/CODEOWNERS` assigns every path to the owner.

## Commands

The root scripts run through Turborepo, in dependency order, with caching. The task graph is in `turbo.json`.

| Command | Does |
| --- | --- |
| `pnpm dev` | The desktop app: Vite and Electron with hot reload. The website (`pnpm --filter @dalliance/web dev`, `:3100`), the cloud site (`pnpm --filter @dalliance/cloud dev`, `:3200`) and the backend (`npx convex dev` in `packages/backend`) start on their own, since the last two need their deployment settings |
| `pnpm test` | Every test suite. See [testing.md](testing.md) |
| `pnpm typecheck` | `tsc` in every package |
| `pnpm lint` | oxlint in every package, with the root `.oxlintrc.json` |
| `pnpm build` | Renderer to `apps/desktop/dist/`, main and preload to `apps/desktop/dist-electron/`, the sites to `apps/web/.next/` and `apps/cloud/.next/` |

For one package, filter:

```bash
pnpm --filter @dalliance/web dev
pnpm --filter @dalliance/cloud dev
pnpm turbo run test --filter @dalliance/shared
```

`convex dev` in `packages/backend` needs a Convex deployment set up first, see [deploying.md](deploying.md#first-time-setup).

## CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`. It runs the same job on Ubuntu and macOS, each with Node 24 and Python 3.12: it installs pandas, NumPy, matplotlib and IPython 8 or 9, then runs `pnpm turbo run lint typecheck test build`. One platform failing doesn't cancel the other. A newer push to the same branch cancels the runs in progress. It covers every package, so the backend's contract check runs in the same job as the app that depends on it.

The real-Python kernel tests run in CI. The paid end-to-end test doesn't. Run the same checks locally before you push:

```bash
pnpm turbo run lint typecheck test build
```

The `typecheck` of each Next app, `apps/web` and `apps/cloud`, runs `next typegen` first, so Next's route types exist before `tsc` reads them. Each app's `turbo.json` makes its build wait for it: `next build` empties `.next` when it starts, and running both at once can delete the types `tsc` is about to read.

## How dev mode works

`pnpm dev` runs `vite` in the desktop app. `vite-plugin-electron` builds `electron/main.ts` and `electron/preload.ts`, starts Electron, and sets `VITE_DEV_SERVER_URL`, which `main.ts` loads instead of `dist/index.html`.

- Renderer changes hot reload.
- Main process changes restart Electron.
- Preload changes reload the window.
- A window reload keeps the kernel, so variables survive. Restart the kernel from the Kernel menu to get a clean one.

The kernel script is imported with `?raw`, so edits to `dalliance_kernel.py` need a main process rebuild and a kernel restart before they take effect.

## The renderer bundle

`build.rolldownOptions.output.codeSplitting` in `vite.config.ts` puts vendor code in its own chunks: `react` (React, React DOM, the scheduler), `ui` (Radix, cmdk, the resizable panels), `icons` (lucide) and `vendor` for any other package. The app's own code stays in `index`, and the demo notebook is a lazy chunk. Every chunk stays under Vite's 500 kB warning, the largest being `react` at about 220 kB. A new dependency lands in `vendor` unless it matches a group. If a build warns about chunk size again, give the package that grew its own group rather than raising the limit.

## Looking at the UI without Electron

```bash
pnpm --filter @dalliance/desktop build
pnpm --filter @dalliance/desktop exec vite preview
```

Open `http://localhost:4173/?demo`. `?demo&welcome` shows the start page, `?demo&setup` the first-run setup and `?demo&hero` the notebook in the website's hero. Add `&update` to any of them for the update banner. `vite preview` serves the last build, so rebuild after changes. See [renderer.md](renderer.md#the-browser-preview).

`.claude/launch.json` defines the same servers for tools that start them by name: `renderer-preview` on 4173, `desktop` for `pnpm dev`, `web` for the built site on 3100, `web-dev` for the site in dev mode, and `cloud-dev` for the cloud site on 3200.

## Debugging

- **Renderer.** View > Toggle Developer Tools.
- **Main process.** `console.log` goes to the terminal running `pnpm dev`.
- **The agent.** Every tool call and result is in `~/Library/Application Support/Dalliance/logs/agent.jsonl`. `tail -f` it while you run a cell.
- **The kernel.** A crash shows the last 4,000 characters of stderr as the kernel error. To test the script by hand, run `python3 apps/desktop/electron/kernel/dalliance_kernel.py 3>&1` and type a request like `{"id":"1","op":"execute","code":"1+1","store":true}`.
- **A clean first launch.** Quit and delete `~/Library/Application Support/Dalliance/`. See [storage.md](storage.md).

## Conventions

### Code

- TypeScript is strict. Shared types go in `packages/shared`, not duplicated per side.
- Imports use `@/` for `apps/desktop/src` and `@dalliance/shared/<module>` for the shared package.
- Comments explain why, in plain sentences. Doc comments start with `/**` and say what a thing is for, as in `notebook.ts`. Match the density of the file you're in.
- Lint is oxlint with the React, TypeScript and oxc plugins. `react/rules-of-hooks` is an error. The generated shadcn files in `components/ui/` are exempt from `react/only-export-components`. Keep lint at zero warnings.
- Keep the harness free of Electron imports so it stays testable.
- Code the renderer runs in a browser, such as the demo, must not reach for `window.dalliance` directly. Use `getApi()`.

### Copy

UI text, model prompts and docs use one voice: short sentences, plain words, sentence case, no exclamation marks. Name the mechanism rather than the feeling. The system prompt in `prompt.ts` is copy too, and its wording changes model behaviour.

### Commits and pull requests

- Imperative subject lines, like "Package the desktop app as a universal macOS .dmg".
- A body that says what changed and why, wrapped at about 72 characters.
- Work on a branch, open a pull request into `main`, and merge it with a merge commit.
- A change that touches the app, the cloud site and the backend goes in one pull request. See [cloud.md](cloud.md#the-contract).
- Never credit an AI assistant as author or co-author, in commits, PRs, comments or docs. See [AGENTS.md](../AGENTS.md).
