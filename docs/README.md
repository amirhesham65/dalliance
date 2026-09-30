# Dalliance internals

These docs are for people and agents changing the code. The [repo README](../README.md) covers what the app does for users.

Dalliance is an Electron app. You write a notebook cell in plain language, an agent turns it into Python, runs it on a local kernel, fixes it until it works, and keeps the code. Notebooks save as ordinary `.ipynb` files.

## Where to start

| If you're working on | Read |
| --- | --- |
| Anything, for the first time | [architecture.md](architecture.md) |
| What a cell is, its states, how it saves | [notebook-model.md](notebook-model.md) |
| The agent: tools, prompts, models | [agent-harness.md](agent-harness.md) |
| The Python process and its protocol | [kernel.md](kernel.md) |
| Calls between the renderer and the main process | [ipc.md](ipc.md) |
| React, the store, panes, shortcuts, theming | [renderer.md](renderer.md) |
| Settings, keys, drafts, logs and other files on disk | [storage.md](storage.md) |
| Signing in and hosted models, in builds with Dalliance Cloud | [cloud.md](cloud.md) |
| Running tests or writing new ones | [testing.md](testing.md) |
| Setup, commands, conventions | [development.md](development.md) |
| Building the .dmg and publishing a release | [releasing.md](releasing.md) |
| dalliance.io | [website.md](website.md) |
| Adding a tool, a setting, an IPC call, a pane | [recipes.md](recipes.md) |

## The repo in one screen

```
apps/desktop/         the Electron app, @dalliance/desktop
  electron/           main process: window, menus, settings, the agent, the kernel
    cloud/            the optional Dalliance Cloud client, off unless a build sets DALLIANCE_CLOUD_URL
  src/                renderer: React 19, zustand, shadcn, Tailwind v4
apps/web/             dalliance.io, Next.js 16, @dalliance/web
packages/shared/      types and pure functions both sides import, @dalliance/shared
.github/workflows/    CI on every pull request, and the release build on version tags
docs/                 you are here
```

## Rules that break things when ignored

1. **The model's history is append-only.** With thinking on, the Anthropic API rejects any edit to earlier turns. Don't add message pruning or rewriting to the agent loop. The step cap and bounded tool output keep runs small. See [agent-harness.md](agent-harness.md#context-and-caching).
2. **The system prompt must stay stable across cells.** It sits before the cache breakpoint. Put anything that changes per cell in `buildCellPrompt`, never in `buildSystemPrompt`.
3. **Every tool result is bounded.** A new tool clips its output with `clip()` or returns a fixed-size summary.
4. **Every tool call goes through `guarded()`** so the event bus can block it and the log sees it.
5. **The kernel talks on fd 3, not stdout.** Libraries print to stdout freely. Protocol messages go to fd 3 only.
6. **The renderer never touches Node or `ipcRenderer`.** It gets `window.dalliance`, typed by `DallianceApi` in `packages/shared/src/ipc.ts`.
7. **One cell runs at a time in each tab.** Every tab has its own page, session and kernel. A tab's renderer queues its cells and its kernel queues requests, while cells in different tabs run at the same time. Don't add parallel runs within a tab without reworking both. See [architecture.md](architecture.md#tabs).
8. **`.ipynb` stays valid nbformat 4.** Dalliance fields live under `metadata.dalliance`. Jupyter must still open the file.
9. **No AI attribution** in commits, PRs, comments or docs. See [AGENTS.md](../AGENTS.md).
10. **Zero data retention is Dalliance Cloud's, and only Cloud's.** The service's proxy enforces it on every call. Copy may claim it for Cloud, never for the own-key routes, which run on the user's own agreements. See [cloud.md](cloud.md#zero-data-retention).

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
| Tab | One notebook in the window, with its own page, `NotebookSession` and kernel. `electron/tabs.ts` keeps the list. |
| Workspace | The folder in use, which is the tab's notebook's folder. It is that tab's kernel's working directory, where new notebooks from that tab go, and the only folder the agent can read. |
| Brief | `AGENTS.md` in the workspace. The agent reads it before every cell. |
| Explore | Running a quick snippet to look at data, without it becoming the cell. |
| Verify | Restart Python, rerun every cell's saved code without the agent, and report what came out the same, changed or failed. Leaves the saved outputs alone. |
| Harness | `apps/desktop/electron/harness/`, the agent loop and its tools. |
