"""Dalliance kernel.

A small Python process that keeps one namespace alive between cells.
Requests arrive as JSON lines on stdin. Replies go out as JSON lines on fd 3,
so anything a library prints straight to the real stdout cannot corrupt the protocol.

Request:  {"id": "...", "op": "execute", "code": "...", "store": true}
          {"id": "...", "op": "variables"}
Replies:  {"id": "...", "type": "output", "output": {...}}   zero or more
          {"id": "...", "type": "done", "ok": true, "executionCount": 3, "durationMs": 12}
          {"id": "...", "type": "variables", "variables": [...]}

Only the writer thread writes to fd 3, and SIGINT raises KeyboardInterrupt only while a cell's
code runs, so a Stop can neither tear a reply line nor lose a request's last reply.
"""

import ast
import base64
import builtins
import importlib
import io
import json
import math
import os
import queue
import signal
import sys
import threading
import time
import traceback

PROTOCOL_FD = 3

# Requests come in on the real stdin. Move it to a private fd and put /dev/null on fd 0,
# so neither input() in a cell nor a subprocess it starts can swallow the next request.
REQUESTS = os.fdopen(os.dup(0), "r", encoding="utf-8")
_null = os.open(os.devnull, os.O_RDONLY)
os.dup2(_null, 0)
os.close(_null)
sys.stdin = open(os.devnull, "r", encoding="utf-8")


def no_input(prompt=""):
    raise EOFError("Dalliance cells can't read input. Put the value in the code instead.")


builtins.input = no_input

# Imports resolve from the notebook's folder, which is the working directory, not from
# the folder this script was written to. '' follows os.chdir() when the notebook moves.
_here = os.path.dirname(os.path.abspath(__file__))
sys.path[:] = [""] + [p for p in sys.path if p and os.path.abspath(p) != _here]
MAX_TABLE_ROWS = 100
MAX_TEXT = 20_000

# Per-execute output budgets. Past them the kernel drops output and says so in a short stderr note.
MAX_STREAM_CHARS = 1_000_000  # stdout and stderr together
MAX_TABLE_COLUMNS = 50
MAX_CELL_TEXT = 1_000  # one table cell or header
MAX_DISPLAYS = 100  # values shown by display() and the last expression
MAX_IMAGES = 20
MAX_FIGURE_SIDE = 4_000  # pixels; a bigger figure is drawn at a lower dpi
MIN_FIGURE_DPI = 10  # a figure that would need less than this to fit is skipped

# Stream text is coalesced: sent once this much has built up, or this long after the first unsent write.
STREAM_FLUSH_CHARS = 64_000
STREAM_FLUSH_SECONDS = 0.05

os.environ.setdefault("MPLBACKEND", "Agg")

namespace = {"__name__": "__main__"}
execution_count = 0
current_id = None
# True only while a cell's code runs. SIGINT anywhere else, such as between requests or while
# the kernel sends a reply, is ignored.
interruptible = False


def on_interrupt(signum, frame):
    if interruptible:
        raise KeyboardInterrupt


# --- Sending -------------------------------------------------------------------------------

KERNEL_PID = os.getpid()
OUTBOX = queue.SimpleQueue()  # finished protocol lines, and ("stream", id, name, text) to coalesce
STOP = object()


def write_line(line):
    """Write one whole line to fd 3."""
    view = memoryview(line.encode("utf-8"))
    while view:
        view = view[os.write(PROTOCOL_FD, view) :]


def stream_line(request_id, name, text):
    output = {"type": "stream", "name": name, "text": text}
    return json.dumps({"id": request_id, "type": "output", "output": output}) + "\n"


def writer():
    """The only thread that writes to fd 3. It blocks every signal, so nothing stops it mid-line."""
    if hasattr(signal, "pthread_sigmask"):
        signal.pthread_sigmask(signal.SIG_BLOCK, signal.valid_signals())
    broken = False
    pending = None  # [id, name, pieces, size, deadline]: stream text not sent yet

    def put(line):
        nonlocal broken
        if broken:
            return
        try:
            write_line(line)
        except OSError:  # the app closed the pipe; keep draining so the kernel never blocks
            broken = True

    def flush():
        nonlocal pending
        if pending is not None:
            put(stream_line(pending[0], pending[1], "".join(pending[2])))
            pending = None

    while True:
        try:
            if pending is None:
                item = OUTBOX.get()
            else:
                item = OUTBOX.get(timeout=max(0.0, pending[4] - time.monotonic()))
        except queue.Empty:
            flush()
            continue
        if item is STOP:
            flush()
            return
        if isinstance(item, tuple):
            _, request_id, name, text = item
            if pending is not None and (pending[0], pending[1]) != (request_id, name):
                flush()
            if pending is None:
                pending = [request_id, name, [], 0, time.monotonic() + STREAM_FLUSH_SECONDS]
            pending[2].append(text)
            pending[3] += len(text)
            if pending[3] >= STREAM_FLUSH_CHARS:
                flush()
        else:
            flush()  # keep order: earlier prints go out before this output
            put(item)


WRITER = threading.Thread(target=writer, name="dalliance-protocol", daemon=True)


def forked():
    """A process forked by a cell has no writer thread, so it writes its own lines."""
    return os.getpid() != KERNEL_PID


def send(message):
    line = json.dumps(message, default=str) + "\n"
    if forked():
        write_line(line)
    else:
        OUTBOX.put(line)


def emit(output):
    send({"id": current_id, "type": "output", "output": output})


def clip(text, limit):
    return text if len(text) <= limit else text[:limit] + f"... ({len(text) - limit:,} more characters)"


def note(text):
    """A short remark from the kernel, such as what it left out. Shown as stderr."""
    return {"type": "stream", "name": "stderr", "text": text + "\n"}


class Budget:
    """What one execute may still send."""

    def __init__(self):
        self.stream_left = MAX_STREAM_CHARS
        self.stream_dropped = 0
        self.displays = 0
        self.displays_dropped = 0
        self.images = 0

    def notes(self):
        if self.stream_dropped:
            yield note(f"Output truncated: {self.stream_dropped:,} more characters.")
        if self.displays_dropped:
            yield note(f"{self.displays_dropped:,} more displayed values not shown (limit {MAX_DISPLAYS} per run).")


budget = Budget()


class Stream(io.TextIOBase):
    """Sends print() output. The writer thread coalesces it into a few messages."""

    def __init__(self, name, request_id, budget):
        self.name = name
        self.request_id = request_id
        self.budget = budget

    def writable(self):
        return True

    def write(self, text):
        if not isinstance(text, str):
            raise TypeError(f"write() argument must be str, not {type(text).__name__}")
        size = len(text)
        left = self.budget.stream_left
        if size > left:
            self.budget.stream_dropped += size - left
            text = text[:left]
        self.budget.stream_left -= len(text)
        if text:
            if forked():
                write_line(stream_line(self.request_id, self.name, text))
            else:
                OUTBOX.put(("stream", self.request_id, self.name, text))
        return size

    def flush(self):
        pass  # the writer thread sends within STREAM_FLUSH_SECONDS


# --- Rich outputs --------------------------------------------------------------------------


def json_value(value):
    """Make a table cell JSON safe."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    try:
        import numpy as np

        if isinstance(value, np.generic):
            return json_value(value.item())
    except ImportError:
        pass
    try:
        import pandas as pd

        if value is pd.NaT or (not isinstance(value, (list, tuple, dict)) and pd.isna(value)):
            return None
    except (ImportError, TypeError, ValueError):
        pass
    return str(value)


def cell_value(value):
    value = json_value(value)
    return clip(value, MAX_CELL_TEXT) if isinstance(value, str) else value


PROFILE_SAMPLE = 200_000


def profile_column(name, series):
    """A one-line summary of a column: type, missing, distinct values, and a range or the top values."""
    import pandas as pd

    total = len(series)
    missing = int(series.isna().sum())
    sample = series.dropna()
    if len(sample) > PROFILE_SAMPLE:
        sample = sample.sample(PROFILE_SAMPLE, random_state=0)
    info = {"name": clip(str(name), MAX_CELL_TEXT), "dtype": str(series.dtype), "missing": missing, "count": total}
    try:
        info["unique"] = int(sample.nunique())
    except TypeError:  # unhashable values such as lists
        info["unique"] = None
    if pd.api.types.is_bool_dtype(series):
        info["kind"] = "boolean"
        info["top"] = [[str(k), int(v)] for k, v in sample.value_counts().head(3).items()]
    elif pd.api.types.is_numeric_dtype(series):
        info["kind"] = "number"
        if len(sample):
            info["min"] = json_value(sample.min())
            info["max"] = json_value(sample.max())
            info["mean"] = json_value(float(sample.mean()))
    elif pd.api.types.is_datetime64_any_dtype(series):
        info["kind"] = "date"
        if len(sample):
            info["min"] = str(sample.min())
            info["max"] = str(sample.max())
    else:
        info["kind"] = "text"
        if info["unique"] is not None:
            counts = sample.astype(str).value_counts().head(3).items()
            info["top"] = [[clip(str(k), MAX_CELL_TEXT), int(v)] for k, v in counts]
    return info


def table_outputs(frame):
    """A table of the first rows and columns, and a note when columns were left out."""
    total_columns = frame.shape[1]
    frame = frame.iloc[:, :MAX_TABLE_COLUMNS]
    head = frame.head(MAX_TABLE_ROWS)
    output = {
        "type": "table",
        "columns": [clip(str(c), MAX_CELL_TEXT) for c in head.columns],
        "index": [clip(str(i), MAX_CELL_TEXT) for i in head.index],
        "rows": [[cell_value(v) for v in row] for row in head.itertuples(index=False, name=None)],
        "totalRows": int(len(frame)),
    }
    try:
        output["profile"] = [profile_column(name, frame.iloc[:, i]) for i, name in enumerate(frame.columns)]
    except Exception:
        pass  # the overview is a convenience; the table still renders without it
    if total_columns > MAX_TABLE_COLUMNS:
        return [output, note(f"Showing the first {MAX_TABLE_COLUMNS} of {total_columns:,} columns.")]
    return [output]


def rich_outputs(value):
    """Turn the value of a cell's last expression into outputs, like Jupyter's Out[n]."""
    try:
        import pandas as pd

        if isinstance(value, pd.DataFrame):
            return table_outputs(value)
        if isinstance(value, pd.Series):
            return table_outputs(value.to_frame(name=value.name if value.name is not None else "value"))
    except ImportError:
        pass
    module = type(value).__module__ or ""
    if module.startswith("matplotlib"):
        return []  # figures are collected separately
    text = repr(value)
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT] + f"\n... (truncated, {len(text)} characters)"
    return [{"type": "text", "text": text}]


def show(value):
    """Emit a value's outputs, within the run's display budget."""
    outputs = rich_outputs(value)
    if not outputs:
        return
    if budget.displays >= MAX_DISPLAYS:
        budget.displays_dropped += 1
        return
    budget.displays += 1
    for output in outputs:
        emit(output)


def error_output(error, own_frames=False):
    frames = traceback.format_exception(type(error), error, error.__traceback__)
    if not own_frames:
        # Drop the kernel's own frames so the traceback starts at the user's code
        frames = [f for f in frames if "dalliance_kernel.py" not in f]
    return {
        "type": "error",
        "ename": type(error).__name__,
        "evalue": clip(str(error), MAX_TEXT),
        "traceback": [clip(f, MAX_TEXT) for f in frames],
    }


# --- Figures -------------------------------------------------------------------------------


def style_matplotlib():
    """Dark figures that sit well on the notebook background."""
    try:
        import matplotlib

        matplotlib.rcParams.update(
            {
                "figure.facecolor": "#161616",
                "axes.facecolor": "#161616",
                "savefig.facecolor": "#161616",
                "axes.edgecolor": "#3a3a3a",
                "axes.labelcolor": "#a3a3a3",
                "text.color": "#e8e8e8",
                "xtick.color": "#8a8a8a",
                "ytick.color": "#8a8a8a",
                "grid.color": "#262626",
                "axes.grid": True,
                "axes.spines.top": False,
                "axes.spines.right": False,
                "legend.frameon": False,
                "font.size": 10,
                "figure.dpi": 110,
                "axes.prop_cycle": matplotlib.cycler(
                    color=["#5fb3b3", "#e8793b", "#8e8eea", "#4cc764", "#e9b04a", "#d7a2f0"]
                ),
            }
        )
    except ImportError:
        pass


def png_size(data):
    """Width and height from a PNG's header."""
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def render_figure(figure):
    """PNG bytes at most MAX_FIGURE_SIDE on a side, or None when the figure can't fit legibly."""
    width, height = figure.get_size_inches()
    dpi = min(float(figure.dpi), MAX_FIGURE_SIDE / max(width, height, 1e-6))
    for _ in range(2):  # the tight bounding box can grow past the figure, so check and try once more
        if dpi < MIN_FIGURE_DPI:
            return None
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", bbox_inches="tight", dpi=dpi)
        data = buffer.getvalue()
        side = max(png_size(data))
        if side <= MAX_FIGURE_SIDE:
            return data
        dpi *= MAX_FIGURE_SIDE / side * 0.98
    return None


def collect_figures():
    if "matplotlib.pyplot" not in sys.modules:
        return
    import matplotlib.pyplot as plt

    over = 0
    for number in plt.get_fignums():
        if budget.images >= MAX_IMAGES:
            over += 1
            continue
        figure = plt.figure(number)
        data = render_figure(figure)
        if data is None:
            width, height = figure.get_size_inches() * figure.dpi
            emit(note(f"Figure {number} is {int(width):,} × {int(height):,} pixels, too big to show. Make it smaller."))
            continue
        budget.images += 1
        emit({"type": "image", "mime": "image/png", "data": base64.b64encode(data).decode("ascii")})
    plt.close("all")
    if over:
        emit(note(f"{over:,} more figures not shown (limit {MAX_IMAGES} per run)."))


def display(*values):
    """Show a value mid-cell, like IPython's display()."""
    for value in values:
        show(value)


namespace["display"] = display


# --- Requests ------------------------------------------------------------------------------


def run(code, store):
    global execution_count, budget, interruptible
    started = time.perf_counter()
    if store:
        execution_count += 1
    budget = Budget()
    before = {name: id(value) for name, value in namespace.items()}
    stdout, stderr = Stream("stdout", current_id, budget), Stream("stderr", current_id, budget)
    real_out, real_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = stdout, stderr
    ok = True
    importlib.invalidate_caches()  # see files written since the last cell
    try:
        interruptible = True
        tree = ast.parse(code, filename=f"<cell {execution_count}>", mode="exec")
        last = tree.body[-1] if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        if last is not None:
            tree.body = tree.body[:-1]
        exec(compile(tree, f"<cell {execution_count}>", "exec"), namespace)
        value = None
        if last is not None:
            value = eval(compile(ast.Expression(last.value), f"<cell {execution_count}>", "eval"), namespace)
        collect_figures()
        if value is not None:
            show(value)
            if store:
                namespace["_"] = value
    except BaseException as error:  # KeyboardInterrupt too: Stop in the app sends SIGINT
        interruptible = False
        ok = False
        emit(error_output(error))
        if "matplotlib.pyplot" in sys.modules:
            sys.modules["matplotlib.pyplot"].close("all")
    finally:
        interruptible = False
        sys.stdout, sys.stderr = real_out, real_err
    for output in budget.notes():
        emit(output)
    duration = int((time.perf_counter() - started) * 1000)
    assigned = []
    if store:
        for name, value in list(namespace.items()):
            if not listed(name, value) or before.get(name) == id(value):
                continue
            assigned.append(describe_safely(name, value))
    return {
        "id": current_id,
        "type": "done",
        "ok": ok,
        "executionCount": execution_count if store else None,
        "durationMs": duration,
        "assigned": assigned,
    }


def listed(name, value):
    """Whether a namespace entry shows up in the variables list."""
    import types

    if not isinstance(name, str) or name.startswith("_") or name == "display":
        return False
    try:
        return not isinstance(value, (types.ModuleType, types.FunctionType, types.BuiltinFunctionType, type))
    except Exception:
        return True


def describe_safely(name, value):
    """describe(), but a value that breaks it gets a bare entry instead of killing the kernel."""
    try:
        return describe(name, value)
    except Exception:
        return {"name": name, "type": type(value).__name__, "shape": "", "detail": ""}


def describe(name, value):
    kind = type(value).__name__
    shape = ""
    detail = ""
    try:
        import pandas as pd

        if isinstance(value, pd.DataFrame):
            shape = f"{value.shape[0]:,} × {value.shape[1]}"
            columns = ", ".join(f"{c}: {t}" for c, t in list(value.dtypes.astype(str).items())[:40])
            more = f", ... {value.shape[1] - 40} more" if value.shape[1] > 40 else ""
            detail = columns + more
        elif isinstance(value, pd.Series):
            shape = f"{len(value):,}"
            detail = str(value.dtype)
    except ImportError:
        pass
    if not shape:
        if hasattr(value, "shape") and isinstance(getattr(value, "shape"), tuple):
            shape = " × ".join(f"{n:,}" for n in value.shape)
        elif isinstance(value, (list, tuple, dict, set, str)):
            shape = f"{len(value):,}"
        if isinstance(value, (int, float, bool, str)) or value is None:
            text = repr(value)
            detail = text if len(text) < 120 else text[:117] + "..."
    return {"name": name, "type": kind, "shape": shape, "detail": detail}


def variables():
    result = []
    for name, value in list(namespace.items()):
        if listed(name, value):
            result.append(describe_safely(name, value))
    return {"id": current_id, "type": "variables", "variables": result}


def handle(request):
    """Run one request and return its last reply."""
    if request.get("op") == "execute":
        return run(request.get("code", ""), bool(request.get("store", True)))
    if request.get("op") == "variables":
        return variables()
    return {"id": current_id, "type": "done", "ok": False, "executionCount": None, "durationMs": 0}


def main():
    global current_id
    signal.signal(signal.SIGINT, on_interrupt)
    WRITER.start()
    style_matplotlib()
    send({"id": None, "type": "ready", "python": sys.version.split()[0], "executable": sys.executable})
    try:
        while True:
            line = REQUESTS.readline()
            if not line:
                break
            try:
                request = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(request, dict):
                continue
            current_id = request.get("id")
            try:
                reply = handle(request)
            except BaseException as error:  # one bad request fails on its own; the kernel keeps running
                reply = {"id": current_id, "type": "done", "ok": False, "executionCount": None, "durationMs": 0, "assigned": []}
                if not isinstance(error, KeyboardInterrupt):  # a cell that installed its own SIGINT handler
                    emit(error_output(error, own_frames=True))
            send(reply)
    finally:
        OUTBOX.put(STOP)
        WRITER.join(timeout=5)


if __name__ == "__main__":
    main()
