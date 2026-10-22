# Development

You need Node 24, pnpm 10 and Python 3.9 or newer. The root `package.json` pins pnpm; `corepack enable` selects it.

```bash
pnpm install
pnpm dev
```

The desktop app starts with Vite and Electron. Add your provider key through Settings > Models. Model requests go directly to Anthropic, Google, or OpenAI; contributors do not need a hosted backend. Keys in Settings are stored locally, see [providers.md](providers.md).

## Workspace

This is one pnpm workspace with `apps/desktop`, `apps/web`, `packages/shared`, and `packages/brand`. Packages that share a dependency use a single catalog version in `pnpm-workspace.yaml`. `@dalliance/shared` exports TypeScript directly, with no separate build step.

| Command | Does |
| --- | --- |
| `pnpm dev` | Start the Electron app with hot reload |
| `pnpm --filter @dalliance/web dev` | Start the website on port 3100 |
| `pnpm build` | Build the renderer, main, preload, and website |
| `pnpm test` | Run normal tests with mocked model calls |
| `pnpm typecheck` | Check every workspace package |
| `pnpm lint` | Run oxlint |
| `pnpm --filter @dalliance/desktop dist:mac` | Build the macOS installer |

CI runs `pnpm turbo run lint typecheck test build` on Ubuntu and macOS, with Python 3.12 and pandas, NumPy, matplotlib, and IPython 8 or 9. Dependabot groups weekly dependency updates. `.github/CODEOWNERS` assigns changes to the owner.

The website's typecheck runs `next typegen` first. Its build waits for typecheck, because `next build` clears `.next` and would otherwise delete route types while TypeScript reads them.

## Browser preview

Build the app, then run the renderer preview without launching Electron:

```bash
pnpm --filter @dalliance/desktop build
pnpm --filter @dalliance/desktop exec vite preview --port 4173 --strictPort
```

Open `http://localhost:4173/?demo` for a notebook with a fake bridge, `?demo&welcome` for the start page, `?demo&setup` for onboarding, and `?demo&hero` for the website's notebook capture. See [renderer.md](renderer.md#the-browser-preview). The fake bridge never calls a model or saves real keys.

`.claude/launch.json` names the renderer preview, desktop, website preview, and website dev server. Use the product's collaborative browser when available.

## Debugging

- Open Electron DevTools for renderer problems. Main-process messages go to the terminal running `pnpm dev`.
- The run trail lives in userData's `logs/agent.jsonl`, with one rotated backup. Never add keys to logs or errors.
- To try the kernel protocol directly, run `python3 apps/desktop/electron/kernel/dalliance_kernel.py 3>&1` and enter `{"id":"1","op":"execute","code":"1+1","store":true}`.
- To reset first-run setup, quit and remove the app's userData folder. This also removes settings, saved keys, drafts, and the managed Python environment. See [storage.md](storage.md).

## Conventions

Use strict TypeScript. Types shared by main and renderer belong in `packages/shared`. Renderer imports use `@/`; shared imports use `@dalliance/shared/<module>`. The renderer never imports Electron or Node. Keep the agent modules free of Electron so tests can use fake models and kernels.

Comments explain why in plain language. UI text, prompts and docs use short sentences and sentence case. Keep oxlint at zero warnings. The generated shadcn components are exempt from `react/only-export-components`.

Use imperative commit subjects and explain the change and its verification in pull requests. Keep code and its docs in the same change. Never credit an AI assistant as an author, co-author or contributor. See [AGENTS.md](../AGENTS.md).
