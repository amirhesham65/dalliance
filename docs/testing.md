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

`apps/desktop/vitest.config.ts` is separate from `vite.config.ts`, so tests never start Electron. The website has no tests.

## The layers

### Shared model

`ipynb.test.ts` round-trips notebooks through `toIpynb` and `fromIpynb` and reads plain Jupyter files. `leaked.test.ts` covers the tool markup cleanup. Add a case here whenever the file format changes.

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

### The kernel

`python-kernel.test.ts` spawns the real script with the system Python. It checks state across cells, tracebacks, exploratory runs, the variable list, interrupts, restarts and which names a cell assigned. Run it after any change to `dalliance_kernel.py`.

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

`notebook-store.test.ts` tests actions and the run queue. `App.test.tsx` renders the whole app with Testing Library and drives it like a user: running cells, answering questions, D D and Undo, table folding, suggestions, history, the brief, pinning, the model picker, titles, the Settings screen and Cmd+A. `Welcome.test.tsx` covers the setup and start page.

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
