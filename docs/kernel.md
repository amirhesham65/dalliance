# The Python kernel

Dalliance doesn't use Jupyter's kernel protocol or ZeroMQ. It runs its own small Python script and talks to it over pipes.

| File | Does |
| --- | --- |
| `electron/kernel/dalliance_kernel.py` | The Python side: one namespace, execute, variables |
| `electron/kernel/kernel.ts` | The `Kernel` interface the harness depends on |
| `electron/kernel/python-kernel.ts` | `PythonKernel`, which spawns and drives the script |
| `electron/kernel/fake-kernel.ts` | `FakeKernel` for tests |
| `electron/kernel/python-env.ts` | Finding Python, the managed virtual environment, pip |

## The protocol

`PythonKernel.start()` writes the script into `userData/kernel/` and spawns `python -u dalliance_kernel.py` with four pipes. The script is bundled with Vite's `?raw` import.

| fd | Direction | Carries |
| --- | --- | --- |
| 0 stdin | main to kernel | Requests, one JSON object per line. The script moves this pipe to a private fd at startup |
| 1 stdout | kernel to main | Ignored. C extensions and stray prints land here |
| 2 stderr | kernel to main | The last 4,000 characters are kept for crash messages |
| 3 | kernel to main | Protocol replies, one JSON object per line |

Replies go on fd 3 so that nothing a library prints can corrupt the protocol. Inside a cell, `sys.stdout` and `sys.stderr` are swapped for `Stream` objects that send `stream` outputs.

Only one thread writes to fd 3. The main thread puts finished lines, and the text of each `Stream.write()`, on a queue. The `writer()` thread takes them off in order and writes each line whole. It blocks every signal, so a Stop can't cut a line in half. It also coalesces stream text: consecutive writes to the same stream go out as one `stream` output once 64,000 characters build up, 50 ms after the first unsent write, or when any other output comes next. A loop of 200,000 prints sends a handful of messages, and a print still shows up within 50 ms.

A process forked by a cell has no writer thread, so it writes its lines to fd 3 itself.

Requests can't be read by a cell either. At startup the script reads requests from a copy of fd 0 and puts `/dev/null` on fd 0 and `sys.stdin`. Reading stdin in a cell, or in a subprocess it starts, returns nothing. `input()` raises `EOFError` saying cells can't read input.

The child's environment is `process.env` minus the API keys in `ENV_KEYS` from `env-keys.ts`. That file imports nothing from Electron, so `python-kernel.ts` loads in plain Node tests. `settings.ts` re-exports it. Code in a cell can't read the model's keys.

Requests:

```json
{"id": "7", "op": "execute", "code": "orders.head()", "store": true}
{"id": "8", "op": "variables"}
```

Replies:

```json
{"id": null, "type": "ready", "python": "3.12.4", "executable": "/…/python"}
{"id": "7", "type": "output", "output": {"type": "table", "...": "..."}}
{"id": "7", "type": "done", "ok": true, "executionCount": 3, "durationMs": 41, "assigned": [...]}
{"id": "8", "type": "variables", "variables": [...]}
```

`ready` arrives once at startup. An execute sends zero or more `output` messages, then one `done`.

`PythonKernel.request()` chains every request on a promise queue, so they run one at a time in order, like a Jupyter shell channel.

The script's request loop catches any exception per request. A request that fails outside the cell's own `try` gets an `error` output and a `done` with `ok: false`, and the kernel keeps running.

`handle()` returns a request's last reply and the loop sends it, so every request gets exactly one `done` or `variables`. The `SIGINT` handler, `on_interrupt()`, raises `KeyboardInterrupt` only while `interruptible` is set, which `run()` does just for the cell's own code, figures and value. An interrupt that lands between requests or while the kernel sends a reply is ignored, so it can't skip the reply and leave the request hanging.

## Executing code

`run(code, store)` in the script works like a notebook cell:

1. Parse the code with `ast`. If the last statement is an expression, pull it out.
2. `exec` the rest in the shared namespace, then `eval` the last expression.
3. Collect matplotlib figures, and emit the last value as a rich output.
4. On any `BaseException`, including `KeyboardInterrupt`, emit an `error` output. Frames from `dalliance_kernel.py` are dropped so the traceback starts at the user's code. The message and each frame are clipped at 20,000 characters.
5. Emit a note for anything the run's budget dropped. See [Output budgets](#output-budgets).
6. When `store` is true, compare the namespace to a snapshot by `id()` and report new or rebound names as `assigned`.

`store: true` is a real cell run. It advances the execution count, sets `_`, and reports assigned variables. `store: false` is the agent's `explore`, and does none of those. Both share the same namespace, which is why the system prompt tells the model not to change state in `explore`.

A `display()` function is injected into the namespace for showing values mid-cell.

`sys.path` starts with `''`, the working directory, and leaves out the folder the script was written to. `import helpers` finds `helpers.py` in the notebook's folder, and still does after `os.chdir()`. Import caches are cleared before each run, so a file written since the last cell imports too.

Variables are described by `describe()`, which reads the value's type, shape and a short `repr`. If that throws for some value, the entry keeps its name and type with an empty shape and detail.

## Rich outputs

`rich_outputs(value)` turns the last expression, or a value passed to `display()`, into outputs:

| Value | Output |
| --- | --- |
| `pandas.DataFrame` | `table` |
| `pandas.Series` | `table` with one column |
| A matplotlib object | nothing, figures are collected separately |
| Anything else | `text` from `repr()`, clipped at 20,000 characters |

### Tables and column profiles

`table_outputs()` sends the first 100 rows, the first 50 columns and the real `totalRows`. A wider frame gets a note after the table, `Showing the first 50 of 5,000 columns.` Values go through `json_value()`, which turns NaN, infinity and `NaT` into `null` and numpy scalars into Python ones. Text in a cell, a header or an index label is clipped at 1,000 characters.

It also adds a `profile` entry for each column it sends. Each has dtype, count, missing, distinct count, and either min, max and mean for numbers and dates, or the top 3 values for text and booleans. Columns with more than 200,000 non-null values are sampled with `random_state=0`. If profiling throws, the table still goes out without it.

The renderer opens tables with more than 20 rows on the column overview, and smaller ones on their rows.

### Figures

`MPLBACKEND=Agg` is set in the environment. After each run, `collect_figures()` saves every open figure as a PNG, emits it as base64, and closes them all.

`render_figure()` keeps a PNG within 4,000 pixels on a side. A bigger figure is saved at a lower dpi, and checked again after saving, since the tight bounding box can grow past the figure. One that would need less than 10 dpi to fit, such as a 500-inch-wide figure, is skipped with a note giving its size.

`style_matplotlib()` sets a dark theme with a `#161616` background at startup, whatever the app's theme. Charts look the same in light and dark mode. Change the rcParams there if that ever needs to follow the app.

## Output budgets

Each execute gets a fresh `Budget`, so one cell can't flood the app or the agent's context. What goes past a limit is dropped, and the kernel says so in a short note: a `stream` output on `stderr`, which the renderer shows in the warning color. The limits are constants at the top of the script.

| Limit | Value | Past it |
| --- | --- | --- |
| `MAX_STREAM_CHARS` | 1,000,000 characters of stdout and stderr together | The rest is dropped. At the end of the run, one note: `Output truncated: 49,000,001 more characters.` |
| `MAX_DISPLAYS` | 100 values from `display()` and the last expression | The rest are dropped, with one note at the end of the run |
| `MAX_TABLE_COLUMNS` | 50 columns per table | See [Tables](#tables-and-column-profiles) |
| `MAX_CELL_TEXT` | 1,000 characters per table cell or header | Clipped |
| `MAX_IMAGES` | 20 figures | The rest are closed unsaved, with one note |
| `MAX_FIGURE_SIDE` | 4,000 pixels on a side | See [Figures](#figures) |

Notes don't count against the budget. The `Output` type in `packages/shared` has no field for them, so a note is an ordinary stderr stream.

`python-kernel.test.ts` covers each limit and the interrupt escalation below. `kernel-protocol.test.ts` drives the script over raw pipes, interrupts printing loops again and again, and checks that every line parses and every request gets its `done`.

## Lifecycle

`NotebookSession` in `electron/session.ts` owns the kernel.

- `warmUp()` starts it in the background at launch and after every restart.
- `ensureKernel()` starts it on demand and shares one start promise between concurrent callers.
- `openWorkspace(dir)` restarts it in the new notebook's folder. New and opened notebooks always get a fresh kernel.
- `moveWorkspace(dir)` runs `os.chdir()` in the live kernel after Save As into another folder, so variables survive.
- `restart()` bumps a generation counter, shuts the kernel down and warms up a new one. A kernel that was still starting when the restart came is discarded once it's up: it belongs to an older generation and may be in the old folder, so `ensureKernel()` shuts it down and hands its waiters the current one.
- `interrupt()` sends `SIGINT`, but only while the kernel is busy. The script ignores an interrupt that lands between requests.
- If the run is still going 5 seconds after `interrupt()`, because the cell swallows `KeyboardInterrupt` or sits in C code that never checks for signals, `PythonKernel` `SIGKILL`s the process. The running request and everything queued behind it reject with `KILLED_AFTER_INTERRUPT`, "The kernel didn't stop, so it was restarted. Variables were lost.", and the status goes `dead` with that as the error. The session's next `ensureKernel()` starts a fresh kernel. Pressing Stop again doesn't push the deadline back, and a run that finishes in time cancels it. `interruptGraceMs` in the options changes the 5 seconds, for tests.
- `shutdown()` closes stdin, sends `SIGTERM`, and `SIGKILL`s after 2 seconds.
- If the process exits on its own, pending requests reject with the stderr tail as the error, and the status goes `dead`.

Status changes go to the renderer as `KernelState` over `kernel-state-changed`.

## Finding Python

`pythonStatus()` in `python-env.ts` picks the interpreter in this order:

1. `pythonPath` from Settings. A leading `~` expands to the home folder.
2. The managed environment at `userData/python-env/`.
3. The first system Python that is 3.9 or newer, trying `python3`, `/opt/homebrew/bin/python3`, `/usr/local/bin/python3` and `/usr/bin/python3`. Apps started from the Dock get a minimal `PATH`, hence the fixed paths.

It also reports which of `pandas`, `numpy` and `matplotlib` are missing. The renderer shows a banner when any are.

`setupManagedEnv()` creates the venv with the system Python if needed, then pip-installs `BASE_PACKAGES` (the three above plus SciPy, statsmodels, seaborn and scikit-learn), streaming lines to the renderer over `python-log`. Changing `pythonPath` in Settings restarts the kernel.

## The Kernel interface

The harness depends on `Kernel`, not `PythonKernel`:

```ts
interface Kernel {
  info(): KernelInfo
  execute(code: string, options: { store: boolean; onOutput? }): Promise<ExecuteResult>
  variables(): Promise<VariableInfo[]>
  interrupt(): void
  restart(): Promise<void>
  shutdown(): Promise<void>
}
```

`FakeKernel` answers every `execute()` with a handler you pass in and records what ran. Use it for harness tests. See [testing.md](testing.md).
