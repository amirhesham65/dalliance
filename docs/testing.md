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
| `packages/shared/src/*.test.ts` | Node | Nothing |
| `apps/desktop/src/**/*.test.tsx` | jsdom | Nothing |
| `apps/desktop/electron/**/*.test.ts` | Node, via `// @vitest-environment node` | Nothing, except the two below |
| `electron/kernel/python-kernel.test.ts` | Node | A system Python 3.9+. Skips without one. CI provides Python 3.12 on Ubuntu and macOS |
| `electron/e2e.test.ts` | Node | `DALLIANCE_E2E=1`, `AI_GATEWAY_API_KEY`, the network. Costs a few cents |

`apps/desktop/vitest.config.ts` is separate from `vite.config.ts`, so tests never start Electron. The website has no tests. See [website.md](website.md#download-log) for how the download route was checked.

## The layers

### Shared model

`ipynb.test.ts` round-trips notebooks through `toIpynb` and `fromIpynb` and reads plain Jupyter files. Its `ipynb format version` block checks the version Dalliance writes, and that a file from a newer version is refused. `reading hand-edited or corrupted metadata` feeds in mistyped and malformed `metadata.dalliance` fields and checks each one falls back to a safe default instead of throwing. `leaked.test.ts` covers the tool markup cleanup. Add a case here whenever the file format changes.

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

`prompt.test.ts`, `title.test.ts` and `workspace.test.ts` test those modules directly. `draft.test.ts` covers session restore.

### The main process

These run in Node with Electron mocked, and need nothing installed.

| File | Covers |
| --- | --- |
| `electron/session.test.ts` | `NotebookSession`'s kernel lifecycle with a fake `launchKernel`: a notebook opened during the launch warm-up gets a kernel in its own folder, a caller waiting on a stale start gets the current kernel, a start under way is reused, and a kernel that finishes starting after quit is shut down. Also the `.env` guard on `read_file`, and that the environment view's listing runs in userData and passes on why it failed |
| `electron/settings.test.ts` | `SettingsStore` reads what an earlier run saved, keeps `settings.json` private (mode 600), and moves a file that doesn't parse or isn't an object aside before starting from the defaults |
| `electron/atomic-write.test.ts` | `writeFileAtomic` and `writeFileAtomicSync`, each: new and replaced files, file modes, writing through a symlink, a missing folder, and no temporary file left behind when the rename fails |
| `electron/menu.test.ts` | The View menu names each pane the way the overview does, with its Cmd+number key left to the renderer |

### The kernel

`python-kernel.test.ts` spawns the real script with the system Python. It checks state across cells, tracebacks, exploratory runs, the variable list, interrupts, restarts and which names a cell assigned. Its `PythonKernel hardening` block checks that a value whose `describe()` breaks doesn't kill the kernel, that a request failing outside the cell gets an error answer, that cells import modules from the notebook's folder, that API keys never reach the kernel's environment, and that cells get an empty stdin rather than the request pipe. Run it after any change to `dalliance_kernel.py`.

`python-packages.test.ts` lists the system Python's libraries for the environment view, and checks that a `json.py` in the process's working directory can't break the listing and that a failure reads as a sentence, not the script. It skips without a system Python.

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

`notebook-store.test.ts` tests actions and the run queue, including a prompt or code edited while its cell runs, which is kept and used next time, and turning an empty prompt cell into a note without an Undo. `App.test.tsx` renders the whole app with Testing Library and drives it like a user: running cells, answering questions, D D and Undo, M on a cell with code and Undo bringing it back as it was, a failed save that stays on screen instead of being dropped, a cell that fails to draw behind the error boundary while the rest of the notebook stays up, table folding, suggestions, history, the brief, pinning, the model picker, titles, the Settings screen and Cmd+A. `Welcome.test.tsx` covers the setup and start page.

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
