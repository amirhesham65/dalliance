# Development

## Setup

You need Node 24 or newer, pnpm 10 and Python 3.9 or newer. The root `package.json` pins `pnpm@10.11.0`, so `corepack enable` picks the right one.

```bash
pnpm install
cp apps/desktop/.env.example apps/desktop/.env
pnpm dev
```

Put `AI_GATEWAY_API_KEY` in `apps/desktop/.env`, or `ANTHROPIC_API_KEY` if you switch the provider in Settings. You can also skip the file and paste a key into Settings, where it's stored encrypted. The `.env` file is only read in development. Packaged builds also find either variable when your shell profile exports it.

`DALLIANCE_CLOUD_URL` in the same file points a development build at a Dalliance Cloud, such as a local copy of the service. Leave it out to work on the app without one. See [cloud.md](cloud.md).

`pnpm-workspace.yaml` allows only `electron` to run install scripts. If you add a dependency that needs a postinstall step, add it to `onlyBuiltDependencies`.

## Dependencies

A dependency that more than one package uses gets one version, in the `catalog` in `pnpm-workspace.yaml`. Packages refer to it as `"catalog:"`. React, TypeScript, Tailwind, Vitest and the `@types` packages work this way. To bump one, change the catalog, not the package files.

`oxlint` and `turbo` are installed once, at the root.

## Commands

The root scripts run through Turborepo, in dependency order, with caching. The task graph is in `turbo.json`.

| Command | Does |
| --- | --- |
| `pnpm dev` | Vite and Electron with hot reload, plus the website on `:3100` |
| `pnpm test` | Every test suite. See [testing.md](testing.md) |
| `pnpm typecheck` | `tsc` in every package |
| `pnpm lint` | oxlint in every package, with the root `.oxlintrc.json` |
| `pnpm build` | Renderer to `apps/desktop/dist/`, main and preload to `apps/desktop/dist-electron/`, site to `apps/web/.next/` |

For one package, filter:

```bash
pnpm --filter @dalliance/desktop dev
pnpm --filter @dalliance/web dev
pnpm turbo run test --filter @dalliance/shared
```

## CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`. It runs the same job on Ubuntu and macOS, each with Node 24 and Python 3.12: it installs pandas, NumPy, matplotlib and IPython 8 or 9, then runs `pnpm turbo run lint typecheck test build`. One platform failing doesn't cancel the other. A newer push to the same branch cancels the runs in progress.

The real-Python kernel tests run in CI. The paid end-to-end test doesn't. Run the same checks locally before you push:

```bash
pnpm turbo run lint typecheck test build
```

The website's `typecheck` runs `next typegen` first, so Next's route types exist before `tsc` reads them. `apps/web/turbo.json` makes the website's build wait for it: `next build` empties `.next` when it starts, and running both at once can delete the types `tsc` is about to read.

## How dev mode works

`pnpm --filter @dalliance/desktop dev` runs `vite`. `vite-plugin-electron` builds `electron/main.ts` and `electron/preload.ts`, starts Electron, and sets `VITE_DEV_SERVER_URL`, which `main.ts` loads instead of `dist/index.html`.

- Renderer changes hot reload.
- Main process changes restart Electron.
- Preload changes reload every tab.
- Reloading a tab (View > Reload) keeps its kernel, so variables survive. Restart the kernel from the Kernel menu to get a clean one.

The kernel script is imported with `?raw`, so edits to `dalliance_kernel.py` need a main process rebuild and a kernel restart before they take effect.

## The renderer bundle

`build.rolldownOptions.output.codeSplitting` in `vite.config.ts` puts vendor code in its own chunks: `react` (React, React DOM, the scheduler), `ui` (Radix, cmdk, the resizable panels), `icons` (lucide) and `vendor` for any other package. The app's own code stays in `index`, and the demo notebook is a lazy chunk. Every chunk stays under Vite's 500 kB warning, the largest being `react` at about 220 kB. A new dependency lands in `vendor` unless it matches a group. If a build warns about chunk size again, give the package that grew its own group rather than raising the limit.

## Looking at the UI without Electron

```bash
pnpm --filter @dalliance/desktop build
pnpm --filter @dalliance/desktop exec vite preview
```

Open `http://localhost:4173/?demo`. `?demo&welcome` shows the start page and `?demo&setup` the first-run setup. `vite preview` serves the last build, so rebuild after changes. See [renderer.md](renderer.md#the-browser-preview).

`.claude/launch.json` defines the same servers for tools that start them by name: `renderer-preview` on 4173, `desktop` for `pnpm dev`, `web` for the built site on 3100, and `web-dev` for the site in dev mode.

## Debugging

- **Renderer.** View > Toggle Developer Tools.
- **Main process.** `console.log` goes to the terminal running `pnpm dev`.
- **The agent.** Every tool call and result is in `~/Library/Application Support/Dalliance/logs/agent.jsonl`. `tail -f` it while you run a cell. Each line names its tab in `tab`, since tabs can run at once.
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
- Commits from outside contributors carry a `Signed-off-by` line, the Developer Certificate of Origin. See [CONTRIBUTING.md](../CONTRIBUTING.md).
- Never credit an AI assistant as author or co-author, in commits, PRs, comments or docs. See [AGENTS.md](../AGENTS.md).
