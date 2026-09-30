# IPC between the renderer and the main process

The whole contract is in `packages/shared/src/ipc.ts`. Three files implement it:

- `electron/main.ts` registers the handlers with its `handle()` and `on()` wrappers around `ipcMain`.
- `electron/preload.ts` maps each `DallianceApi` method onto a channel and exposes the object as `window.dalliance`.
- `src/store/notebook-store.ts` and the components call `getApi()`.

Channel names are in the `IPC` constant. Never type a channel string by hand.

## Who may call

Every handler goes through `handle()` or `on()` in `main.ts`, never `ipcMain` directly. They check the message with `isTrustedSender()` from `electron/ipc-sender.ts`: it must come from the top frame of the app's window, and that frame must show the app's own page. That page is the Vite dev server's origin in development, and the packaged `dist/index.html` file otherwise, whatever the hash or query. Anything else, such as an iframe or a page the window somehow reached, is logged with `console.warn`. An `invoke` from it rejects, and a `send` is dropped.

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
| `listPackages()` | invoke | `session.environment` | The Python in use and its libraries with versions, an `EnvironmentView`. `installedPackages()` in `electron/kernel/python-packages.ts` reads the interpreter with `importlib.metadata` in its own process, so a running cell doesn't hold it up. It runs in userData, since `python -c` puts its working directory first on `sys.path` and a stray `json.py` there would shadow the standard library. A failure comes back as `error`, never a throw: no Python, a timeout after 20 seconds, or the last line Python wrote to stderr |
| `getSettings()` | invoke | `settings.view` | `SettingsView`, never the keys themselves |
| `updateSettings(update)` | invoke | `settings.update` | Returns the new view. Restarts the kernel if `pythonPath` changed |
| `listModels()` | invoke | `listModels` | Models for the picker |
| `checkKey(provider, key)` | invoke | `checkKey` | Asks the provider whether a key works, without saving it. A `KeyCheck` with the balance or the reason |
| `pythonState()` | invoke | `session.pythonState` | Which Python, which version, missing packages |
| `setupPython()` | invoke | `session.setupPython` | Creates the managed venv, then restarts the kernel |
| `openNotebook()` | invoke | dialog, `openFile` | Open dialog, parse, restart the kernel in that folder. A kernel still starting in the old folder shuts itself down. A file the OS asked to open takes the dialog's place, see [Opening files from the OS](#opening-files-from-the-os) |
| `newNotebook(notebook)` | invoke | `createNotebook` | Writes the notebook as `Untitled.ipynb` in the folder in use, or in the default folder when that is a broad one like Documents, restarts the kernel there, returns the path. A folder that has gone is made again. When the write fails, a dialog says why and the result is null |
| `renameNotebook(current, name, notebook)` | invoke | `renameNotebookFile`, `notebookPathIn` | Renames the file in its folder and moves its recent entry and draft. `current` must be an absolute `.ipynb` path, as for `saveNotebook`, and any other comes back as an error. With no file yet, writes the notebook under that name where `newNotebook` would, never over a file that is there. Returns a `RenameResult`: the path, or an `error` for a bad name, a taken one, or a disk that refuses. Never throws |
| `openFolder(notebook)` | invoke | dialog, `createNotebook` | Asks for a folder, which the dialog can create, then does what `newNotebook` does in it. Null when cancelled, or when the write fails |
| `openRecent(path)` | invoke | `openFile` | Same without a dialog. Only opens a path in `settings.recent`, and returns null for any other. Drops the entry if the file is gone |
| `recentNotebooks()` | invoke | `settings.recent` | Up to 8 that still exist |
| `saveNotebook(path, notebook)` | invoke | dialog, `writeFileAtomic` | Save, or Save As when `path` is null. A `path` that isn't an absolute `.ipynb` path gets the Save dialog too. Returns the path or null |
| `confirmDiscard()` | invoke | dialog | True when the document is clean or the user discards. Keeping the changes also drops a file the OS asked to open |
| `readBrief()`, `writeBrief(text)` | invoke | `session` | The workspace's `AGENTS.md` |
| `listFiles()` | invoke | `session.files` | Workspace files, empty for broad folders |
| `restoreSession()` | invoke | `drafts.restore` | The notebook to show at load, or a `RestoreFailure` with the reason it couldn't reopen, or null. See [storage.md](storage.md#session-and-drafts) |
| `saveDraft(state)` | send | `drafts.update` | Mirrors the document to the main process |
| `getAccount()` | invoke | `account.current` | The Dalliance account as an `AccountView`. Signed out in builds without Dalliance Cloud. See [cloud.md](cloud.md) |
| `signIn()` | invoke | `account.signIn` | Opens the sign-in page in the browser and sets `waiting` |
| `redeemSignInCode(code)` | invoke | `account.redeem` | The code the sign-in page shows when the browser couldn't open the app |
| `signOut()` | invoke | `account.signOut` | Signs out here. The server session expires on its own |
| `getBilling()` | invoke | `billing.current` | The plan as a `BillingView`. `available` is false in builds without Dalliance Cloud |
| `startCheckout(plan)` | invoke | `billing.checkout` | Opens checkout for the plan in the browser. Only takes `pro` |
| `openBillingPortal()` | invoke | `billing.portal` | Opens the billing portal in the browser |
| `countCredits(generationIds)` | invoke | `billing.credits` | The credits Dalliance Cloud counted for a run's calls, once they've all landed or after 90 seconds. Null when none were, and in builds without Dalliance Cloud. See [agent-harness.md](agent-harness.md#costs) |
| `setDocumentState({ path, dirty })` | send | `updateTitle` | Window title and the macOS edited dot |

## Events from main

Each `on*` method subscribes and returns an unsubscribe function.

| Method | Channel | Payload |
| --- | --- | --- |
| `onRunEvent` | `run-event` | `(cellId, RunEvent)` |
| `onKernelState` | `kernel-state-changed` | `KernelState` |
| `onPythonLog` | `python-log` | One line of venv or pip output |
| `onMenu` | `menu` | A `MenuAction` from the app menu |
| `onAccount` | `account-changed` | `AccountView`, after sign-in, sign-out or a session check |
| `onBilling` | `billing-changed` | `BillingView`, whenever the plan or its credits change |

`RunEvent` is a union:

| `type` | Meaning | Renderer effect |
| --- | --- | --- |
| `status` | Short text like "Reading the notebook" | The spinner line |
| `activity` | A tool call started, got its label, or finished, keyed by id. `explore` and `run_cell` steps carry their `code` | The live activity list |
| `attempt` | A new `run_cell` attempt | Clears live outputs, shows the attempt's code |
| `output` | One output from the running attempt | Appended to live outputs |
| `question` | `ask_user` is waiting | The question card |
| `approval` | An install is waiting | The Install / Don't install bar |
| `title` | A short name arrived, with what it cost when Show costs is on | Written straight onto the cell, even after the run. The cost goes to the notebook's total |

## Menu actions

`electron/menu.ts` builds the native menu. Each item sends a `MenuAction` string and the renderer's `handleMenu()` in `src/App.tsx` acts on it. The View menu's Cmd+B and Cmd+1 to Cmd+6 items set `registerAccelerator: false`, because the renderer handles those keys itself and the menu only displays them.

## Opening files from the OS

Dalliance runs one instance. `main.ts` takes `app.requestSingleInstanceLock()` at startup, and a second launch quits right away after handing its command line to the first through `second-instance`. The first brings its window forward.

A notebook can arrive three ways: the macOS `open-file` event (a double-click in Finder, a drop on the Dock icon), an `.ipynb` on the first launch's own command line, and one on a second launch's command line. `notebookFromArgv()` in `electron/open-files.ts` picks the last argument ending in `.ipynb` that exists. `open-file` is registered before `ready`, because macOS sends the file that launched the app before then.

Each one goes through the renderer's ordinary Open, so unsaved changes get the Discard prompt:

1. `OpenQueue` keeps the file. Only the latest one is kept.
2. When the page can take menu actions, the queue sends the `open` menu action, once. The preload's `onMenu()` sends `menu-ready` when the renderer subscribes. A reload or a closed window makes the queue wait for the next one.
3. The renderer runs `confirmDiscard()`, then `openNotebook()`, which takes the queued file instead of showing the dialog. A file that doesn't parse gets a message box, and `openNotebook()` returns null.
4. Choosing Cancel in the Discard prompt drops the file, so the next Open shows the dialog.

At launch this runs after `restoreSession()`, so the last notebook comes back first and the file then replaces it.

In builds with Dalliance Cloud, links on the `io.dalliance.app` scheme arrive the same ways: `open-url` on macOS, and the command line elsewhere. They never go through `OpenQueue`. `openLink()` hands them to the account and brings the window forward. See [cloud.md](cloud.md#signing-in).

## Saving and closing

Closing a dirty window shows Save / Don't Save / Cancel from the main process.

- Save sets `allowCloseAfterSave` and sends the `save` menu action. The renderer calls `saveNotebook()`, and the main process closes the window once the file is written. Every save clears the flag when it ends, whether it landed, was cancelled or failed, so a later ordinary Save never closes the window.
- Don't Save calls `drafts.forgetChanges()`, so the next launch reopens the file as it is on disk.

`saveNotebook()` records the saved state in the draft store itself, then moves the kernel's working directory. The window might close before the renderer's own report arrives.

Quitting runs the same dialog for the window. `before-quit` only flushes the draft. The kernel shuts down in `will-quit`, once every window has closed, so Cancel leaves the notebook open with its kernel alive.

## Adding a call

See [recipes.md](recipes.md#add-an-ipc-call).
