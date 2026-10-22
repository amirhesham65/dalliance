# The Python kernel

Dalliance doesn't use Jupyter's kernel protocol or ZeroMQ. It runs its own small Python script and talks to it over pipes. When IPython is installed, the script runs cells through IPython's `InteractiveShell`, in process, so magics, top-level `await` and rich display work. See [IPython](#ipython).

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

The child's environment is `process.env` with provider API key variables removed, plus `MPLBACKEND=Agg` and `PYTHONUNBUFFERED=1`. `pythonEnv()` applies the same filtering to Python discovery, package listing and installs. Keys entered in Settings stay in the main process and are never exported to the environment. See [providers.md](providers.md#key-storage).

Requests:

```json
{"id": "7", "op": "execute", "code": "orders.head()", "store": true}
{"id": "8", "op": "variables"}
{"id": "9", "op": "environment"}
```

Replies:

```json
{"id": null, "type": "ready", "python": "3.12.4", "executable": "/…/python", "ipython": "9.1.0"}
{"id": "7", "type": "output", "output": {"type": "table", "...": "..."}}
{"id": "7", "type": "done", "ok": true, "executionCount": 3, "durationMs": 41, "assigned": [...], "filesRead": {"paths": ["orders.csv"], "truncated": false}}
{"id": "8", "type": "variables", "variables": [...]}
{"id": "9", "type": "environment", "python": "3.12.4", "packages": [{"name": "numpy", "version": "2.1.3"}, {"name": "pandas", "version": "2.2.3"}]}
```

`ready` arrives once at startup. Its `ipython` is the IPython version cells run through, or `null` on the plain path. An execute sends zero or more `output` messages, then one `done`. Its `filesRead` is what the run read, see [Files read](#files-read). `environment` answers with the Python version and the packages the executes imported, see [Imported packages](#imported-packages).

`PythonKernel.request()` chains every request on a promise queue, so they run one at a time in order, like a Jupyter shell channel.

The script's request loop catches any exception per request. A request that fails outside the cell's own `try` gets an `error` output and a `done` with `ok: false`, and the kernel keeps running.

`handle()` returns a request's last reply and the loop sends it, so every request gets exactly one `done`, `variables` or `environment`. The `SIGINT` handler, `on_interrupt()`, raises `KeyboardInterrupt` only while `interruptible` is set, which `run()` does just for the cell's own code, figures and value. An interrupt that lands between requests or while the kernel sends a reply is ignored, so it can't skip the reply and leave the request hanging.

## Executing code

`run(code, store)` in the script works like a notebook cell. On the plain path, without IPython:

1. Parse the code with `ast`. If the last statement is an expression, pull it out.
2. `exec` the rest in the shared namespace, then `eval` the last expression.
3. Collect matplotlib figures, and emit the last value as a rich output.
4. On any `BaseException`, including `KeyboardInterrupt`, emit an `error` output. Frames from `dalliance_kernel.py` are dropped so the traceback starts at the user's code. The message and each frame are clipped at 20,000 characters.
5. Emit a note for anything the run's budget dropped. See [Output budgets](#output-budgets).
6. When `store` is true, compare the namespace to a snapshot by `id()` and report new or rebound names as `assigned`.

With IPython, `run_shell()` replaces steps 1 to 4: `InteractiveShell.run_cell()` runs the code, then figures are collected and the last value is shown, in the same order. Steps 5 and 6 are the same on both paths. See [IPython](#ipython).

`store: true` is a real cell run. It advances the execution count, sets `_`, and reports assigned variables. `store: false` is the agent's `explore`, and does none of those. Both share the same namespace, which is why the system prompt tells the model not to change state in `explore`. A name an `explore` call defines anyway stays there for later cells and isn't reported as `assigned`, so a cell can come to depend on it unseen. A restart clears it, which is how Verify catches such a cell (see [notebook-model.md](notebook-model.md#verifying-a-notebook)).

A `display()` function is injected into the namespace for showing values mid-cell. With IPython, it passes keyword arguments such as `display_id` on to IPython's `display()`.

`sys.path` starts with `''`, the working directory, and leaves out the folder the script was written to. `import helpers` finds `helpers.py` in the notebook's folder, and still does after `os.chdir()`. Import caches are cleared before each run, so a file written since the last cell imports too.

Every execute, `store` or not, also reports the files it read. See [Files read](#files-read).

Variables are described by `describe()`, which reads the value's type, shape and a short `repr`. If that throws for some value, the entry keeps its name and type with an empty shape and detail.

## Files read

A `pd.read_csv()` inside a cell never goes through the agent's tools, so the harness can't see it. The kernel can: at startup `main()` installs `on_audit()` with `sys.addaudithook()`, and it listens for Python's `open` audit event. That event fires for `open()`, `os.open()` and `io.open_code()`, whoever calls them: the cell, pandas, NumPy, or an import of a module in the notebook's folder.

`run()` starts a fresh `FileReads` for each execute, rooted at the working directory the run starts in, and sends what it saw as `filesRead` on the `done` line, over fd 3 like every other reply:

```json
{"paths": ["data/orders.csv", "helpers.py"], "truncated": false}
```

- `paths` are relative to that folder, with `/`, in the order first opened, each once.
- Only reads count: a mode with `r` from `open()`, or flags without write access or `O_TRUNC` from `os.open()`. Writes, open file descriptors, files that don't exist, folders and `__pycache__` files are left out, and so is anything outside the folder.
- At most `MAX_FILES_READ` = 100 paths. Past that, `truncated` is true.
- It costs little. Any other audit event returns after one comparison, and so does an open between requests. The first open of a path costs a `getcwd()` and a `stat()`. The path is then remembered, up to `MAX_SEEN_PATHS` = 4,096 per run, so a loop that opens the same file again costs a set lookup: well under a microsecond on top of the open itself.
- The hook never raises into the code that opened the file. Audit hooks can't be removed, so it stays installed and does nothing between requests.
- It sees what Python opens. A C library that opens files itself, without Python's `open`, and a path that reaches the folder through a symlink from outside it, aren't counted.

`PythonKernel.execute()` hands it on as `ExecuteResult.filesRead: { paths, truncated }`. It is optional, so a kernel that doesn't report it still fits the interface. The harness puts it in the cell's record of how it was made (see [notebook-model.md](notebook-model.md#how-a-cell-was-made)), and the session keeps each cell run's list for the notebook's pins, which hash the data the cells read (see [notebook-model.md](notebook-model.md#pins)). Anything else that needs the files a run read should take them from here.

## Imported packages

The notebook's pins record the versions of the packages its cells used (see [notebook-model.md](notebook-model.md#pins)). Only the kernel knows what they imported, so it answers the `environment` request with `environment()`.

Every execute, cell run or `explore`, adds to `imported_modules` for the life of the kernel:

- the top-level names its `import` and `from ... import` statements give, read with `ast` from the code, or on the IPython path from the code after `transform_cell()`. Code that doesn't parse adds none. Relative imports don't count.
- every top-level module that first loaded while it ran, which catches `importlib.import_module()` and what a library loads on demand, like pyarrow behind `pd.read_parquet()`.

What the kernel loads for itself at startup, IPython and matplotlib's styling, isn't in it. Nor is pandas when a value only looks like a table: `rich_outputs()` takes pandas from `sys.modules` instead of importing it, since a value can only be a DataFrame once something loaded pandas.

`environment()` maps those names to distributions with `importlib.metadata.packages_distributions()`, then adds each package they require, following `Requires-Dist` without the ones behind an extra, as long as that package is loaded too. So `import pandas` pins pandas along with numpy, python-dateutil and the rest of what it requires, but not matplotlib, which pandas only lists under an extra, even though the kernel loaded it at startup. A name that failed to import, or is in `sys.stdlib_module_names`, doesn't count. Python 3.9 has neither function, so there the kernel reads each distribution's `top_level.txt` or file list itself, and counts a module as standard library when it is built in or lives in the standard library folder outside `site-packages`.

- The reply lists `{ name, version }` sorted by name, with the name as the distribution's metadata spells it, at most `MAX_PACKAGES` = 500.
- Reading every installed distribution takes 100 ms or more, so `module_providers()` keeps the map until the modification time of a folder on `sys.path` changes, which an install or an uninstall does.
- It waits behind a running execute like every request. The session never asks while a cell runs, see [notebook-model.md](notebook-model.md#recording-them).

`PythonKernel.environment()` returns it as a `KernelEnvironment`. `FakeKernel` reports whatever its `packages` field holds.

## IPython

At startup `start_ipython()` imports IPython and creates an `InteractiveShell` over the kernel's namespace. It needs IPython 8 or 9, since `configure()` patches internals checked against those two. If IPython is missing, another version, fails to start, or `DALLIANCE_KERNEL_NO_IPYTHON=1` is set, `shell` stays `None` and every cell takes the plain path above, exactly as before IPython support. IPython is in `BASE_PACKAGES`, installed as `ipython>=8,<10`, so the managed environment has it. A Python the user brings works either way. It adds about 125 ms to the time before `ready`: 400 ms instead of 280 ms, median of seven starts with IPython 9.17 and matplotlib on Linux.

There is no ZeroMQ and no ipykernel. The shell lives inside the script, and every protocol rule above still holds: replies go through the writer thread on fd 3, one request runs at a time, `SIGINT` only raises while `interruptible` is set, and `input()` still refuses.

What IPython adds:

- Magics such as `%time`, `%timeit`, `%pip` and `%%writefile`, and `!cmd` shell commands.
- Top-level `await`.
- `display()` and `IPython.display` objects, and anything with `_repr_png_`, `_repr_html_` or `_repr_mimebundle_`. See [Rich outputs](#rich-outputs).
- A trailing `;` hides the last value.
- History for cell runs: `_`, `__`, `___`, `_N`, `Out`, `In` and `_i`. The kernel sets `shell.execution_count` before each run, so IPython's numbers match `executionCount`. `store: false` runs with `store_history=False` under the next cell's number without advancing it, and the displayhook skips `_` and `Out`, so `explore` leaves the count and the history alone.

How the shell is set up to fit the kernel:

| IPython part | Replaced with |
| --- | --- |
| `DisplayHook` | `Hook`: keeps `_` and `Out` for cell runs only, and holds the value until the run's figures are out |
| `DisplayPublisher` | `Publisher`: turns each display bundle into outputs within the run's budget, instead of printing it |
| `display_formatter.format` | Hands tables and matplotlib objects back to the kernel's own outputs, unformatted |
| `showtraceback`, `showsyntaxerror` | Emit an `error` output with Python's usual traceback. Frames from the kernel and from IPython's package are dropped, and so are event loop frames at the top when a Stop lands in an `await` |
| `system`, `getoutput` | `run_command()`: the command runs with stdin on `/dev/null`, its output streams as `stdout` and `stderr`, and a Stop sends `SIGINT` to its process group, then `SIGKILL` a second later, then stops the cell |
| `%matplotlib` | Does nothing. Figures are collected after each run anyway, with the kernel's dark style. `%pylab` raises a `UsageError` |
| History | In memory only (`hist_file=":memory:"`). IPython 9's copies of every print and every error are turned off, since nothing reads them and they grow without bound |

### Shell commands and the code policy

`!cmd`, `%pip` and `%%bash` run real commands. The harness's code policy (`harness/code-policy.ts`, see [agent-harness.md](agent-harness.md)) reads the agent's code before `explore` and `run_cell` and asks before shell commands: a line starting with `!`, `%pip`, `%conda`, `%%bash` and similar. The kernel refuses the IPython forms the policy doesn't look for, so they can't get past it:

- Automagic is off and IPython's shell aliases are gone, so `pip install x` or `ls` alone is a plain Python line, not a command.
- `x = !cmd`, and `x = %sx cmd` or any other assignment from `%system`, `%sx`, `%pip`, `%conda` or `%mamba`, raise a `UsageError`. The policy only matches those at the start of a line.
- `%time`, `%timeit` and `%prun` run their argument as a cell, so `%time !ls` or `%time %sx ls` would hide a command mid-line. While one of them runs, `transform_cell()` raises a `UsageError` for code that calls a shell. The cell forms, `%%time` and the like, are fine: their commands start a line.
- `UNCHECKED_LINE_MAGICS` and `UNCHECKED_CELL_MAGICS` raise a `UsageError`: `%alias`, `%alias_magic`, `%rehashx`, `%sc`, `%edit`, `%micromamba`, `%uv`, `%pastebin`, `%load`, `%loadpy`, `%pycat`, `%%!`, `%%perl`, `%%ruby`, `%%python` and the like.

A new magic that runs commands needs either a policy rule or a place on those lists.

## Rich outputs

`rich_outputs(value)` turns the last expression, or a value passed to `display()`, into outputs:

| Value | Output |
| --- | --- |
| `pandas.DataFrame` | `table` |
| `pandas.Series` | `table` with one column |
| A matplotlib object | nothing, figures are collected separately |
| Anything else, plain path | `text` from `repr()`, clipped at 20,000 characters |
| Anything else, with IPython | IPython's display bundle, through `bundle_outputs()`: `image/png` becomes an `image`, otherwise `text/plain` becomes `text`, clipped at 20,000 characters |

With IPython, `text/plain` is IPython's pretty repr. When that is only a bare object repr, like `<__main__.Card at 0x10f3>` or `<IPython.core.display.HTML object>`, the text of the bundle's `text/markdown` or `text/html` is used instead, with the tags, scripts and styles stripped. Other types, such as SVG, JPEG, LaTeX and JavaScript, are ignored: the `Output` type has no place for them. A displayed PNG counts against the same 20 image limit as figures, and one over 4,000 pixels on a side is replaced by a note. When the bundle's `image/png` metadata gives a `width` or `height`, as IPython's `Image(retina=True)` or `Image(width=...)` does, the output carries it as the size to show the image at. One side alone keeps the image's proportions. A size that isn't a positive number up to 4,000, such as `True` or `-1`, is ignored, and the PNG shows one pixel per pixel.

The renderer never sees HTML. Showing it would need a new `Output` variant in `packages/shared` and a sandboxed view in the renderer.

### Tables and column profiles

`table_outputs()` sends the first 100 rows, the first 50 columns and the real `totalRows`. A wider frame gets a note after the table, `Showing the first 50 of 5,000 columns.` Values go through `json_value()`, which turns NaN, infinity and `NaT` into `null` and numpy scalars into Python ones. Text in a cell, a header or an index label is clipped at 1,000 characters.

It also adds a `profile` entry for each column it sends. Each has dtype, count, missing, distinct count, and either min, max and mean for numbers and dates, or the top 3 values for text and booleans. Columns with more than 200,000 non-null values are sampled with `random_state=0`. If profiling throws, the table still goes out without it.

The renderer opens tables with more than 20 rows on the column overview, and smaller ones on their rows.

### Figures

`MPLBACKEND=Agg` is set in the environment. After each run, `collect_figures()` saves every open figure as a PNG, emits it as base64, and closes them all.

Figures are drawn at twice their dpi, `FIGURE_SCALE`, so they stay sharp on a Retina screen. `render_figure()` returns the `image` output with `width` and `height` set to the size to show it at: the figure's own size at its dpi, as if drawn at 1x, which is about half the PNG's pixels. The renderer shows it at that size, so a chart takes the same space it did at 1x. With the kernel's 110 dpi, a 6.4 by 4.8 inch figure is a PNG of about 1,400 by 1,050 pixels, shown at 700 by 525.

`render_figure()` keeps a PNG within 4,000 pixels on a side. A bigger figure is saved at a lower dpi, and still shows at its own size, and checked again after saving, since the tight bounding box can grow past the figure. One that would need less than 10 dpi to fit, such as a 500-inch-wide figure, is skipped with a note giving its size.

`style_matplotlib()` sets a dark theme with a `#161616` background at startup, whatever the app's theme. Charts look the same in light and dark mode. Change the rcParams there if that ever needs to follow the app.

## Output budgets

Each execute gets a fresh `Budget`, so one cell can't flood the app or the agent's context. What goes past a limit is dropped, and the kernel says so in a short note: a `stream` output on `stderr`, which the renderer shows in the warning color. The limits are constants at the top of the script.

| Limit | Value | Past it |
| --- | --- | --- |
| `MAX_STREAM_CHARS` | 1,000,000 characters of stdout and stderr together | The rest is dropped. At the end of the run, one note: `Output truncated: 49,000,001 more characters.` |
| `MAX_DISPLAYS` | 100 values from `display()` and the last expression | The rest are dropped, with one note at the end of the run |
| `MAX_TABLE_COLUMNS` | 50 columns per table | See [Tables](#tables-and-column-profiles) |
| `MAX_CELL_TEXT` | 1,000 characters per table cell or header | Clipped |
| `MAX_IMAGES` | 20 images: figures, and PNGs shown with `display()` or as the last value | The rest are closed unsaved or dropped, with one note |
| `MAX_FIGURE_SIDE` | 4,000 pixels on a side | See [Figures](#figures) |

Notes don't count against the budget. The `Output` type in `packages/shared` has no field for them, so a note is an ordinary stderr stream.

`python-kernel.test.ts` covers each limit and the interrupt escalation below. `kernel-protocol.test.ts` drives the script over raw pipes, interrupts printing loops again and again, and checks that every line parses and every request gets its `done`. Both files run these suites twice, through IPython and on the plain path with `DALLIANCE_KERNEL_NO_IPYTHON=1`, and `python-kernel.test.ts` adds one suite for what only IPython does. The IPython runs are skipped when the test machine's Python lacks IPython 8 or 9. CI installs it.

## Lifecycle

`NotebookSession` in `electron/session.ts` owns the kernel.

- `warmUp()` starts it in the background at launch and after every restart.
- `ensureKernel()` starts it on demand and shares one start promise between concurrent callers.
- `openWorkspace(dir)` restarts it in the new notebook's folder and remembers the folder. New and opened notebooks always get a fresh kernel.
- `moveWorkspace(dir)` runs `os.chdir()` in the live kernel after Save As into another folder, so variables survive.
- `restart()` bumps a generation counter, shuts the kernel down and warms up a new one. A kernel that was still starting when the restart came is discarded once it's up: it belongs to an older generation and may be in the old folder, so `ensureKernel()` shuts it down and hands its waiters the current one. Verify restarts through this too, so it never runs a second kernel beside the first.
- `interrupt()` sends `SIGINT`, but only while the kernel is busy. The script ignores an interrupt that lands between requests.
- If the run is still going 5 seconds after `interrupt()`, because the cell swallows `KeyboardInterrupt` or sits in C code that never checks for signals, `PythonKernel` `SIGKILL`s the process. The running request and everything queued behind it reject with `KILLED_AFTER_INTERRUPT`, "The kernel didn't stop, so it was restarted. Variables were lost.", and the status goes `dead` with that as the error. The session's next `ensureKernel()` starts a fresh kernel. Pressing Stop again doesn't push the deadline back, and a run that finishes in time cancels it. `interruptGraceMs` in the options changes the 5 seconds, for tests.
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

`setupManagedEnv()` creates the venv with the system Python if needed, then pip-installs `BASE_PACKAGES` (the three above plus SciPy, statsmodels, seaborn, scikit-learn and IPython), streaming lines to the renderer over `python-log`. Changing `pythonPath` in Settings restarts the kernel.

When `BASE_PACKAGES` grows, an existing managed environment doesn't pick up the new packages on its own. The update in Settings > Python runs `setupManagedEnv()` again, which installs the whole list into the existing venv.

`installPackages()` only accepts package names: `isPackageSpec()` rejects anything that starts like a pip option or a path, and every archive name pip would install as a local file (`.whl`, `.zip`, `.tar`, `.tgz`, `.tar.gz`, `.tbz`, `.tar.bz2`, `.txz`, `.tlz`, `.tar.xz`, `.tar.lz`, `.tar.lzma`). When pip refuses a Homebrew or Debian Python with `externally-managed-environment` (PEP 668), it throws `EXTERNALLY_MANAGED_MESSAGE`, which tells the user to set up the managed environment in Settings > Python. It never passes `--break-system-packages`.

## The Kernel interface

The harness depends on `Kernel`, not `PythonKernel`:

```ts
interface Kernel {
  info(): KernelInfo
  execute(code: string, options: { store: boolean; onOutput? }): Promise<ExecuteResult>  // ok, outputs, executionCount, durationMs, assigned, filesRead?
  variables(): Promise<VariableInfo[]>
  environment(): Promise<KernelEnvironment>  // python, packages
  interrupt(): void
  restart(): Promise<void>
  shutdown(): Promise<void>
}
```

`FakeKernel` answers every `execute()` with a handler you pass in and records what ran. The handler can return `filesRead` paths too. Use it for harness tests. See [testing.md](testing.md).
