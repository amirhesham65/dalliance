# IPC between the renderer and the main process

The whole contract is in `packages/shared/src/ipc.ts`. Three files implement it:

- `electron/main.ts` registers the handlers with its `handle()` and `on()` wrappers around `ipcMain`.
- `electron/preload.ts` maps each `DallianceApi` method onto a channel and exposes the object as `window.dalliance`.
- `src/store/notebook-store.ts` and the components call `getApi()`.

Channel names are in the `IPC` constant. Never type a channel string by hand.

## Who may call

Every handler goes through `handle()` or `on()` in `main.ts`, never `ipcMain` directly. They check the message with `isTrustedSender()` from `electron/ipc-sender.ts`: it must come from the top frame of one of the tab views, and that frame must show the app's own page. That page is the Vite dev server's origin in development, and the packaged `dist/index.html` file otherwise, whatever the hash or query. Anything else, such as an iframe, a view that isn't a tab, a tab that has closed, or a page a view somehow reached, is logged with `console.warn`. An `invoke` from it rejects, and a `send` is dropped.

The wrappers then hand the listener the tab whose page sent the call, not the event. So every call below acts on that tab: its `NotebookSession`, kernel, folder, draft and notebook. The main side column calls the tab's session `session`.

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
| `updateSettings(update)` | invoke | `settings.update` | Returns the new view and sends it to every tab over `settings-changed`. If `pythonPath` changed, restarts every tab's kernel in use and sends the new `PythonState` to every tab |
| `listModels()` | invoke | `listModels` | Models for the picker |
| `checkKey(provider, key)` | invoke | `checkKey` | Asks the provider whether a key works, without saving it. A `KeyCheck` with the balance or the reason |
| `pythonState()` | invoke | `session.pythonState` | Which Python, which version, missing packages |
| `setupPython()` | invoke | `session.setupPython` | Creates the managed venv, then restarts every tab's kernel in use, since they all run on it, and sends the new `PythonState` to every tab |
| `openNotebook()` | invoke | dialog, `openFile` | Open dialog, parse, then place it, see [Where a notebook opens](#where-a-notebook-opens). A kernel in use restarts in the file's folder, and one still starting in the old folder shuts itself down. A file the OS asked to open takes the dialog's place, see [Opening files from the OS](#opening-files-from-the-os) |
| `newNotebook(notebook)` | invoke | `createNotebook` | Writes the notebook as `Untitled.ipynb` in the tab's folder, or in the default folder when that is a broad one like Documents, and places it with a fresh kernel there. A folder that has gone is made again. When the write fails, a dialog says why and the result is null |
| `renameNotebook(current, name, notebook)` | invoke | `renameNotebookFile`, `notebookPathIn` | Renames the file in its folder and moves its recent entry and draft. `current` must be an absolute `.ipynb` path, as for `saveNotebook`, and any other comes back as an error. With no file yet, writes the notebook under that name where `newNotebook` would, never over a file that is there, with its pins recorded as a save would. Returns a `RenameResult`: the path, and the pins when it wrote the file, or an `error` for a bad name, a taken one, or a disk that refuses. Never throws |
| `openFolder(notebook)` | invoke | dialog, `createNotebook` | Asks for a folder, which the dialog can create, then does what `newNotebook` does in it. Null when cancelled, or when the write fails |
| `openRecent(path)` | invoke | `openFile` | Same as `openNotebook` without a dialog. Only opens a path in `settings.recent`, and returns null for any other. Drops the entry if the file is gone |
| `recentNotebooks()` | invoke | `settings.recent` | Up to 8 that still exist |
| `saveNotebook(path, notebook)` | invoke | dialog, `session.pin`, `writeFileAtomic` | Save, or Save As when `path` is null. A `path` that isn't an absolute `.ipynb` path gets the Save dialog too. Records the notebook's pins first, see [notebook-model.md](notebook-model.md#pins). Returns a `SavedNotebook`, the path and the pins it recorded, or null when the dialog was cancelled. Ends a close that was waiting on it, see [Saving and closing](#saving-and-closing) |
| `checkPins(pins)` | invoke | `session.checkPins` | What differs from the pins now, as `PinChange[]`, empty when nothing does. The pins are type-checked with `pinsFromNb()` first, and a path that is absolute or leaves the folder in use is never read. Reads the interpreter and the files, never the kernel, so a running cell doesn't hold it up |
| `readBrief()`, `writeBrief(text)` | invoke | `session` | The workspace's `AGENTS.md` |
| `listFiles()` | invoke | `session.files` | Workspace files, empty for broad folders |
| `restoreSession()` | invoke | `drafts.restore` | The notebook the tab shows at load, or a `RestoreFailure` with the reason it couldn't reopen, or null for the start page. See [storage.md](storage.md#session-and-drafts) |
| `saveDraft(state)` | send | `drafts.update` | Mirrors the tab's document to the main process |
| `getAccount()` | invoke | `account.current` | The Dalliance account as an `AccountView`. Signed out in builds without Dalliance Cloud. See [cloud.md](cloud.md) |
| `signIn()` | invoke | `account.signIn` | Opens the sign-in page in the browser and sets `waiting` |
| `redeemSignInCode(code)` | invoke | `account.redeem` | The code the sign-in page shows when the browser couldn't open the app |
| `signOut()` | invoke | `account.signOut` | Signs out here. The server session expires on its own |
| `getBilling()` | invoke | `billing.current` | The plan as a `BillingView`. `available` is false in builds without Dalliance Cloud |
| `startCheckout(plan)` | invoke | `billing.checkout` | Opens checkout for the plan in the browser. Only takes `pro` |
| `openBillingPortal()` | invoke | `billing.portal` | Opens the billing portal in the browser |
| `countCredits(generationIds)` | invoke | `billing.credits` | The credits Dalliance Cloud counted for a run's calls, once they've all landed or after 90 seconds. Null when none were, and in builds without Dalliance Cloud. See [agent-harness.md](agent-harness.md#costs) |
| `setDocumentState({ path, dirty, running })` | send | `tabs.report` | The tab's name, unsaved changes and whether a cell is queued or running, for the tab strip. For the tab showing, also the window title and the macOS edited dot |
| `listTabs()` | invoke | `tabs.info` | The window's tabs as a `TabsState`: each `TabInfo` in order, `activeId`, and `selfId`, the tab asking |
| `newTab()` | invoke | `openTab` | A tab on the start page, at the end of the strip, shown |
| `closeTab(id)` | invoke | `tabs.close` | Closes that tab, with Save / Don't Save / Cancel when it has unsaved changes. The last tab closes the window instead |
| `switchTab(id)` | invoke | `tabs.activate` | Shows that tab. An unknown id does nothing |

## Events from main

Each `on*` method subscribes and returns an unsubscribe function.

| Method | Channel | Payload |
| --- | --- | --- |
| `onRunEvent` | `run-event` | `(cellId, RunEvent)` |
| `onKernelState` | `kernel-state-changed` | `KernelState` |
| `onPythonLog` | `python-log` | One line of venv or pip output. Every tab gets it |
| `onMenu` | `menu` | A `MenuAction` from the app menu. Only the tab showing gets it |
| `onTabs` | `tabs-changed` | `TabsState`, each time a tab opens, closes or switches, or one's name, unsaved changes or running state changes |
| `onSettingsChanged` | `settings-changed` | The new `SettingsView`, after any tab changed a setting |
| `onPythonState` | `python-state-changed` | The new `PythonState`, after a setup or a new Python path in any tab |
| `onAccount` | `account-changed` | `AccountView`, after sign-in, sign-out or a session check. Every tab gets it |
| `onBilling` | `billing-changed` | `BillingView`, whenever the plan or its credits change. Every tab gets it |

`onRunEvent` and `onKernelState` only reach the tab that owns the run or the kernel.

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

`electron/menu.ts` builds the native menu. Most items send a `MenuAction` string to the tab showing, and the renderer's `handleMenu()` in `src/App.tsx` acts on it. The View menu's Cmd+B and Cmd+1 to Cmd+6 items set `registerAccelerator: false`, because the renderer handles those keys itself and the menu only displays them.

The tab items are a `TabCommand` the main process handles itself, since they act on the window rather than one page: File > New Tab (Cmd+T), Close Tab (Cmd+W) and Close Window (Shift+Cmd+W), and Window > Show Next Tab (Ctrl+Tab) and Show Previous Tab (Ctrl+Shift+Tab). Two hidden copies with `acceleratorWorksWhenHidden` add Shift+Cmd+] and Shift+Cmd+[. Number keys stay with the side panes. File > Open Recent lists `settings.recent`, and `buildMenu()` runs again whenever that list changes. A recent notebook opens the way a file from the OS does.

## Tabs

The main process owns the tab list, see [architecture.md](architecture.md#tabs). Each page draws the strip from `listTabs()` and `onTabs`, and tells the main process about its own notebook with `setDocumentState()`. `selfId` says which tab the page is. Only the tab showing is on screen, so its strip is the one people see.

### Where a notebook opens

`openNotebook()`, `newNotebook()`, `openFolder()` and `openRecent()` all place the notebook the same way, with `tabs.placement()`:

1. A tab that has the file open already comes forward. The result is null.
2. Otherwise, when the calling tab is an untouched Untitled, with no file and no unsaved changes, the notebook opens there. A kernel in use restarts in its folder, and the result is the notebook for the page to load.
3. Otherwise a new tab opens with it, at the end of the strip, and shows. Its page gets the notebook from `restoreSession()`, and its kernel waits for its first run. The result is null.

A notebook with changes is never replaced, so no open asks to discard anything. A null result, as for a cancel, leaves the calling page as it was.

## Opening files from the OS

Dalliance runs one instance. `main.ts` takes `app.requestSingleInstanceLock()` at startup, and a second launch quits right away after handing its command line to the first through `second-instance`. The first brings its window forward.

A notebook can arrive three ways: the macOS `open-file` event (a double-click in Finder, a drop on the Dock icon), an `.ipynb` on the first launch's own command line, and one on a second launch's command line. `notebookFromArgv()` in `electron/open-files.ts` picks the last argument ending in `.ipynb` that exists. `open-file` is registered before `ready`, because macOS sends the file that launched the app before then. File > Open Recent takes the same path.

A tab that has the file open already just comes forward. Anything else goes through the ordinary Open of the tab showing, so it lands [where any notebook opens](#where-a-notebook-opens): in that tab when it's an untouched Untitled, in a new tab otherwise.

1. `OpenQueue` keeps the file. Only the latest one is kept.
2. When the tab showing can take menu actions, the queue sends it the `open` menu action, once. The preload's `onMenu()` sends `menu-ready` when the renderer subscribes, and the main process marks that tab ready. A reload, a switch to a tab whose page isn't ready yet, or a closed window makes the queue wait.
3. The renderer calls `openNotebook()`, which takes the queued file instead of showing the dialog. A file that doesn't parse gets a message box, and `openNotebook()` returns null.

At launch this runs after `restoreSession()`, so the last tabs come back first and the file then opens beside them.

In builds with Dalliance Cloud, links on the `io.dalliance.app` scheme arrive the same ways: `open-url` on macOS, and the command line elsewhere. They never go through `OpenQueue`. `openLink()` hands them to the account and brings the window forward. See [cloud.md](cloud.md#signing-in).

## Saving and closing

Closing a tab with unsaved changes shows Save / Don't Save / Cancel from the main process, with the tab brought forward first. `Tabs.close()` in `electron/tabs.ts` runs it:

- Save sets the tab's `afterSave` and sends it the `save` menu action. The renderer calls `saveNotebook()`, and the tab closes once the file is written. Every save calls `tabs.finishSave()` in a `finally` when it ends, whether it landed, was cancelled or failed, so a cancelled Save dialog keeps the tab and a later ordinary Save never closes anything. A page that isn't taking menu actions, or reloads mid-save, counts as a save that didn't land.
- Don't Save calls `drafts.forgetChanges()`, so the next launch reopens the file as it is on disk.
- Closing a tab shuts its kernel down and drops its draft. The tab to its right shows next, or the one to its left.
- Closing the last tab closes the window, as a browser does.

Closing the window, or quitting, walks every tab with unsaved changes through the same dialog in strip order, with `Tabs.confirmAll()`. Cancel on any of them, or a save that doesn't land, stops the whole close, and the window stays with every tab. Don't Save only forgets a tab's changes once every tab has answered, so a Cancel later in the walk keeps them too. When the walk came from quitting, the app quits once it's done.

`saveNotebook()` records the pins, writes the file, records the saved state in the draft store itself, then moves the kernel's working directory. The tab or the window might close before the renderer's own report arrives.

`before-quit` only flushes the drafts. When the window closes, `session.json` is written with every tab, then each tab's kernel shuts down. `will-quit` shuts down any that are left, so Cancel leaves every notebook open with its kernel alive.

## Adding a call

See [recipes.md](recipes.md#add-an-ipc-call).
