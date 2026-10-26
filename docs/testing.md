# Testing

Tests use Vitest 5. `pnpm test` at the root runs every package through Turborepo. CI runs it on Ubuntu and macOS for every pull request, and the release workflow runs it again before building the `.dmg`. See [development.md](development.md#ci).

```bash
pnpm test                                             # everything
pnpm --filter @dalliance/desktop test                 # the desktop app
pnpm --filter @dalliance/desktop test:watch           # watch mode
pnpm --filter @dalliance/desktop exec vitest run src/store   # one folder
pnpm turbo run test --filter @dalliance/shared        # the shared package
```

## What runs where

| Tests | Environment | Needs |
| --- | --- | --- |
| `packages/shared/src/*.test.ts` | Node | Nothing. The `nbformat.validate` block in `ipynb-jupyter.test.ts` runs `python3` with `nbformat` and skips without it |
| `apps/desktop/src/**/*.test.tsx` | jsdom | Nothing |
| `apps/desktop/electron/**/*.test.ts` | Node, via `// @vitest-environment node` | Nothing, except the three below |
| `electron/kernel/python-kernel.test.ts`, `electron/kernel/kernel-protocol.test.ts` | Node | A system Python 3.9+. Skips without one. CI provides Python 3.12 on Ubuntu and macOS |
| `electron/e2e.test.ts` | Node | `DALLIANCE_E2E=1`, a selected provider API key, the network. Bills your provider account |

`apps/desktop/vitest.config.ts` is separate from `vite.config.ts`, so tests never start Electron. The website, `apps/web`, has no tests. See [website.md](website.md#download-log) for how the download route was checked.

## The layers

### Shared model

`ipynb.test.ts` round-trips notebooks through `toIpynb` and `fromIpynb` and reads plain Jupyter files. Its `ipynb format version` block checks the version Dalliance writes, and that a file from a newer version is refused. `reading hand-edited or corrupted metadata` feeds in mistyped and malformed `metadata.dalliance` fields and checks each one falls back to a safe default instead of throwing. `ipynb-jupyter.test.ts` opens and saves the Jupyter fixtures in `packages/shared/fixtures`: a save keeps what Jupyter wrote, a 4.4 file upgrades to 4.5, raw cells, attachments, tags and outputs Dalliance can't show survive, and those outputs go once the cell reruns. Its `nbformat.validate` block checks each fixture and its saved copy with the real `nbformat` when `python3` has it installed, and skips otherwise. Its `the record of how a cell was made` block checks that only the final attempt is saved, empty lists are left out, a record reads back and saves the same again, files without one still open, and a malformed record reads as defaults or `null`. Its `pins` block checks that pins save under the notebook's `metadata.dalliance` and read back the same, that a Jupyter file has none, that other keys there survive, and that malformed pins read as missing. The `nbformat.validate` block checks a cell with a record and a notebook with pins too. `normalize.test.ts` covers the output normalizer: what it takes out, what it leaves exact, and that key order doesn't change `canonicalOutputs()`. `leaked.test.ts` covers the tool markup cleanup. `verify.test.ts` covers Verify's pure parts: what compares as the same, changed or a figure that differs, the seed warnings and the look-alikes that don't warn, reading a `NameError`, the names code defines, and why a name was missing. Add a case here whenever the file format changes.

### The harness

`electron/harness/run-cell.test.ts` runs the real `runCell()` with a `FakeKernel` and a scripted model. The model is `MockLanguageModelV4` from `ai/test`, playing back one step per call:

```ts
const { model, prompts } = scriptedModel([
  { tool: 'run_cell', input: { code: 'orders.groupby("plan").total.sum()' } },
  { tool: 'finish', input: { interpretation: '', answer: 'Pro leads.', next: [] } },
])
const kernel = new FakeKernel((code) => ({ ok: true, outputs: [{ type: 'text', text: '42' }] }))
```

`prompts` records what the model was sent on each call, so a test can check the context. The existing tests cover retries, the finish gate, approvals, blocking through the event bus, aborts, the explore timeout, questions answered in words, leaked markup, and the append-only history. Every new tool or rule in the loop needs a test here.

`prompt.test.ts`, `title.test.ts`, `workspace.test.ts` and `model.test.ts` check prompts, titles on the selected provider, file access, direct API endpoints and provider keys, model selection, and reasoning/caching options. `cost.test.ts` checks provider-reported token totals. `run-cell.test.ts` checks streaming, errors, the append-only history and tool policy. `provider-keys.test.ts` checks encrypted persistence, key deletion, session-only storage, redaction and the Python environment.

The `the record of how a cell was made` block in `run-cell.test.ts` runs a generation through every part of the record: models per step, the rationale and its fallback, attempts with their errors and changes, files read by the code and by the agent, approvals, secret-file blocks and the hashes. `provenance.test.ts` tests the pieces on their own: `describeChange()`, `statedRationale()`, the bounds on files and approvals, and read paths.

`code-policy.test.ts` checks `scanPython()` and `inspectCode()`: what counts as a secret file, a shell command or the network, and the look-alikes that don't, such as names in comments, `os.environ` or `urllib.parse`. `extensions.test.ts` checks the built-in extensions on a bare event bus: the `.env` guard, the run log (clipping, order, rotation at the size limit, carrying on after a failed write) and the code policy in each approval mode.

### The main process

`electron/workspace-files.test.ts` checks the Files pane's directory listing beyond 200 entries, empty folders, deep paths, hidden and dependency folders, and traversal and symlink boundaries. It also checks that only existing workspace files can be revealed in the file manager. The agent's listing stays bounded separately.

These run in Node with Electron mocked, and need nothing installed.

| File | Covers |
| --- | --- |
| `electron/session.test.ts` | `NotebookSession`'s kernel lifecycle with a fake `launchKernel`: a notebook opened during the launch warm-up gets a kernel in its own folder, a caller waiting on a stale start gets the current kernel, a start under way is reused, and a kernel that finishes starting after quit is shut down. With the model mocked, that a run names its calls for Show token usage, and is counted with Show token usage off too. With a `FakeKernel`, that a save pins the Python, the kernel's packages and the hashed files the cells read, forgets what ran after a restart, uses the kernel's last answer while a cell runs, and that `checkPins()` finds a changed package and file. Also the `.env` guard on `read_file`, and, with `python-env` and `PythonKernel` mocked, that the environment view's listing runs in userData and passes on why it failed |
| `electron/settings.test.ts` | Preferences persist, missing settings take defaults, model selection and provider memories stay valid, private file permissions, and corrupt files are preserved before defaults are used |
| `electron/pins.test.ts` | `pinNotebook()` and `comparePins()` with a fake disk: a kernel that ran every cell replaces the pins, one that ran none leaves them untouched, one that ran some merges them, a file over the size limit is pinned by size and compared by size, a path outside the folder is never read, and each kind of change is found |
| `electron/file-hash.test.ts` | `FileHasher`: the SHA-256 and size, nothing for a missing file or a folder, a note over the size limit, a file read again only once its size or modification time changes, one read shared between callers, and a file that couldn't be read tried again |
| `electron/draft.test.ts` | `DraftStore`: a notebook comes back as it was after a reload, unsaved changes come back after a relaunch, a saved notebook reopens from its file, a file from a newer version or one that's no longer a notebook is reported, and Don't Save forgets the draft |
| `electron/ipc-sender.test.ts` | `isAppUrl` and `isTrustedSender`: IPC is answered only from the top frame of the app window showing the app's own page |
| `electron/open-files.test.ts` | `notebookFromArgv` and `OpenQueue`: the last `.ipynb` on a command line that exists is found, a file the OS asks to open waits until the window can take it, a later one replaces it, and a reload asks the page again |
| `electron/atomic-write.test.ts` | `writeFileAtomic` and `writeFileAtomicSync`, each: new and replaced files, file modes, writing through a symlink, a missing folder, and no temporary file left behind when the rename fails |
| `electron/menu.test.ts` | The View menu names each pane the way the overview does, with its Cmd+number key left to the renderer. The Kernel menu's Verify Notebook… sends `verify` |

### The kernel

`python-kernel.test.ts` spawns the real script with the system Python. It checks state across cells, tracebacks, exploratory runs and the names they leave for later cells until a restart, the variable list, interrupts, restarts and which names a cell assigned. Its `PythonKernel files read` block checks the audit hook: reads inside the folder are reported once each and in order, writes, missing files, folders and files outside are not, imports and `explore` runs count, the list stops at 100, and pandas reads show up when pandas is installed. Its `PythonKernel packages the executes imported` block checks the `environment` request with distributions made in the test's folder: nothing before an import, never the standard library or the kernel's own IPython, a package with what it requires, not a failed import, and numpy behind pandas when pandas is installed. Its `PythonKernel hardening` block checks that a value whose `describe()` breaks doesn't kill the kernel, that a request failing outside the cell gets an error answer, that cells import modules from the notebook's folder, and that cells get an empty stdin rather than the request pipe. Run it after any change to `dalliance_kernel.py`.

`python-packages.test.ts` lists the system Python's libraries for the environment view, and checks that a `json.py` in the process's working directory can't break the listing and that a failure reads as a sentence, not the script. It skips without a system Python.

`kernel-protocol.test.ts` drives the same script over raw pipes, with a system Python, and skips without one. It interrupts printing loops again and again and checks that no protocol line is torn and every request still gets its `done`, and that `filesRead` arrives with the `done` line on fd 3.

`python-kernel.test.ts` also checks chart defaults on both execution paths when Matplotlib is installed: new figures follow light and dark appearance for saved runs and exploration, grids sit behind bars, figure-local colours survive reruns, rcParams overrides survive theme changes, restarts clear overrides, and queued requests use the appearance when they start. It decodes the emitted PNGs with Pillow to verify default backgrounds, explicit figure backgrounds and explicit savefig backgrounds. These checks skip without Matplotlib, so run them with a Python environment that has the plotting packages installed.

`python-env.test.ts` checks the package lists and the name check `installPackages()` runs before pip, including every archive extension pip accepts, with `spawn` mocked. The mock can fail with pip's PEP 668 output, to check the Settings > Python message. Python discovery runs against a fake Mac through injected `exec`, `exists`, `list` and `path`: Homebrew over Apple's Python, the newest version winning, and `/usr/bin/python3` left alone without the Command Line Tools. Its two missing-package cases use the system Python and skip without one.

### The renderer

`components/panes/FileTree.test.tsx` checks virtualization with 5,000 files, keyboard access to the last file, folder errors and retries, and replies overtaken by a refresh. `App.test.tsx` checks that folders start collapsed and load their contents only as they expand. It also checks that single-click selects a file and double-click reveals it without creating notebook cells.

`src/test/setup.ts` prepares jsdom:

- Adds `scrollIntoView`, `ResizeObserver` and `matchMedia`, which jsdom lacks.
- Mocks `react-resizable-panels` with plain `div`s. jsdom measures everything as 0 by 0, so the real panels treat every click as a drag on a handle.

`src/test/fake-api.ts` builds a fake `DallianceApi`. You pass a run handler that returns a `CellRunResult` and may emit `RunEvent`s:

```ts
const { api, requests, responses } = fakeApi(async (request, emit) => {
  emit({ type: 'question', requestId: 'q1', question: 'Which table?', options: ['orders', 'refunds'] })
  return result({ code: 'x = 1', outputs: [] })
})
setApi(api)
```

`notebook-store.test.ts` tests actions and the run queue, including a plain rerun keeping the record of how the code was made while the next generation replaces it, a prompt or code edited while its cell runs, which is kept and used next time, and turning an empty prompt cell into a note without an Undo. `App.test.tsx` renders the whole app with Testing Library and drives it like a user: running cells, answering questions, D D and Undo, M on a cell with code and Undo bringing it back as it was, a failed save or open that stays on screen instead of being dropped, a cell that fails to draw behind the error boundary while the rest of the notebook stays up, table folding, suggestions, history, the brief, pinning, the model picker, titles, the Settings screen and Cmd+A. `App.test.tsx` checks the record is kept through a plain rerun and never shown. `Welcome.test.tsx` covers the setup and start page. `ModelSettings.test.tsx` checks simultaneous provider connections, independent key replacement and removal, the combined model catalog, model selection across connected providers, field clearing and generic errors. `store/verify.test.ts` runs Verify through the queue: one restart, saved code top to bottom without the model, saved outputs and records left alone, figures, Stop mid-run and during the restart, a restart that fails, a name only the agent's explore made, seed warnings, keeping the new outputs with Undo, and a cell deleted or a notebook loaded mid-run. `VerifyReport.test.tsx` drives it in the app: the confirmation, the report's rows, saved and new side by side, Keep the new outputs, and Stop from the report. `notebook-store.test.ts` also covers custom model selections remaining intact when absent from the catalog, and the notebook's pins: checked on open without waiting, never for a notebook without them, a check another notebook overtook dropped, and the pins a save recorded kept without marking the notebook changed. `PinChangesBanner.test.tsx` covers the banner: nothing when nothing changed, the first changes in words with the rest behind a button, folded again for a new check, and dismissed.

`store/notebook-save.test.ts` uses fake timers to check the auto-save delay, recovered edits and run results, pathless notebooks, edits during a write, notebook switches, failures, Save As, rename ordering and watcher cleanup.

The store is a module-level singleton. Call `setApi()` and `actions.load()` at the start of each test so state from the last one doesn't leak in.

### End to end

`e2e.test.ts` writes an `orders.csv`, creates a managed Python environment in the temp folder, starts a real kernel, and runs three cells at low effort: load the CSV, answer a question with a chart, and rerun saved code without the model. It's the only test that proves the prompts work with a real model. It uses the default model unless `DALLIANCE_E2E_MODEL` names another.

It calls the selected provider directly with its standard API key environment variable. See [providers.md](providers.md#verification) for the opt-in command. Normal tests never need credentials or network model calls. Live checks exercise real Python, tools, charts, image input and saved-code reruns. They cost money and stay outside CI.


## Checking UI changes by eye

Tests don't cover layout. For visual changes, build the renderer and open the demo:

```bash
pnpm --filter @dalliance/desktop build
pnpm --filter @dalliance/desktop exec vite preview
```

Then open `http://localhost:4173/?demo`. Check both themes, since every colour has a light and a dark value. `.claude/launch.json` has this as `renderer-preview`.
