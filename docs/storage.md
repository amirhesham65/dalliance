# Files on disk

Everything the app writes goes in one of three places: Electron's userData folder, the notebook's own folder, or the renderer's `localStorage`.

## userData

On macOS this is `~/Library/Application Support/Dalliance/`. The code gets it with `app.getPath('userData')`.

| Path | Written by | Holds |
| --- | --- | --- |
| `settings.json` | `SettingsStore`, `electron/settings.ts` | Model, effort, Python path, approval mode, titles on or off, suggested next prompts on or off, Show costs on or off, onboarded, the folder in use, the folder for new projects, recent notebooks. No keys. Mode `0600` |
| `account.json` | The Better Auth Electron client, `electron/cloud/account.ts` | The Dalliance account's session, each value encrypted with `safeStorage`. Without a keychain the session stays in memory. Mode `0600` |
| `session.json` | `DraftStore`, `electron/draft.ts` | The open notebook's path, whether it's dirty, and its contents when dirty |
| `logs/agent.jsonl` | `createRunLog()` and `logRuns()`, `electron/harness/extensions.ts` | One line per `run_start`, `tool_call`, `tool_result`, `step` (one per model call, with its reasoning summary) and `run_end`, strings clipped to 2,000 characters except the reasoning summaries. At 5 MB it moves to `agent.jsonl.1`, replacing the old backup. It holds the full trail behind each cell's record of how it was made. The notebook keeps only the final attempt |
| `python-env/` | `setupManagedEnv()`, `electron/kernel/python-env.ts` | The managed virtual environment |
| `kernel/dalliance_kernel.py` | `PythonKernel.start()` | The kernel script, rewritten on every start |

To reset the app to a first launch, quit it and delete this folder.

`settings.json`, `session.json` and saved notebooks are written with `writeFileAtomic` or `writeFileAtomicSync` from `electron/atomic-write.ts`. The data goes to a temporary file in the same folder, is flushed to disk, then renamed over the old file. A crash or a full disk mid-write leaves the old file whole. The new file keeps the old one's mode, or the mode the caller asks for.

## Settings

`SettingsStore` reads `settings.json` once, merges it over `DEFAULTS`, and writes the whole file on every change. A file that doesn't parse, or isn't a JSON object, is renamed to `settings.json.corrupt-<timestamp>` and the app starts from the defaults. The old file is kept so the next save can't overwrite the recent notebooks it may still hold. The main process logs the move with `console.warn`.

`settings.json` holds no keys. Models run on Dalliance Cloud with the account's token: the session is in `account.json`, and the Convex token only in `Account`'s memory. See [cloud.md](cloud.md). The file is still written with mode `0600`, since it lists the user's folders and notebooks.

`SettingsStore` takes the userData folder and a `CloudAccess`, and `modelConfig()` returns `{ model, effort, cloud }` for `resolveModel()`. `SettingsView` gives the renderer `model`, `effort`, `pythonPath`, `approvalMode`, `autoTitles`, `suggestNext`, `showCosts` and `onboarded`, and `SettingsUpdate` takes the same fields.

Settings have no migrations. Nothing is released to users yet, so a renamed or retired setting is just changed. A setting the file doesn't have takes its default.

## Session and drafts

`DraftStore` makes a window reload or a relaunch come back to the same notebook.

The renderer sends the document with `saveDraft()` 400 ms after each change and on `beforeunload`. The main process keeps it in memory and writes `session.json` 1 second after the last update, on save, on quit, and on Don't Save.

`restore()` answers `restoreSession()` at load:

| Situation | Result |
| --- | --- |
| The window reloaded, the app kept running | The in-memory draft with `kernelKept: true`. Variables are still in the kernel. A cell that was running gets interrupted, since nothing is left to receive its result |
| Relaunch, clean notebook with a file | The file as it is on disk now, so outside edits show up |
| Relaunch, dirty notebook | The unsaved copy from `session.json`, still dirty. Its path is kept if the file still exists |
| Nothing saved, or the file is gone and nothing was unsaved | `null`, and the renderer shows the start page |
| The notebook is there but won't open: a newer version of Dalliance saved it, or it doesn't parse | A `RestoreFailure` with the path and the reason. The renderer shows the start page and the reason as an error notice |

When the notebook that won't open is an unsaved copy, it only exists in `session.json`, and the next draft would overwrite it. So `restore()` first renames `session.json` to `session.json.unrestored-<timestamp>` and names that file in the message. A saved file is left alone, so the next launch tries it again, and an updated app opens it.

`session.json` only carries notebook contents while there are unsaved changes.

## The notebook's folder

The folder holding the `.ipynb` is the workspace. The kernel runs there, the agent can list and read files there, and the brief is `AGENTS.md` there. The folder in use is remembered in `settings.json` as `workspaceDir`. `openWorkspace()` and `moveWorkspace()` set it, so it follows whatever notebook was opened or saved last. The next launch starts there, and falls back to `~/Documents/Dalliance Notebooks/`, created at startup, when the folder is gone. That default is also what keeps a first notebook from running in all of Documents. Opening a notebook kept straight in a broad folder, like Documents, Desktop or the home folder (`isBroadFolder()` in `electron/harness/workspace.ts`), makes that the folder in use, but `folderForNewNotebook()` in `electron/notebook-files.ts` sends new notebooks, and a first name for an unsaved one, to the default folder instead. A launch that remembers such a folder starts in the default one too, until a notebook is opened.

## Projects

A project is a folder of its own: its notebooks, its data and its brief, so the agent works in it and nowhere else. Nothing marks a folder as a project on disk. `createProject(name, notebook)` makes the folder in the projects folder and writes its first notebook under the project's name, `Churn/Churn.ipynb`. The projects folder is `projectsDir` in `settings.json`, set only by `chooseProjectsFolder()` from a system dialog, and the default folder when it is unset or gone. The name goes through `cleanProjectName()`, which has the same rules as a notebook name, and `projectPathIn()` refuses a folder that is already there. The folder is made without `recursive`, so one that appears after the check is never taken over, and it is removed again, only if empty, when the notebook can't be written.

Files dropped on a prompt cell are copied into `uploads/` in the folder in use, by `copyIntoUploads()` in `electron/uploads.ts`, and the cell keeps their paths inside the folder. A name already taken gets the next free one, `labs 2.csv`, and the copy uses `COPYFILE_EXCL`, so nothing is ever overwritten. A file already inside the folder is attached where it is, without a copy. Folders and files that have gone are skipped and named in the result's `error`. Nothing is copied when the folder in use is a broad one like Documents. Taking a file off a cell leaves the copy in `uploads/`, since another cell may use it.

`openProject(notebook)` asks for a folder and opens one notebook in it, chosen by `notebookInProject()` in `electron/notebook-files.ts`: the most recent entry in `settings.recent` from that folder, then the most recently changed `.ipynb` right in it, skipping hidden files and subfolders. A folder without notebooks gets a new `Untitled.ipynb`. Broad folders are refused, since the agent can't list them.

A new notebook is a file from the start. `newNotebook(notebook)` writes `Untitled.ipynb` into the folder in use, or `Untitled 2.ipynb` and up when that name is taken (`newNotebookPath()` in `electron/notebook-files.ts`), and starts a fresh kernel there. Only the notebook the window shows at launch, behind the start page, has no file yet. Clicking the name at the top of the overview renames the file in place, as Jupyter does, and for that one notebook writes it under the name typed. `cleanNotebookName()` refuses an empty name, path characters, a leading dot and more than 100 characters, and a name that is already taken in the folder is refused too. Both writes create the file with the `wx` flag, so a file that appears under the chosen name after the check is never overwritten: a new notebook moves on to the next free name, and a rename says the name is taken. A new notebook joins the recent list only once its kernel's folder is open. Unsaved edits stay unsaved through a rename.

The app writes four things into it: a new notebook's `.ipynb` when it is made or first named, the `.ipynb` on save, `AGENTS.md` when the user edits the brief, and copies of dropped files in `uploads/`. The save writes a hidden `.<name>.ipynb.<pid>.<random>.tmp` file next to the notebook and renames it into place. Cells can write anything else, since they're the user's Python.

The app also reads the data files the cells read, to hash them for the notebook's pins: after the run that read them, on save, and when the notebook opens. It never writes them. The hashes are kept in memory only, by path, size and modification time, and files over 1 GB are never read. See [notebook-model.md](notebook-model.md#pins).

## localStorage

Per-window conveniences only. Every read and write is wrapped in try/catch.

| Key | Holds |
| --- | --- |
| `dalliance-sidebar` | `open` or `closed` |
| `dalliance-overview` | Width of the overview column |
| `dalliance-panes` | Width of the side pane column |

## Recent notebooks

`settings.recent` holds up to 8 paths, newest first. Opening or saving a file moves it to the top. `recentNotebooks()` hides entries whose files are gone, and `openRecent()` removes one when it finds the file missing. `openRecent()` refuses any path that isn't on the list. The main process also calls `app.addRecentDocument()` for the macOS Dock menu.
