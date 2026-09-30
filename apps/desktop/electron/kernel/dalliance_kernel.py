"""Dalliance kernel.

A small Python process that keeps one namespace alive between cells.
Requests arrive as JSON lines on stdin. Replies go out as JSON lines on fd 3,
so anything a library prints straight to the real stdout cannot corrupt the protocol.

Request:  {"id": "...", "op": "execute", "code": "...", "store": true}
          {"id": "...", "op": "variables"}
Replies:  {"id": "...", "type": "output", "output": {...}}   zero or more
          {"id": "...", "type": "done", "ok": true, "executionCount": 3, "durationMs": 12}
          {"id": "...", "type": "variables", "variables": [...]}
"""

import ast
import base64
import builtins
import importlib
import io
import json
import math
import os
import sys
import time
import traceback

PROTOCOL = os.fdopen(3, "w", buffering=1, encoding="utf-8")

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

os.environ.setdefault("MPLBACKEND", "Agg")

namespace = {"__name__": "__main__"}
execution_count = 0
current_id = None


def send(message):
    PROTOCOL.write(json.dumps(message, default=str) + "\n")
    PROTOCOL.flush()


def emit(output):
    send({"id": current_id, "type": "output", "output": output})


class Stream(io.TextIOBase):
    """Collects print() output and sends it line by line."""

    def __init__(self, name):
        self.name = name
        self.buffer_text = ""

    def writable(self):
        return True

    def write(self, text):
        self.buffer_text += text
        if "\n" in self.buffer_text or len(self.buffer_text) > 4096:
            self.flush()
        return len(text)

    def flush(self):
        if self.buffer_text:
            emit({"type": "stream", "name": self.name, "text": self.buffer_text})
            self.buffer_text = ""


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


PROFILE_SAMPLE = 200_000


def profile_column(name, series):
    """A one-line summary of a column: type, missing, distinct values, and a range or the top values."""
    import pandas as pd

    total = len(series)
    missing = int(series.isna().sum())
    sample = series.dropna()
    if len(sample) > PROFILE_SAMPLE:
        sample = sample.sample(PROFILE_SAMPLE, random_state=0)
    info = {"name": str(name), "dtype": str(series.dtype), "missing": missing, "count": total}
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
            info["top"] = [[str(k), int(v)] for k, v in sample.astype(str).value_counts().head(3).items()]
    return info


def table_output(frame):
    head = frame.head(MAX_TABLE_ROWS)
    output = {
        "type": "table",
        "columns": [str(c) for c in head.columns],
        "index": [str(i) for i in head.index],
        "rows": [[json_value(v) for v in row] for row in head.itertuples(index=False, name=None)],
        "totalRows": int(len(frame)),
    }
    try:
        output["profile"] = [profile_column(name, frame[name]) for name in list(frame.columns)[:200]]
    except Exception:
        pass  # the overview is a convenience; the table still renders without it
    return output


def rich_output(value):
    """Turn the value of a cell's last expression into an output, like Jupyter's Out[n]."""
    try:
        import pandas as pd

        if isinstance(value, pd.DataFrame):
            return table_output(value)
        if isinstance(value, pd.Series):
            return table_output(value.to_frame(name=value.name if value.name is not None else "value"))
    except ImportError:
        pass
    module = type(value).__module__ or ""
    if module.startswith("matplotlib"):
        return None  # figures are collected separately
    text = repr(value)
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT] + f"\n... (truncated, {len(text)} characters)"
    return {"type": "text", "text": text}


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


def collect_figures():
    if "matplotlib.pyplot" not in sys.modules:
        return
    import matplotlib.pyplot as plt

    for number in plt.get_fignums():
        figure = plt.figure(number)
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", bbox_inches="tight")
        emit({"type": "image", "mime": "image/png", "data": base64.b64encode(buffer.getvalue()).decode("ascii")})
    plt.close("all")


def display(*values):
    """Show a value mid-cell, like IPython's display()."""
    for value in values:
        output = rich_output(value)
        if output:
            emit(output)


namespace["display"] = display


def run(code, store):
    global execution_count
    started = time.perf_counter()
    if store:
        execution_count += 1
    before = {name: id(value) for name, value in namespace.items()}
    stdout, stderr = Stream("stdout"), Stream("stderr")
    real_out, real_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = stdout, stderr
    ok = True
    importlib.invalidate_caches()  # see files written since the last cell
    try:
        tree = ast.parse(code, filename=f"<cell {execution_count}>", mode="exec")
        last = tree.body[-1] if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        if last is not None:
            tree.body = tree.body[:-1]
        exec(compile(tree, f"<cell {execution_count}>", "exec"), namespace)
        value = None
        if last is not None:
            value = eval(compile(ast.Expression(last.value), f"<cell {execution_count}>", "eval"), namespace)
        stdout.flush()
        stderr.flush()
        collect_figures()
        if value is not None:
            output = rich_output(value)
            if output:
                emit(output)
            if store:
                namespace["_"] = value
    except BaseException as error:  # KeyboardInterrupt too: Stop in the app sends SIGINT
        ok = False
        stdout.flush()
        stderr.flush()
        frames = traceback.format_exception(type(error), error, error.__traceback__)
        # Drop the kernel's own frames so the traceback starts at the user's code
        frames = [f for f in frames if "dalliance_kernel.py" not in f]
        emit({"type": "error", "ename": type(error).__name__, "evalue": str(error), "traceback": frames})
        if "matplotlib.pyplot" in sys.modules:
            sys.modules["matplotlib.pyplot"].close("all")
    finally:
        sys.stdout, sys.stderr = real_out, real_err
    duration = int((time.perf_counter() - started) * 1000)
    assigned = []
    if store:
        for name, value in list(namespace.items()):
            if not listed(name, value) or before.get(name) == id(value):
                continue
            assigned.append(describe_safely(name, value))
    send(
        {
            "id": current_id,
            "type": "done",
            "ok": ok,
            "executionCount": execution_count if store else None,
            "durationMs": duration,
            "assigned": assigned,
        }
    )


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
    send({"id": current_id, "type": "variables", "variables": result})


def main():
    global current_id
    style_matplotlib()
    send({"id": None, "type": "ready", "python": sys.version.split()[0], "executable": sys.executable})
    while True:
        try:
            line = REQUESTS.readline()
        except KeyboardInterrupt:
            continue  # an interrupt that arrives between cells
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
            if request.get("op") == "execute":
                run(request.get("code", ""), bool(request.get("store", True)))
            elif request.get("op") == "variables":
                variables()
            else:
                send({"id": current_id, "type": "done", "ok": False, "executionCount": None, "durationMs": 0})
        except KeyboardInterrupt:
            send({"id": current_id, "type": "done", "ok": False, "executionCount": None, "durationMs": 0})
        except BaseException as error:  # one bad request fails on its own; the kernel keeps running
            frames = traceback.format_exception(type(error), error, error.__traceback__)
            emit({"type": "error", "ename": type(error).__name__, "evalue": str(error), "traceback": frames})
            send({"id": current_id, "type": "done", "ok": False, "executionCount": None, "durationMs": 0, "assigned": []})


if __name__ == "__main__":
    main()
