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
| `restartKernel()` | invoke | `session.restart` | Fresh kernel in the same folder |
| `kernelState()` | invoke | `session.kernelState` | Last known `KernelState` |
| `listVariables()` | invoke | `session.variables` | Variables for the side pane |
| `getSettings()` | invoke | `settings.view` | `SettingsView`, never the keys themselves |
| `updateSettings(update)` | invoke | `settings.update` | Returns the new view. Restarts the kernel if `pythonPath` changed |
| `listModels()` | invoke | `listModels` | Models for the picker |
| `checkKey(provider, key)` | invoke | `checkKey` | Asks the provider whether a key works, without saving it. A `KeyCheck` with the balance or the reason |
| `pythonState()` | invoke | `session.pythonState` | Which Python, which version, missing packages |
| `setupPython()` | invoke | `session.setupPython` | Creates the managed venv, then restarts the kernel |
| `openNotebook()` | invoke | dialog, `openFile` | Open dialog, parse, restart the kernel in that folder |
| `openRecent(path)` | invoke | `openFile` | Same without a dialog. Drops the entry if the file is gone |
| `recentNotebooks()` | invoke | `settings.recent` | Up to 8 that still exist |
| `saveNotebook(path, notebook)` | invoke | dialog, `writeFile` | Save, or Save As when `path` is null. Returns the path or null |
| `confirmDiscard()` | invoke | dialog | True when the document is clean or the user discards |
| `readBrief()`, `writeBrief(text)` | invoke | `session` | The workspace's `AGENTS.md` |
| `listFiles()` | invoke | `session.files` | Workspace files, empty for broad folders |
| `restoreSession()` | invoke | `drafts.restore` | The notebook to show at load. See [storage.md](storage.md#session-and-drafts) |
| `saveDraft(state)` | send | `drafts.update` | Mirrors the document to the main process |
| `setDocumentState({ path, dirty })` | send | `updateTitle` | Window title and the macOS edited dot |
| `getAccount()` | invoke | `account.current` | The `AccountView`: name and email, or null. Never the session |
| `signIn()` | invoke | `account.signIn` | Opens the sign-in page in the browser. See [accounts.md](accounts.md) |
| `redeemSignInCode(code)` | invoke | `account.redeem` | The code from the sign-in page, for when the browser couldn't open the app |
| `signOut()` | invoke | `account.signOut` | Ends the session on the server and forgets it locally |

## Events from main

Each `on*` method subscribes and returns an unsubscribe function.

| Method | Channel | Payload |
| --- | --- | --- |
| `onRunEvent` | `run-event` | `(cellId, RunEvent)` |
| `onKernelState` | `kernel-state-changed` | `KernelState` |
| `onPythonLog` | `python-log` | One line of venv or pip output |
| `onMenu` | `menu` | A `MenuAction` from the app menu |
| `onAccount` | `account-changed` | `AccountView`, when a sign-in lands, the session ends or the check fails |

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

- Save sets `allowCloseAfterSave` and sends the `save` menu action. The renderer calls `saveNotebook()`, and the main process closes the window once the file is written. Cancelling the save dialog clears the flag.
- Don't Save calls `drafts.forgetChanges()`, so the next launch reopens the file as it is on disk.

`saveNotebook()` records the saved state in the draft store itself, then moves the kernel's working directory. The window might close before the renderer's own report arrives.

## Adding a call

See [recipes.md](recipes.md#add-an-ipc-call).
