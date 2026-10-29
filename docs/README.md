# Dalliance internals

These docs are for people and agents changing the code. The [repo README](../README.md) covers what Dalliance is and how to get it running.

Dalliance is an Electron app. You write a notebook cell in plain language, an agent turns it into Python, runs it on a local kernel, fixes it until it works, and keeps the code. Notebooks save as ordinary `.ipynb` files. Models run directly through Anthropic, Google, or OpenAI, with the user's own API key. The website lives in this repo too.

## Where to start

| If you're working on | Read |
| --- | --- |
| Anything, for the first time | [architecture.md](architecture.md) |
| What a cell is, its states, how it saves | [notebook-model.md](notebook-model.md) |
| The agent: tools, prompts, models | [agent-harness.md](agent-harness.md) |
| Creating, running and embedding project apps | [apps.md](apps.md) |
| The Python process and its protocol | [kernel.md](kernel.md) |
| Calls between the renderer and the main process | [ipc.md](ipc.md) |
| React, the store, panes, shortcuts, theming | [renderer.md](renderer.md) |
| Settings, drafts, logs and other files on disk | [storage.md](storage.md) |
| Provider keys, model routing and data handling | [providers.md](providers.md) |
| Running tests or writing new ones | [testing.md](testing.md) |
| Setup, commands, conventions | [development.md](development.md) |
| Building the .dmg and publishing a release | [releasing.md](releasing.md) |
| dalliance.io, its blog and the shared web brand | [website.md](website.md) |
| Adding a tool, a setting, an IPC call, a pane, or a model | [recipes.md](recipes.md) |

## The repo in one screen

```
apps/desktop/         the Electron app, @dalliance/desktop
  electron/           main process: window, menus, settings, the agent, the kernel
  src/                renderer: React 19, zustand, shadcn, Tailwind v4
apps/web/             dalliance.io, Next.js 16, @dalliance/web
packages/shared/      types and pure functions for the app, @dalliance/shared
packages/brand/       the website brand, @dalliance/brand
.github/              CI on every pull request, the release build on version tags, Dependabot, CODEOWNERS
docs/                 you are here
```

The code is licensed under Apache 2.0. See `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md`.

## Rules that break things when ignored

1. **The model's history is append-only.** With thinking on, Anthropic's API rejects any edit to earlier turns. Don't add message pruning or rewriting to the agent loop. The step cap and bounded tool output keep runs small. See [agent-harness.md](agent-harness.md#context-and-caching).
2. **The system prompt must stay stable across cells.** It sits before the cache breakpoint. Put anything that changes per cell in `buildCellPrompt`, never in `buildSystemPrompt`.
3. **Every tool result is bounded.** A new tool clips its output with `clip()` or returns a fixed-size summary.
4. **Every tool call goes through `guarded()`** so the event bus can block it and the log sees it.
5. **The kernel talks on fd 3, not stdout.** Libraries print to stdout freely. Protocol messages go to fd 3 only.
6. **The renderer never touches Node or `ipcRenderer`.** It gets `window.dalliance`, typed by `DallianceApi` in `packages/shared/src/ipc.ts`.
7. **One cell runs at a time.** The renderer queues cells and the kernel queues requests. Don't add parallel runs without reworking both.
8. **`.ipynb` stays valid nbformat 4.** Dalliance fields live under `metadata.dalliance`. Jupyter must still open the file.
9. **No AI attribution** in commits, PRs, comments or docs. See [AGENTS.md](../AGENTS.md).
10. **Provider keys stay in the main process.** `ProviderKeys` encrypts keys with Electron `safeStorage`. The renderer can set or remove a key and read its status, never retrieve a saved value. Without secure storage, keys last for the session only. Never put keys in ordinary settings, notebook metadata, logs, errors, or Python's environment.
11. **Model calls go directly to the selected provider.** Use the explicit AI SDK provider adapters in `harness/model.ts`. Never pass a bare model string to AI SDK generation functions, since that can select its default provider. Titles use the same provider and key. No silent provider or model fallback.
12. **Data handling follows the user's provider account.** Do not promise retention or training policies that the app cannot enforce. Explain what notebook context is sent. See [providers.md](providers.md).

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
