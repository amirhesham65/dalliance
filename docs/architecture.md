# Architecture

Dalliance runs as three processes on the user's machine. Nothing runs on a server except the model provider.

```mermaid
flowchart LR
  subgraph Electron
    R["Renderer<br/>React + zustand<br/>apps/desktop/src"]
    P["Preload<br/>window.dalliance"]
    M["Main process<br/>apps/desktop/electron"]
  end
  K["Python kernel<br/>dalliance_kernel.py"]
  AI["Model provider<br/>Vercel AI Gateway or Anthropic API"]

  R -- "typed API calls" --> P
  P -- "ipcRenderer.invoke / send" --> M
  M -- "run events, kernel state, menu actions" --> R
  M -- "JSON lines on stdin" --> K
  K -- "JSON lines on fd 3" --> M
  M -- "AI SDK 7 ToolLoopAgent" --> AI
```

| Process | Code | Owns |
| --- | --- | --- |
| Renderer | `apps/desktop/src/` | One page per tab: its notebook, run queue, live run state, layout, every pixel |
| Main | `apps/desktop/electron/` | The window and its tabs, files and dialogs, settings and keys, the agent loop, the kernels' lifecycle |
| Kernel | `apps/desktop/electron/kernel/dalliance_kernel.py` | One Python namespace per tab that lives across cells |

The renderer holds the document. The main process holds everything with side effects. The kernel holds Python state. `packages/shared` holds the types that cross those lines.

## Tabs

One window holds several notebooks, each in its own tab. Every tab is a whole copy of the renderer page, so the store, the run queue and every component stay one notebook's, as they were before tabs.

```
BaseWindow
├── WebContentsView  tab-1  renderer page  ─ NotebookSession ─ kernel in tab-1's folder
├── WebContentsView  tab-2  renderer page  ─ NotebookSession ─ kernel in tab-2's folder (started on first run)
└── ...
```

- `electron/tabs.ts` keeps the list: `Tabs` holds each tab's view, its `NotebookSession`, what its page last said about its notebook (path, unsaved changes, cells running), and the close flow. It takes a `TabHost` with the Electron parts, so its tests run on fakes.
- Only the active tab's view is attached to the window. Switching removes one view and adds the other, sized to the window's content area and focused, so keys go to it. A hidden tab's page keeps running, and so do its cells.
- The main process owns the list and sends it to every page over `tabs-changed`. Each page draws the same strip in its top bar. See [ipc.md](ipc.md#tabs).
- Every IPC handler gets the tab whose page sent the call. The runner, the kernel, the folder, the brief and the draft are all that tab's.
- A tab's kernel starts on its first run, not when the tab opens, so many tabs stay cheap. Only the tab showing at launch warms its kernel up straight away. Closing a tab shuts its kernel down, as does closing the window. See [kernel.md](kernel.md#lifecycle).
- Settings, keys and the Python are the app's. A change from any tab goes to every page, and a new Python restarts every kernel in use.
- Opening a notebook uses the tab it came from when that tab is an untouched Untitled (no file, no changes), brings forward the tab that already has the file, and otherwise opens a new tab. Nothing ever replaces a notebook in place, so no open needs a Discard prompt.

Each tab costs a renderer process, about what one window cost before, plus a Python process once it has run a cell. That is the price of keeping the renderer single-notebook. Tabs brought back at launch load their pages straight away.

## What happens when a cell runs

```mermaid
sequenceDiagram
  participant U as User
  participant S as Store (renderer)
  participant N as NotebookSession (main)
  participant H as runCell (harness)
  participant K as PythonKernel
  participant L as Model

  U->>S: Shift+Enter
  S->>S: queue.push(id), pump()
  S->>N: runCell(request) with generate = needsGeneration(cell)
  N->>N: resolveModel(), ensureKernel()
  N-->>L: generateTitle() in parallel, if the cell needs a name
  N->>H: runCell(request, deps)
  loop until finish or 24 steps
    H->>L: stream
    L-->>H: tool call
    H->>K: explore / run_cell / variables
    K-->>H: outputs
    H-->>S: RunEvent (status, activity, attempt, output)
  end
  H-->>N: CellRunResult
  N-->>S: CellRunResult
  S->>S: finish(): update cell, history, mark later cells stale
  S->>N: listVariables()
```

Step by step:

1. `actions.run(id)` in `src/store/notebook-store.ts` adds the cell to a module-level queue and marks it `queued`.
2. `pump()` takes one cell at a time. It decides `generate` with `needsGeneration()` from `packages/shared/src/notebook.ts` and builds a `RunCellRequest` with every earlier cell as context.
3. `window.dalliance.runCell()` goes over IPC to the tab's `NotebookSession.runCell()` in `electron/session.ts`.
4. The session resolves the model when the cell needs generating, starts the kernel if needed, fires off a title request, and calls `runCell()` in `electron/harness/run-cell.ts`.
5. With `generate: false` the harness runs the saved code once on the kernel. No model call.
6. With `generate: true` a `ToolLoopAgent` runs until `finish` succeeds or it hits 24 steps. Tool calls and outputs stream to the renderer as `RunEvent`s.
7. The result returns through the same `invoke`. The store's `finish()` writes it into the cell, pushes a revision, marks later `done` cells `stale`, and refreshes the variable list.

Questions and approvals from the agent pause the loop. The session sends a `question` or `approval` event with a `requestId`, then waits on a promise in `pending`. The renderer answers with `respond(requestId, answer)`. Stop, restart and the end of a run resolve every pending promise with `null`, so nothing hangs.

## Package boundaries

```
@dalliance/shared   imported by both sides, no Node or DOM APIs
  notebook.ts       Cell, Output, Provenance, Pins, needsGeneration, parseInterpretation
  ipynb.ts          toIpynb, fromIpynb, pinsFromNb
  ipc.ts            DallianceApi, RunEvent, request and result types, IPC channel names
  leaked.ts         splitLeaked, leakedList: recovers tool markup a model wrote into text
  normalize.ts      normalizeOutputs, canonicalOutputs: outputs without their run-to-run noise, for hashing and comparing
  python.ts         scanPython: Python source split into code, comments and strings, for reading code as text
  verify.ts         compareOutputs, seedWarnings, missingNameCause: Verify's comparison and code checks

apps/desktop/electron   Node and Electron only, never imported by src/
apps/desktop/src        DOM only, never imports electron/
```

`@dalliance/shared` has no build step. Its `package.json` `exports` point at `.ts` files and Vite bundles them into the renderer, main and preload builds.

## Security model

The renderer is treated as untrusted web content.

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` for every tab's view in `electron/main.ts`.
- `electron/preload.ts` exposes one object, `window.dalliance`, and never `ipcRenderer` itself. Sandboxed preloads must be CommonJS, so Vite writes `preload.cjs`.
- Links with `https://` open in the default browser. Every other new window is denied, and in-app navigation is blocked.
- The main process answers IPC only from the top frame of one of its tab views showing the app's own page. See [ipc.md](ipc.md#who-may-call).
- Packaged builds get a strict Content Security Policy from the `dalliance-csp` plugin in `vite.config.ts`. The dev server skips it because React Fast Refresh needs inline scripts.
- API keys are encrypted with Electron `safeStorage`, which uses the macOS keychain. See [storage.md](storage.md).
- In builds with Dalliance Cloud, the account's session and tokens stay in the main process too. The renderer only sees the name, email and plan. See [cloud.md](cloud.md#security).
- File paths from the renderer aren't trusted. `saveNotebook()` only writes to an absolute path ending in `.ipynb` and shows the Save dialog for anything else. `openRecent()` only opens a path already in `settings.recent`. `checkPins()` only reads files inside the folder in use, by relative paths.

The agent is fenced in by the harness rather than by the OS:

- `read_file` and `list_files` refuse paths outside the workspace.
- Broad folders such as the home folder, Documents, Desktop, Downloads and iCloud Drive get no file listing at all. See `isBroadFolder()` in `electron/harness/workspace.ts`.
- A built-in event bus extension blocks `read_file` on `.env` and `.env.*`, in any case and with either `/` or `\` separators. See `isSecretPath()` in `electron/harness/code-policy.ts`.
- Package installs need the user's approval unless the approval mode is `background`.
- A code policy reads the Python that `explore` and `run_cell` are about to run. Code that reads secret files (`.env`, `~/.ssh`, `~/.aws`, `.netrc`, the keychain) is blocked. Code that runs shell commands or subprocesses, or uses the network, goes through the same approval as package installs. See `inspectCode()` in `electron/harness/code-policy.ts` and `codePolicy()` in `electron/harness/extensions.ts`.
- The code policy only reads the code's text, so it's a speed bump, not a sandbox. Code that hides what it does, or a library that fetches a URL on its own, gets through. Treat the kernel as having the user's permissions.

## Where state lives

| State | Lives in | Survives |
| --- | --- | --- |
| The open tabs, their order and the one showing | `Tabs` in the main process, mirrored to `session.json` | Relaunch. See [storage.md](storage.md#session-and-drafts) |
| The notebook document | The tab's renderer store, mirrored to the main process as a draft | Tab reload and relaunch |
| Live run state (`runs`, activity, questions) | The tab's renderer store | Nothing. A reload interrupts the running cell |
| Python variables | The tab's kernel process | Tab reload. Not a relaunch, a restart, or closing the tab or the window |
| Settings and keys | `settings.json` in userData | Everything |
| Layout, sidebar open | `localStorage` in the renderer | Relaunch |
| Package trust for installs | `NotebookSession.trust`, per tab | The tab |
