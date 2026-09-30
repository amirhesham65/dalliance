# IPC between the renderer and the main process

The whole contract is in `packages/shared/src/ipc.ts`. Three files implement it:

- `electron/main.ts` registers the handlers with `ipcMain`.
- `electron/preload.ts` maps each `DallianceApi` method onto a channel and exposes the object as `window.dalliance`.
- `src/store/notebook-store.ts` and the components call `getApi()`.

Channel names are in the `IPC` constant. Never type a channel string by hand.

## Calls

`invoke` calls return a promise. `send` calls are fire and forget.

| Method | Kind | Main side | Does |
| --- | --- | --- | --- |
| `runCell(request)` | invoke | `session.runCell` | Runs or generates one cell. Resolves when the run ends |
| `respond(requestId, answer)` | send | `session.respond` | Answers an agent question or an install approval |
| `interrupt()` | invoke | `session.interrupt` | Aborts the agent and sends SIGINT to the kernel |
| `restartKernel()` | invoke | `session.restart` | Fresh kernel in the same folder. A kernel still starting is discarded |
| `kernelState()` | invoke | `session.kernelState` | Last known `KernelState` |
| `listVariables()` | invoke | `session.variables` | Variables for the side pane |
| `getSettings()` | invoke | `settings.view` | `SettingsView`, never the keys themselves |
| `updateSettings(update)` | invoke | `settings.update` | Returns the new view. Restarts the kernel if `pythonPath` changed |
| `listModels()` | invoke | `listModels` | Models for the picker |
| `checkKey(provider, key)` | invoke | `checkKey` | Asks the provider whether a key works, without saving it. A `KeyCheck` with the balance or the reason |
| `pythonState()` | invoke | `session.pythonState` | Which Python, which version, missing packages |
| `setupPython()` | invoke | `session.setupPython` | Creates the managed venv, then restarts the kernel |
| `openNotebook()` | invoke | dialog, `openFile` | Open dialog, parse, restart the kernel in that folder. A kernel still starting in the old folder shuts itself down |
| `openRecent(path)` | invoke | `openFile` | Same without a dialog. Only opens a path in `settings.recent`, and returns null for any other. Drops the entry if the file is gone |
| `recentNotebooks()` | invoke | `settings.recent` | Up to 8 that still exist |
| `saveNotebook(path, notebook)` | invoke | dialog, `writeFileAtomic` | Save, or Save As when `path` is null. A `path` that isn't an absolute `.ipynb` path gets the Save dialog too. Returns the path or null |
| `confirmDiscard()` | invoke | dialog | True when the document is clean or the user discards |
| `readBrief()`, `writeBrief(text)` | invoke | `session` | The workspace's `AGENTS.md` |
| `listFiles()` | invoke | `session.files` | Workspace files, empty for broad folders |
| `restoreSession()` | invoke | `drafts.restore` | The notebook to show at load. See [storage.md](storage.md#session-and-drafts) |
| `saveDraft(state)` | send | `drafts.update` | Mirrors the document to the main process |
| `setDocumentState({ path, dirty })` | send | `updateTitle` | Window title and the macOS edited dot |

## Events from main

Each `on*` method subscribes and returns an unsubscribe function.

| Method | Channel | Payload |
| --- | --- | --- |
| `onRunEvent` | `run-event` | `(cellId, RunEvent)` |
| `onKernelState` | `kernel-state-changed` | `KernelState` |
| `onPythonLog` | `python-log` | One line of venv or pip output |
| `onMenu` | `menu` | A `MenuAction` from the app menu |

`RunEvent` is a union:

| `type` | Meaning | Renderer effect |
| --- | --- | --- |
| `status` | Short text like "Reading the notebook" | The spinner line |
| `activity` | A tool call started or finished, keyed by id | The live activity list |
| `attempt` | A new `run_cell` attempt | Clears live outputs, shows the attempt's code |
| `output` | One output from the running attempt | Appended to live outputs |
| `question` | `ask_user` is waiting | The question card |
| `approval` | An install is waiting | The Install / Don't install bar |
| `title` | A short name arrived | Written straight onto the cell, even after the run |

## Menu actions

`electron/menu.ts` builds the native menu. Each item sends a `MenuAction` string and the renderer's `handleMenu()` in `src/App.tsx` acts on it. The View menu's Cmd+B and Cmd+1 to Cmd+6 items set `registerAccelerator: false`, because the renderer handles those keys itself and the menu only displays them.

## Saving and closing

Closing a dirty window shows Save / Don't Save / Cancel from the main process.

- Save sets `allowCloseAfterSave` and sends the `save` menu action. The renderer calls `saveNotebook()`, and the main process closes the window once the file is written. Every save clears the flag when it ends, whether it landed, was cancelled or failed, so a later ordinary Save never closes the window.
- Don't Save calls `drafts.forgetChanges()`, so the next launch reopens the file as it is on disk.

`saveNotebook()` records the saved state in the draft store itself, then moves the kernel's working directory. The window might close before the renderer's own report arrives.

Quitting runs the same dialog for the window. `before-quit` only flushes the draft. The kernel shuts down in `will-quit`, once every window has closed, so Cancel leaves the notebook open with its kernel alive.

## Adding a call

See [recipes.md](recipes.md#add-an-ipc-call).
