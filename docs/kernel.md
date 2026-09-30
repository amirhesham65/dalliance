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
| 0 stdin | main to kernel | Requests, one JSON object per line |
| 1 stdout | kernel to main | Ignored. C extensions and stray prints land here |
| 2 stderr | kernel to main | The last 4,000 characters are kept for crash messages |
| 3 | kernel to main | Protocol replies, one JSON object per line |

Replies go on fd 3 so that nothing a library prints can corrupt the protocol. Inside a cell, `sys.stdout` and `sys.stderr` are swapped for `Stream` objects that send `stream` outputs.

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

## Executing code

`run(code, store)` in the script works like a notebook cell:

1. Parse the code with `ast`. If the last statement is an expression, pull it out.
2. `exec` the rest in the shared namespace, then `eval` the last expression.
3. Flush streams, collect matplotlib figures, and emit the last value as a rich output.
4. On any `BaseException`, including `KeyboardInterrupt`, emit an `error` output. Frames from `dalliance_kernel.py` are dropped so the traceback starts at the user's code.
5. When `store` is true, compare the namespace to a snapshot by `id()` and report new or rebound names as `assigned`.

`store: true` is a real cell run. It advances the execution count, sets `_`, and reports assigned variables. `store: false` is the agent's `explore`, and does none of those. Both share the same namespace, which is why the system prompt tells the model not to change state in `explore`.

A `display()` function is injected into the namespace for showing values mid-cell.

## Rich outputs

`rich_output(value)` turns the last expression into an output:

| Value | Output |
| --- | --- |
| `pandas.DataFrame` | `table` |
| `pandas.Series` | `table` with one column |
| A matplotlib object | nothing, figures are collected separately |
| Anything else | `text` from `repr()`, clipped at 20,000 characters |

### Tables and column profiles

`table_output()` sends the first 100 rows and the real `totalRows`. Values go through `json_value()`, which turns NaN, infinity and `NaT` into `null` and numpy scalars into Python ones.

It also adds a `profile` entry for up to 200 columns. Each has dtype, count, missing, distinct count, and either min, max and mean for numbers and dates, or the top 3 values for text and booleans. Columns with more than 200,000 non-null values are sampled with `random_state=0`. If profiling throws, the table still goes out without it.

The renderer opens tables with more than 20 rows on the column overview, and smaller ones on their rows.

### Figures

`MPLBACKEND=Agg` is set in the environment. After each run, `collect_figures()` saves every open figure as a PNG, emits it as base64, and closes them all.

`style_matplotlib()` sets a dark theme with a `#161616` background at startup, whatever the app's theme. Charts look the same in light and dark mode. Change the rcParams there if that ever needs to follow the app.

## Lifecycle

`NotebookSession` in `electron/session.ts` owns the kernel.

- `warmUp()` starts it in the background at launch and after every restart.
- `ensureKernel()` starts it on demand and shares one start promise between concurrent callers.
- `openWorkspace(dir)` restarts it in the new notebook's folder. New and opened notebooks always get a fresh kernel.
- `moveWorkspace(dir)` runs `os.chdir()` in the live kernel after Save As into another folder, so variables survive.
- `interrupt()` sends `SIGINT`, but only while the kernel is busy. The script catches a stray interrupt between requests.
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
