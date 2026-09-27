# Ilios

A desktop notebook where each cell is written in plain language. An agent turns the prompt into Python, runs it on a live kernel, checks the result, fixes errors, and keeps the working code. Cells behave like Jupyter cells: edit, rerun, reorder, and read or edit the generated code.

## Running it

```bash
pnpm install
cp .env.example .env   # add AI_GATEWAY_API_KEY, or add a key later in Settings
pnpm dev
```

The first time, open Settings and choose **Set up a Python environment**. It creates a private virtual environment with pandas, NumPy and matplotlib in the app's data folder. You can point the app at your own interpreter instead.

## How a cell runs

- **New or changed prompt:** the agent writes the code. It can list variables, look at data with short exploratory snippets, list and read files in the notebook's folder, install packages (you approve each one), and ask you a multiple-choice question when a wrong guess would make the cell useless. It calls `run_cell` with complete code, reads the outputs or the traceback, retries until the code works, then calls `finish` with its reading of the prompt and a short answer.
- **Unchanged prompt:** the saved code runs directly on the kernel. No model call.
- **Edited code:** your version runs until you change the prompt.
- **Corrected assumption:** click an underlined assumption under the prompt, change it, and the next run regenerates with your correction.
- Rerunning a cell marks later cells as out of date, as in Jupyter.
- **Next prompts:** `finish` can return up to three follow-up prompts. They show under the cell that just ran; clicking one adds it as the next cell and runs it.
- **History:** every run with new code keeps that version in the cell. The History pane lists them and restores one without calling the model.

## Panes

The left pane shows the notebook's progress (one segment per prompt cell), a one-line summary and a run log. The tiles under it open one side pane at a time: **Brief** (the folder's `AGENTS.md`, edited in place and read before every cell), **Variables**, **History** for the selected cell, and **Files** in the notebook's folder. A result can also be pinned to the side while you work further down.

Notebooks save as `.ipynb`. The prompt, interpretation and answer live in each cell's `metadata.ilios`, so Jupyter can open the files, and plain Jupyter notebooks open as runnable code cells.

## The harness

The agent follows the patterns in Vercel's [Build Your Own AI Coding Agent Harness](https://vercel.com/academy/build-ai-agent-harness) course, adapted from a coding agent to a notebook:

| Course idea | Here |
| --- | --- |
| `ToolLoopAgent` with typed tools | `electron/harness/run-cell.ts`, `tools.ts` (AI SDK 7) |
| Tool descriptions with WHEN TO USE / WHEN NOT TO USE | every tool in `tools.ts` |
| Bounded tool output | `format.ts`, 500-line `read_file`, clipped outputs |
| Approval config as a discriminated union | `approval.ts` (interactive, background, delegated) for package installs |
| Structured, dynamic system prompt, `AGENTS.md` | `prompt.ts`; an `AGENTS.md` next to the notebook is added to the prompt |
| Sandbox interface with swappable backends | `Kernel` interface: `PythonKernel` (real process) and `FakeKernel` (tests) |
| Verification gate | `run_cell` must succeed before `finish` is accepted |
| Context management and cache control | bounded tool output and a 24-step cap per cell instead of `pruneMessages`: with thinking on, the API rejects edits to earlier turns, so history stays append-only. The system prompt is marked for caching and kept stable; per-cell context goes in the user message |
| `askUser` | `ask_user` tool, answered from a card in the cell |
| Streaming and per-tool rendering | the cell's live activity list |
| Event bus with block and modify | `events.ts`; built-in extensions keep `.env` files private and log every run to `logs/agent.jsonl` in the app data folder |

Subagents and cloud sandboxes from the course are not used: one cell is a small, bounded task, and the kernel runs locally.

## Models

Default: Claude Opus 5 through the Vercel AI Gateway (`anthropic/claude-opus-5`), adaptive thinking, medium effort. Settings can switch to the Anthropic API directly, change the model and effort, and store keys encrypted with the system keychain. In development, keys can come from `.env`.

## Commands

```bash
pnpm dev          # Vite dev server plus Electron with hot reload
pnpm test         # unit, component and kernel tests
pnpm typecheck
pnpm lint
pnpm build        # renderer to dist/, Electron main and preload to dist-electron/
pnpm exec vite preview   # then open /?demo to see the UI with sample data in a browser
ILIOS_E2E=1 pnpm exec vitest run electron/e2e.test.ts   # real Python + real model, costs a few cents
```

## Layout

```
electron/
  main.ts, menu.ts, preload.ts   window, menus, file dialogs, the typed window.ilios bridge
  session.ts                     owns the kernel and the harness for the open notebook
  settings.ts                    settings and encrypted keys
  kernel/                        ilios_kernel.py (JSON lines over fd 3), PythonKernel, Python setup
  harness/                       the agent: tools, prompt, approval, events, run-cell loop
src/
  shared/                        notebook model, .ipynb conversion, IPC contract (used by both sides)
  store/notebook-store.ts        document state, run queue, live run state
  components/                    top bar, overview, settings, cells and outputs
  components/panes/              the side panes: brief, variables, history, files, pinned
  dev/demo.ts                    sample data for looking at the UI in a browser (?demo)
  components/ui/                 shadcn components
design/prototype.html            the original single-file prototype
```
