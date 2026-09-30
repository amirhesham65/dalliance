# Files on disk

Everything the app writes goes in one of three places: Electron's userData folder, the notebook's own folder, or the renderer's `localStorage`.

## userData

On macOS this is `~/Library/Application Support/Dalliance/`. The code gets it with `app.getPath('userData')`.

| Path | Written by | Holds |
| --- | --- | --- |
| `settings.json` | `SettingsStore`, `electron/settings.ts` | Provider, model, effort, Python path, approval mode, titles on or off, suggested next prompts on or off, Show costs on or off, onboarded, the folder in use, encrypted keys, recent notebooks. Mode `0600` |
| `account.json` | The Better Auth Electron client, `electron/cloud/account.ts` | The Dalliance account's session, each value encrypted with `safeStorage`. Without a keychain the session stays in memory. Only in builds with Dalliance Cloud. Mode `0600` |
| `session.json` | `DraftStore`, `electron/draft.ts` | The open tabs in order and the one showing. For each, its notebook's path, whether it's dirty, and its contents when dirty |
| `logs/agent.jsonl` | `createRunLog()` and `logRuns()`, `electron/harness/extensions.ts` | One line per `run_start`, `tool_call`, `tool_result`, `step` (one per model call, with its reasoning summary) and `run_end`, strings clipped to 2,000 characters except the reasoning summaries, each with `tab`, the tab's id, since tabs running at once share the file. At 5 MB it moves to `agent.jsonl.1`, replacing the old backup. It holds the full trail behind each cell's record of how it was made. The notebook keeps only the final attempt |
| `python-env/` | `setupManagedEnv()`, `electron/kernel/python-env.ts` | The managed virtual environment |
| `kernel/dalliance_kernel.py` | `PythonKernel.start()` | The kernel script, rewritten on every start |

To reset the app to a first launch, quit it and delete this folder.

`settings.json`, `session.json` and saved notebooks are written with `writeFileAtomic` or `writeFileAtomicSync` from `electron/atomic-write.ts`. The data goes to a temporary file in the same folder, is flushed to disk, then renamed over the old file. A crash or a full disk mid-write leaves the old file whole. The new file keeps the old one's mode, or the mode the caller asks for.

## Settings and keys

`SettingsStore` reads `settings.json` once, merges it over `DEFAULTS`, and writes the whole file on every change. A file that doesn't parse, or isn't a JSON object, is renamed to `settings.json.corrupt-<timestamp>` and the app starts from the defaults. The old file is kept so the next save can't overwrite the keys and recent notebooks it may still hold. The main process logs the move with `console.warn`. Settings from before the first-run setup existed count as onboarded if they list any recent notebooks.

Keys are stored per provider:

- With `safeStorage.isEncryptionAvailable()`, the key is encrypted with the OS keychain and stored as base64.
- Otherwise it's stored as `plain:<key>`. That only happens on systems without a keychain.

`SettingsView.keyStorage` says which form each provider's key takes: the saved key's form, or for no saved key, the form a new one would get. Model settings warns when it's `plain`.

A saved key can stop decrypting, most often after an update that changes the app's signature and so its keychain identity. `safeStorage` then throws, or returns something that isn't a key (anything but printable ASCII without spaces counts). The key is then treated as missing, so `apiKey()` falls back to the environment and the shell. `SettingsView.unreadableKeys` lists the provider, Model settings says "The saved key couldn't be read, probably after an update. Paste it again.", and the main process logs it once per provider. Saving a new key replaces the unreadable one.

`apiKey(provider)` looks in three places, in order: a stored key, the app's environment, then the user's login shell. The environment variables are `AI_GATEWAY_API_KEY` and `ANTHROPIC_API_KEY`. In development, `electron/main.ts` loads `apps/desktop/.env` into the environment, and packaged builds never do. `SettingsView` tells the renderer whether a key exists and where it came from (`settings`, `environment` or `shell`), never the key.

An app opened from Finder or the Dock doesn't inherit what `~/.zshrc` exports. So at startup `readShellEnv()` in `electron/shell-env.ts` runs the user's `$SHELL` as a login shell once, with a 5 second timeout, and reads those two variables from its `env`. The command prints a marker line first, so whatever the profile prints is skipped. `parseEnv()` starts after the last line that is exactly the marker, not a line containing it, because `sh` and `bash` set `_` to the last argument and `env` prints `_=__DALLIANCE_ENV__` near the end. `useShellKeys()` keeps them in `SettingsStore`, not in `process.env`, because the kernel inherits `process.env` and a cell could print the key. The `getSettings` and `listModels` handlers wait for the read, so the first view already counts them. Windows skips it.

Before the first-run setup is done, `useShellKeys()` also switches to the other provider when only that one has a key, so someone with `ANTHROPIC_API_KEY` in their profile starts on Anthropic.

The renderer saves a key with `saveKey()` in `src/lib/keys.ts`, from both the setup and Settings. It picks the provider from the prefix (`vck_` for the gateway, `sk-ant-` for Anthropic), checks the key with `checkKey()`, and only saves it when the provider doesn't reject it. Typing or pasting a key with a known prefix switches the provider straight away.

Switching provider resets the model to the new provider's default, but only if the old one was still the default. The same goes for a new default: when settings load, a model that is still an earlier version's default (`PREVIOUS_DEFAULT_MODELS` in `harness/model.ts`, today Opus 5) moves to the current one. A model picked by hand stays, though someone who picked the old default on purpose moves too.

## Session and drafts

`DraftStore` makes a reload of a tab, or a relaunch, come back to the same tabs and notebooks.

Each tab's renderer sends its document with `saveDraft()` 400 ms after each change and on `beforeunload`. The main process keeps one draft per tab in memory, with the tabs' order and the one showing, and writes `session.json` 1 second after the last update, on save, on quit, when a tab closes, on Don't Save, and when the window closes.

The file is version 2:

```json
{ "version": 2, "active": 1, "tabs": [{ "path": "/work/sales.ipynb", "dirty": false, "ipynb": null }, { "path": null, "dirty": true, "ipynb": { "cells": [] } }] }
```

`active` is the index of the tab that was showing. A tab with no file and nothing unsaved, such as one on the start page, isn't written, since there is nothing to bring back. Tab ids aren't stored: each launch numbers its tabs afresh. A file from before tabs has no `version` and holds one notebook's `path`, `dirty` and `ipynb` at the top level. `read()` turns it into one tab, and the next write is version 2.

When the window is made, at launch or after macOS kept the app running without one, `read()` gives the tabs to bring back and a tab opens for each, in order, with the one that was showing shown. With none, one tab opens on the start page. When the window closes, the file is written with every tab still open, so they come back next time.

`restore()` answers each tab's `restoreSession()` at load:

| Situation | Result |
| --- | --- |
| The tab reloaded, the app kept running | The in-memory draft with `kernelKept: true`. Variables are still in the kernel. A cell that was running gets interrupted, since nothing is left to receive its result |
| A new tab, opened with a notebook | That notebook, with `kernelKept: false`. Its kernel starts on its first run |
| A new tab from Cmd+T or + | `null`, and the renderer shows the start page |
| Relaunch, clean notebook with a file | The file as it is on disk now, so outside edits show up |
| Relaunch, dirty notebook | The unsaved copy from `session.json`, still dirty. Its path is kept if the file still exists |
| The file is gone and nothing was unsaved | `null`, and the renderer shows the start page |
| The notebook is there but won't open: a newer version of Dalliance saved it, or it doesn't parse | A `RestoreFailure` with the path and the reason. The renderer shows the start page and the reason as an error notice |

When the notebook that won't open is an unsaved copy, it only exists in `session.json`, and the next draft would overwrite it. So `restore()` first renames `session.json` to `session.json.unrestored-<timestamp>` and names that file in the message. The copy holds every tab's drafts as they were, and the next write puts the other tabs back in a new `session.json`. A saved file is left alone, so the next launch tries it again, and an updated app opens it.

Until a tab's page sends its first draft, the tab keeps what the last run saved for it, so a write in the meantime doesn't drop it.

`session.json` only carries notebook contents while a tab has unsaved changes.

## The notebook's folder

The folder holding the `.ipynb` is the workspace, one per tab. That tab's kernel runs there, the agent can list and read files there, and the brief is `AGENTS.md` there. The last folder in use is remembered in `settings.json` as `workspaceDir`. `openWorkspace()` and `moveWorkspace()` set it, so it follows whatever notebook was opened or saved last. Tabs brought back at launch behind the one showing leave it alone. A new tab, and the next launch, start there, and falls back to `~/Documents/Dalliance Notebooks/`, created at startup, when the folder is gone. That default is also what keeps a first notebook from running in all of Documents. Opening a notebook kept straight in a broad folder, like Documents, Desktop or the home folder (`isBroadFolder()` in `electron/harness/workspace.ts`), makes that the folder in use, but `folderForNewNotebook()` in `electron/notebook-files.ts` sends new notebooks, and a first name for an unsaved one, to the default folder instead. A launch that remembers such a folder starts in the default one too, until a notebook is opened.

A new notebook is a file from the start. `newNotebook(notebook)` writes `Untitled.ipynb` into the calling tab's folder, or `Untitled 2.ipynb` and up when that name is taken (`newNotebookPath()` in `electron/notebook-files.ts`), and opens it with a fresh kernel there, in that tab or a new one (see [ipc.md](ipc.md#where-a-notebook-opens)). `openFolder(notebook)` first asks for a folder with the system dialog, which has a New Folder button, and then does the same in it. Only the notebook a tab shows behind the start page has no file yet. Clicking the name at the top of the overview renames the file in place, as Jupyter does, and for that one notebook writes it under the name typed. `cleanNotebookName()` refuses an empty name, path characters, a leading dot and more than 100 characters, and a name that is already taken in the folder is refused too. Both writes create the file with the `wx` flag, so a file that appears under the chosen name after the check is never overwritten: a new notebook moves on to the next free name, and a rename says the name is taken. A new notebook joins the recent list only once its kernel's folder is open. Unsaved edits stay unsaved through a rename.

The app writes three things into it: a new notebook's `.ipynb` when it is made or first named, the `.ipynb` on save, and `AGENTS.md` when the user edits the brief. The save writes a hidden `.<name>.ipynb.<pid>.<random>.tmp` file next to the notebook and renames it into place. Cells can write anything else, since they're the user's Python.

## localStorage

Per-window conveniences only, shared by every tab since they all load the same page. Every read and write is wrapped in try/catch.

| Key | Holds |
| --- | --- |
| `dalliance-sidebar` | `open` or `closed` |
| `dalliance-overview` | Width of the overview column |
| `dalliance-panes` | Width of the side pane column |

## Recent notebooks

`settings.recent` holds up to 8 paths, newest first. Opening or saving a file moves it to the top. `recentNotebooks()` hides entries whose files are gone, and `openRecent()` removes one when it finds the file missing. `openRecent()` refuses any path that isn't on the list. The main process also calls `app.addRecentDocument()` for the macOS Dock menu.
