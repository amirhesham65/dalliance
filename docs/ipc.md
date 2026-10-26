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
| `getSettings()` | invoke | `settings.view` | `SettingsView` |
| `updateSettings(update)` | invoke | `settings.update` | Returns the new view. Restarts the kernel if `pythonPath` changed |
| `listModels()` | invoke | `listModels` | The local catalog for configured providers, as a `ModelList` |
| `pythonState()` | invoke | `session.pythonState` | Which Python, which version, missing packages |
| `setupPython()` | invoke | `session.setupPython` | Creates the managed venv, then restarts the kernel |
| `openNotebook()` | invoke | dialog, `openFile` | Open dialog, parse, restart the kernel in that folder. A kernel still starting in the old folder shuts itself down. A file the OS asked to open takes the dialog's place, see [Opening files from the OS](#opening-files-from-the-os) |
| `newNotebook(notebook)` | invoke | `createNotebook` | Writes the notebook as `Untitled.ipynb` in the folder in use, or in the default folder when that is a broad one like Documents, restarts the kernel there, returns the path. A folder that has gone is made again. When the write fails, a dialog says why and the result is null |
| `renameNotebook(current, name, notebook)` | invoke | `renameNotebookFile`, `notebookPathIn` | Renames the file in its folder and moves its recent entry and draft. `current` must be an absolute `.ipynb` path, as for `saveNotebook`, and any other comes back as an error. With no file yet, writes the notebook under that name where `newNotebook` would, never over a file that is there, with its pins recorded as a save would. Returns a `RenameResult`: the path, and the pins when it wrote the file, or an `error` for a bad name, a taken one, or a disk that refuses. Never throws |
| `createProject(name, notebook)` | invoke | `projectPathIn`, `startNotebook` | Makes a folder called `name` in the projects folder, writes `notebook` into it as `<name>.ipynb`, and opens it on a kernel there. Takes a name, never a path: the folder comes from `projectsFolder()`. Returns the `OpenedNotebook`, or an `error` for a bad name, a folder already there, or a disk that refuses, and removes the folder again when the notebook can't be written. Never throws |
| `openProject(notebook)` | invoke | dialog, `notebookInProject`, `openFile` | Asks for a folder and opens the notebook last opened there, or the newest one right in it. A folder without notebooks gets `notebook` as its first, as `newNotebook` would. A broad folder like Documents is refused with a message box. Null when cancelled or refused |
| `projectsFolder()` | invoke | `settings.projectsDir` | The folder new projects go in: the one chosen for them, or the default folder |
| `chooseProjectsFolder()` | invoke | dialog, `settings.setProjectsDir` | Asks for the folder new projects go in, which the dialog can create, and remembers it. Null when cancelled |
| `openRecent(path)` | invoke | `openFile` | Same without a dialog. Only opens a path in `settings.recent`, and returns null for any other. Drops the entry if the file is gone |
| `recentNotebooks()` | invoke | `settings.recent` | Up to 8 that still exist |
| `saveNotebook(path, notebook)` | invoke | dialog, `session.pin`, `writeFileAtomic` | Save, or Save As when `path` is null. A `path` that isn't an absolute `.ipynb` path gets the Save dialog too. Records the notebook's pins first, see [notebook-model.md](notebook-model.md#pins). Returns a `SavedNotebook`, the path and the pins it recorded, or null when the dialog was cancelled |
| `checkPins(pins)` | invoke | `session.checkPins` | What differs from the pins now, as `PinChange[]`, empty when nothing does. The pins are type-checked with `pinsFromNb()` first, and a path that is absolute or leaves the folder in use is never read. Reads the interpreter and the files, never the kernel, so a running cell doesn't hold it up |
| `confirmDiscard()` | invoke | dialog | True when the document is clean or the user discards. Keeping the changes also drops a file the OS asked to open |
| `readBrief()`, `writeBrief(text)` | invoke | `session` | The workspace's `AGENTS.md` |
| `listFiles(directory?)` | invoke | `session.files` | Immediate files and folders in a workspace-relative directory, with no count or depth limit. Defaults to the root. Empty for broad folders; refuses paths or symlinks that leave the workspace |
| `attachFiles(files)` | invoke | preload `webUtils.getPathForFile`, `copyIntoUploads` | Copies files dropped in the window into `uploads/` in the folder in use, and returns an `AttachResult`: their paths inside the folder, and an `error` naming any that couldn't be copied. The window passes `File` objects, and the preload turns them into paths with `webUtils.getPathForFile()`, which only knows files from a real drop, so the window never names a path. Refused in a broad folder. Never throws |
| `revealFolder()` | invoke | `shell.openPath(session.dir)` | Opens the folder in use in Finder or the platform's file manager. Takes no path, so the window can only open that folder. Rejects with the reason when the OS can't open it |
| `revealFile(file)` | invoke | `shell.showItemInFolder` | Reveals and selects an existing workspace file in Finder or the platform's file manager. Refuses directories, absolute paths, traversal, broad folders and symlinks outside the workspace |
| `restoreSession()` | invoke | `drafts.restore` | The notebook to show at load, or a `RestoreFailure` with the reason it couldn't reopen, or null. See [storage.md](storage.md#session-and-drafts) |
| `saveDraft(state)` | send | `drafts.update` | Mirrors the document to the main process |
| `getProviderKeys()` | invoke | `keys.view` | Configured flags and secure storage status, never saved key values |
| `setProviderKey(provider, key)` | invoke | `keys.set` | Validate and save a provider key. Empty input removes it |
| `getUpdate()` | invoke | `updates.current` | A newer release as an `UpdateView`, or null when none has been found. See [releasing.md](releasing.md#update-notices) |
| `downloadUpdate()` | invoke | `updates.download` | Opens the website's download in the browser |
| `setDocumentState({ path, dirty })` | send | `updateTitle` | Window title and the macOS edited dot |

## Events from main

Each `on*` method subscribes and returns an unsubscribe function.

| Method | Channel | Payload |
| --- | --- | --- |
| `onRunEvent` | `run-event` | `(cellId, RunEvent)` |
| `onKernelState` | `kernel-state-changed` | `KernelState` |
| `onPythonLog` | `python-log` | One line of venv or pip output |
| `onMenu` | `menu` | A `MenuAction` from the app menu |
| `onUpdate` | `update-found` | `UpdateView`, when a check finds a newer release |

`RunEvent` is a union:

| `type` | Meaning | Renderer effect |
| --- | --- | --- |
| `status` | Short text like "Reading the notebook" | The spinner line |
| `activity` | A tool call started, got its label, or finished, keyed by id. `explore` and `run_cell` steps carry their `code` | The live activity list |
| `attempt` | A new `run_cell` attempt | Clears live outputs, shows the attempt's code |
| `output` | One output from the running attempt | Appended to live outputs |
| `question` | `ask_user` is waiting | The question card |
| `approval` | An install is waiting | The Install / Don't install bar |
| `title` | A short name arrived, with what it cost | Written straight onto the cell, even after the run. The cost goes to the notebook's total |

## Menu actions

`electron/menu.ts` builds the native menu. Each item sends a `MenuAction` string and the renderer's `handleMenu()` in `src/App.tsx` acts on it. The View menu's Cmd+B and Cmd+1 to Cmd+6 items set `registerAccelerator: false`, because the renderer handles those keys itself and the menu only displays them.

## Opening files from the OS

Dalliance runs one instance. `main.ts` takes `app.requestSingleInstanceLock()` at startup, and a second launch calls `app.exit(0)` as soon as it fails to get the lock, after handing its command line to the first through `second-instance`. The first brings its window forward.

A notebook can arrive three ways: the macOS `open-file` event (a double-click in Finder, a drop on the Dock icon), an `.ipynb` on the first launch's own command line, and one on a second launch's command line. `notebookFromArgv()` in `electron/open-files.ts` picks the last argument ending in `.ipynb` that exists. `open-file` is registered before `ready`, because macOS sends the file that launched the app before then.

Each one goes through the renderer's ordinary Open, so unsaved changes get the Discard prompt:

1. `OpenQueue` keeps the file. Only the latest one is kept.
2. When the page can take menu actions, the queue sends the `open` menu action, once. The preload's `onMenu()` sends `menu-ready` when the renderer subscribes. A reload or a closed window makes the queue wait for the next one.
3. The renderer runs `confirmDiscard()`, then `openNotebook()`, which takes the queued file instead of showing the dialog. A file that doesn't parse gets a message box, and `openNotebook()` returns null.
4. Choosing Cancel in the Discard prompt drops the file, so the next Open shows the dialog.

At launch this runs after `restoreSession()`, so the last notebook comes back first and the file then replaces it.


## Saving and closing

Closing a dirty window shows Save / Don't Save / Cancel from the main process.

- Save sets `allowCloseAfterSave` and sends the `save` menu action. The renderer calls `saveNotebook()`, and the main process closes the window once the file is written. Every save clears the flag when it ends, whether it landed, was cancelled or failed, so a later ordinary Save never closes the window.
- Don't Save calls `drafts.forgetChanges()`, so the next launch reopens the file as it is on disk.

`saveNotebook()` records the pins, writes the file, records the saved state in the draft store itself, then moves the kernel's working directory. The window might close before the renderer's own report arrives.

Quitting runs the same dialog for the window. `before-quit` only flushes the draft. The kernel shuts down in `will-quit`, once every window has closed, so Cancel leaves the notebook open with its kernel alive.

## Adding a call

See [recipes.md](recipes.md#add-an-ipc-call).
