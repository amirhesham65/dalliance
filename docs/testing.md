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
| `electron/e2e.test.ts` | Node | `DALLIANCE_E2E=1`, `AI_GATEWAY_API_KEY`, the network. Costs a few cents |

`apps/desktop/vitest.config.ts` is separate from `vite.config.ts`, so tests never start Electron. The website has no tests. See [website.md](website.md#download-log) for how the download route was checked.

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

`prompt.test.ts`, `title.test.ts` and `workspace.test.ts` test those modules directly. `cost.test.ts` checks the price math against costs the gateway reported, that reasoning isn't counted twice, the Anthropic price table's ids, and that a model with no price shows as tokens.

The `the record of how a cell was made` block in `run-cell.test.ts` runs a generation through every part of the record: models per step, the rationale and its fallback, attempts with their errors and changes, files read by the code and by the agent, approvals, secret-file blocks and the hashes. `provenance.test.ts` tests the pieces on their own: `describeChange()`, `statedRationale()`, the bounds on files and approvals, and read paths.

`code-policy.test.ts` checks `scanPython()` and `inspectCode()`: what counts as a secret file, a shell command or the network, and the look-alikes that don't, such as names in comments, `os.environ` or `urllib.parse`. `extensions.test.ts` checks the built-in extensions on a bare event bus: the `.env` guard, the run log (clipping, order, rotation at the size limit, carrying on after a failed write, and tabs sharing one log with their id on each line) and the code policy in each approval mode.

### The main process

These run in Node with Electron mocked, and need nothing installed.

| File | Covers |
| --- | --- |
| `electron/session.test.ts` | `NotebookSession`'s kernel lifecycle with a fake `launchKernel`: a notebook opened during the launch warm-up gets a kernel in its own folder, a caller waiting on a stale start gets the current kernel, a notebook opened in a new tab waits for a run before its kernel starts, a new Python restarts only kernels in use, a start under way is reused, and a kernel that finishes starting after quit is shut down. With the model mocked, that a run is priced with Show costs on and not at all with it off. With a `FakeKernel`, that a save pins the Python, the kernel's packages and the hashed files the cells read, forgets what ran after a restart, uses the kernel's last answer while a cell runs, and that `checkPins()` finds a changed package and file. Also the `.env` guard on `read_file`, and, with `python-env` and `PythonKernel` mocked, that a kernel on the managed environment installs missing base packages once per session, not once per tab, without waiting for them, and that the environment view's listing runs in userData and passes on why it failed |
| `electron/settings.test.ts` | `SettingsStore` reads what an earlier run saved, keeps Show costs off until it's turned on, keeps `settings.json` private (mode 600), and moves a file that doesn't parse or isn't an object aside before starting from the defaults |
| `electron/pins.test.ts` | `pinNotebook()` and `comparePins()` with a fake disk: a kernel that ran every cell replaces the pins, one that ran none leaves them untouched, one that ran some merges them, a file over the size limit is pinned by size and compared by size, a path outside the folder is never read, and each kind of change is found |
| `electron/file-hash.test.ts` | `FileHasher`: the SHA-256 and size, nothing for a missing file or a folder, a note over the size limit, a file read again only once its size or modification time changes, one read shared between callers, and a file that couldn't be read tried again |
| `electron/draft.test.ts` | `DraftStore`: a notebook comes back as it was after a reload of its tab, unsaved changes come back after a relaunch, a saved notebook reopens from its file, a file from a newer version or one that's no longer a notebook is reported, and Don't Save forgets the draft. With tabs: every tab comes back in order with the one showing and each one's changes, a tab whose page hasn't sent a draft keeps what was saved, a closed tab is forgotten, the window closing leaves the file as it was, and a `session.json` from before tabs reads as one tab |
| `electron/tabs.test.ts` | `Tabs` over fake views and sessions: new tabs, switching and cycling with only the active view attached and focused, the strip's list, the tab that has a file coming forward, an untouched Untitled reused, closing with and without unsaved changes (Save, Don't Save, Cancel, a save that doesn't land or can't be sent), the last tab closing the window, and the walk over every dirty tab before the window closes or the app quits |
| `electron/ipc-sender.test.ts` | `isAppUrl` and `isTrustedSender`: IPC is answered only from the top frame of one of the tab views showing the app's own page, never from a view that isn't a tab, a closed tab, an iframe, or one tab's frame sent as another's |
| `electron/open-files.test.ts` | `notebookFromArgv` and `OpenQueue`: the last `.ipynb` on a command line that exists is found, a file the OS asks to open waits until the window can take it, a later one replaces it, and a reload asks the page again |
| `electron/atomic-write.test.ts` | `writeFileAtomic` and `writeFileAtomicSync`, each: new and replaced files, file modes, writing through a symlink, a missing folder, and no temporary file left behind when the rename fails |
| `electron/cloud/billing.test.ts` | `Billing.credits()` with a fake Convex client: it keeps counting until every call is in, gives what came after the wait, and asks nothing signed out |
| `electron/menu.test.ts` | The View menu names each pane the way the overview does, with its Cmd+number key left to the renderer. The tab items: New Tab, Close Tab and Close Window in the File menu, next and previous tab on Ctrl+Tab and on hidden Shift+Cmd+] and [ items, Open Recent, and no accelerator used twice. The Kernel menu's Verify Notebook… sends `verify` |

### The kernel

`python-kernel.test.ts` spawns the real script with the system Python. It checks state across cells, tracebacks, exploratory runs and the names they leave for later cells until a restart, the variable list, interrupts, restarts and which names a cell assigned. Its `PythonKernel files read` block checks the audit hook: reads inside the folder are reported once each and in order, writes, missing files, folders and files outside are not, imports and `explore` runs count, the list stops at 100, and pandas reads show up when pandas is installed. Its `PythonKernel packages the executes imported` block checks the `environment` request with distributions made in the test's folder: nothing before an import, never the standard library or the kernel's own IPython, a package with what it requires, not a failed import, and numpy behind pandas when pandas is installed. Its `PythonKernel hardening` block checks that a value whose `describe()` breaks doesn't kill the kernel, that a request failing outside the cell gets an error answer, that cells import modules from the notebook's folder, that API keys never reach the kernel's environment, and that cells get an empty stdin rather than the request pipe. Run it after any change to `dalliance_kernel.py`.

`python-packages.test.ts` lists the system Python's libraries for the environment view, and checks that a `json.py` in the process's working directory can't break the listing and that a failure reads as a sentence, not the script. It skips without a system Python.

`kernel-protocol.test.ts` drives the same script over raw pipes, with a system Python, and skips without one. It interrupts printing loops again and again and checks that no protocol line is torn and every request still gets its `done`, and that `filesRead` arrives with the `done` line on fd 3.

`python-env.test.ts` checks the package lists and the name check `installPackages()` runs before pip, including every archive extension pip accepts, with `spawn` mocked. The mock can fail with pip's PEP 668 output, to check the Settings > Python message. Python discovery runs against a fake Mac through injected `exec`, `exists`, `list` and `path`: Homebrew over Apple's Python, the newest version winning, and `/usr/bin/python3` left alone without the Command Line Tools. The base-package cases check what an old managed environment lacks and that only that gets installed. Its two missing-package cases use the system Python and skip without one.

### The renderer

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

It starts with one Untitled tab. `fakeTabs(list)` builds a tab list that acts like the main process's, with `calls` recording switches, closes and new tabs, and `set()` changing the list as the main process would. Spread its `api` over the fake's to use it.

`notebook-store.test.ts` tests actions and the run queue, including a plain rerun keeping the record of how the code was made while the next generation replaces it, a prompt or code edited while its cell runs, which is kept and used next time, and turning an empty prompt cell into a note without an Undo. `App.test.tsx` renders the whole app with Testing Library and drives it like a user: running cells, answering questions, D D and Undo, M on a cell with code and Undo bringing it back as it was, a failed save or open that stays on screen instead of being dropped, a cell that fails to draw behind the error boundary while the rest of the notebook stays up, table folding, suggestions, history, the brief, pinning, the model picker, titles, the Settings screen and Cmd+A. `App.test.tsx` checks the record is kept through a plain rerun and never shown. `TabStrip.test.tsx` renders the app with a fake tab list: every tab with its unsaved and running dots, a click, a middle click, the cross and +, the arrow keys, Home, End, Enter and Delete, a list the main process changes, the page reporting its running cells, and settings or a Python changed from another tab. `Welcome.test.tsx` covers the setup and start page. `ModelSettings.test.tsx` covers the note under the key: asking again for a key that can't be read, and warning when it's stored without a keychain. `store/verify.test.ts` runs Verify through the queue: one restart, saved code top to bottom without the model, saved outputs and records left alone, figures, Stop mid-run and during the restart, a restart that fails, a name only the agent's explore made, seed warnings, keeping the new outputs with Undo, and a cell deleted or a notebook loaded mid-run. `VerifyReport.test.tsx` drives it in the app: the confirmation, the report's rows, saved and new side by side, Keep the new outputs, and Stop from the report. `notebook-store.test.ts` also covers a saved Cloud model that Dalliance Cloud no longer offers going back to the default, and the notebook's pins: checked on open without waiting, never for a notebook without them, a check another notebook overtook dropped, and the pins a save recorded kept without marking the notebook changed. `PinChangesBanner.test.tsx` covers the banner: nothing when nothing changed, the first changes in words with the rest behind a button, folded again for a new check, and dismissed.

The store is a module-level singleton. Call `setApi()` and `actions.load()` at the start of each test so state from the last one doesn't leak in.

### End to end

`e2e.test.ts` writes an `orders.csv`, creates a managed Python environment in the temp folder, starts a real kernel, and runs three cells at low effort: load the CSV, answer a question with a chart, and rerun saved code without the model. It's the only test that proves the prompts work with a real model. It uses the default gateway model unless `DALLIANCE_E2E_MODEL` names another.

```bash
DALLIANCE_E2E=1 pnpm --filter @dalliance/desktop exec vitest run electron/e2e.test.ts
```

It reads `apps/desktop/.env` for the key.

## Checking UI changes by eye

Tests don't cover layout. For visual changes, build the renderer and open the demo:

```bash
pnpm --filter @dalliance/desktop build
pnpm --filter @dalliance/desktop exec vite preview
```

Then open `http://localhost:4173/?demo`. Check both themes, since every colour has a light and a dark value. `.claude/launch.json` has this as `renderer-preview`.
