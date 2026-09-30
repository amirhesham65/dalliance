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

Requests can't be read by a cell either. At startup the script reads requests from a copy of fd 0 and puts `/dev/null` on fd 0 and `sys.stdin`. Reading stdin in a cell, or in a subprocess it starts, returns nothing. `input()` raises `EOFError` saying cells can't read input.

The child's environment is `process.env` minus the API keys in `ENV_KEYS` from `settings.ts`. Code in a cell can't read the model's keys.

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

## Executing code

`run(code, store)` in the script works like a notebook cell:

1. Parse the code with `ast`. If the last statement is an expression, pull it out.
2. `exec` the rest in the shared namespace, then `eval` the last expression.
3. Flush streams, collect matplotlib figures, and emit the last value as a rich output.
4. On any `BaseException`, including `KeyboardInterrupt`, emit an `error` output. Frames from `dalliance_kernel.py` are dropped so the traceback starts at the user's code.
5. When `store` is true, compare the namespace to a snapshot by `id()` and report new or rebound names as `assigned`.

`store: true` is a real cell run. It advances the execution count, sets `_`, and reports assigned variables. `store: false` is the agent's `explore`, and does none of those. Both share the same namespace, which is why the system prompt tells the model not to change state in `explore`.

A `display()` function is injected into the namespace for showing values mid-cell.

`sys.path` starts with `''`, the working directory, and leaves out the folder the script was written to. `import helpers` finds `helpers.py` in the notebook's folder, and still does after `os.chdir()`. Import caches are cleared before each run, so a file written since the last cell imports too.

Variables are described by `describe()`, which reads the value's type, shape and a short `repr`. If that throws for some value, the entry keeps its name and type with an empty shape and detail.

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
3. The newest system Python that is 3.9 or newer, from `findSystemPython()`.

On a Mac, an app started from the Dock gets a `PATH` like `/usr/bin:/bin`, where `python3` is Apple's: an old 3.9 from the Command Line Tools, or an install prompt when they're missing. So `findSystemPython()` collects `python3` from the `PATH` (unless that is `/usr/bin/python3`), plus `python3` and every `python3.N` in `/opt/homebrew/bin`, `/usr/local/bin` and the python.org framework, and picks the newest. A tie goes to the earlier candidate. Only when none qualifies does it try `/usr/bin/python3`, and only after `xcode-select -p` succeeds, so it never triggers the install prompt. On Linux it picks the newest of `python3`, `/usr/local/bin/python3` and `/usr/bin/python3`. It takes injected `exec`, `exists`, `list`, `path` and `platform`, so the tests fake a whole machine.

It also reports which of `pandas`, `numpy` and `matplotlib` are missing. The renderer shows a banner when any are.

`setupManagedEnv()` creates the venv with the system Python if needed, then pip-installs `BASE_PACKAGES` (the three above plus SciPy, statsmodels, seaborn and scikit-learn), streaming lines to the renderer over `python-log`. Changing `pythonPath` in Settings restarts the kernel.

Environments made before `BASE_PACKAGES` grew only have the three required packages. `missingBasePackages(envDir)` reports which base packages the managed environment lacks, as pip names, and `installMissingBasePackages(envDir, onLog)` installs just those and resolves with their names. Both do nothing when there's no managed environment.

`installPackages()` only accepts package names: `isPackageSpec()` rejects anything that starts like a pip option or a path, and every archive name pip would install as a local file (`.whl`, `.zip`, `.tar`, `.tgz`, `.tar.gz`, `.tbz`, `.tar.bz2`, `.txz`, `.tlz`, `.tar.xz`, `.tar.lz`, `.tar.lzma`). When pip refuses a Homebrew or Debian Python with `externally-managed-environment` (PEP 668), it throws `EXTERNALLY_MANAGED_MESSAGE`, which tells the user to set up the managed environment in Settings > Python. It never passes `--break-system-packages`.

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
