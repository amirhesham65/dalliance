# Files on disk

Everything the app writes goes in one of three places: Electron's userData folder, the notebook's own folder, or the renderer's `localStorage`.

## userData

On macOS this is `~/Library/Application Support/Dalliance/`. The code gets it with `app.getPath('userData')`.

| Path | Written by | Holds |
| --- | --- | --- |
| `settings.json` | `SettingsStore`, `electron/settings.ts` | Provider, model, effort, Python path, approval mode, titles on or off, onboarded, encrypted keys, recent notebooks. Mode `0600` |
| `session.json` | `DraftStore`, `electron/draft.ts` | The open notebook's path, whether it's dirty, and its contents when dirty |
| `logs/agent.jsonl` | The logging extension in `electron/session.ts` | One line per `run_start`, `tool_call`, `tool_result` and `run_end`, strings clipped to 2,000 characters |
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

Switching provider resets the model to the new provider's default, but only if the old one was still the default.

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

The folder holding the `.ipynb` is the workspace. The kernel runs there, the agent can list and read files there, and the brief is `AGENTS.md` there. Unsaved notebooks use `~/Documents/Dalliance Notebooks/`, created at startup, so they never run in all of Documents.

The app writes two things into it: the `.ipynb` on save, and `AGENTS.md` when the user edits the brief. The save writes a hidden `.<name>.ipynb.<pid>.<random>.tmp` file next to the notebook and renames it into place. Cells can write anything else, since they're the user's Python.

## localStorage

Per-window conveniences only. Every read and write is wrapped in try/catch.

| Key | Holds |
| --- | --- |
| `dalliance-sidebar` | `open` or `closed` |
| `dalliance-overview` | Width of the overview column |
| `dalliance-panes` | Width of the side pane column |

## Recent notebooks

`settings.recent` holds up to 8 paths, newest first. Opening or saving a file moves it to the top. `recentNotebooks()` hides entries whose files are gone, and `openRecent()` removes one when it finds the file missing. `openRecent()` refuses any path that isn't on the list. The main process also calls `app.addRecentDocument()` for the macOS Dock menu.
