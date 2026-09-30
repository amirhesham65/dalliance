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

When IPython is importable, cells run through its InteractiveShell (no ZeroMQ, no ipykernel), so
magics, top-level await and rich display work. Without it, or with DALLIANCE_KERNEL_NO_IPYTHON=1,
cells run through plain exec and eval.
"""

import ast
import base64
import builtins
import codecs
import contextlib
import importlib
import io
import json
import math
import os
import queue
import re
import signal
import subprocess
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
# IPython's InteractiveShell over the same namespace, or None to run cells with plain exec and eval.
# See start_ipython().
shell = None
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
        self.images_dropped = 0  # displayed PNGs past MAX_IMAGES; figures past it get their own note

    def notes(self):
        if self.stream_dropped:
            yield note(f"Output truncated: {self.stream_dropped:,} more characters.")
        if self.displays_dropped:
            yield note(f"{self.displays_dropped:,} more displayed values not shown (limit {MAX_DISPLAYS} per run).")
        if self.images_dropped:
            yield note(f"{self.images_dropped:,} more images not shown (limit {MAX_IMAGES} per run).")


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
    if is_matplotlib(value):
        return []  # figures are collected separately
    if shell is not None:
        return bundle_outputs(shell.display_formatter.format(value)[0])
    return [text_output(repr(value))]


def is_matplotlib(value):
    return (type(value).__module__ or "").startswith("matplotlib")


def text_output(text):
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT] + f"\n... (truncated, {len(text)} characters)"
    return {"type": "text", "text": text}


def show(value):
    """Emit a value's outputs, within the run's display budget."""
    emit_display(rich_outputs(value))


def emit_display(outputs):
    """Emit one displayed value's outputs, within the run's display and image budgets."""
    if not outputs:
        return
    if budget.displays >= MAX_DISPLAYS:
        budget.displays_dropped += 1
        return
    budget.displays += 1
    for output in outputs:
        if output["type"] == "image":
            if budget.images >= MAX_IMAGES:
                budget.images_dropped += 1
                continue
            budget.images += 1
        emit(output)


def error_output(error, own_frames=False):
    if shell is not None and not own_frames:
        return shell_error_output(error)
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


def display(*values, **options):
    """Show a value mid-cell, like IPython's display()."""
    if options:
        if shell is None:
            raise TypeError(f"display() got an unexpected keyword argument {next(iter(options))!r}")
        from IPython.display import display as ipython_display

        return ipython_display(*values, **options)
    for value in values:
        show(value)


namespace["display"] = display


# --- IPython -------------------------------------------------------------------------------

# A key in a display bundle that carries a value the kernel renders itself: a table or a figure.
OBJECT = "application/x-dalliance-object"

# Magics that run commands, open an editor or fetch URLs in ways the agent's code policy
# (harness/code-policy.ts) doesn't look for. It reads the code for !cmd, %pip, %%bash and a few
# more; these would slip past it, so they raise a UsageError instead. Automagic and the shell
# aliases (%ls, %rm) go too, since `pip install x` or `rm x` alone would run without a % or !.
UNCHECKED_LINE_MAGICS = ("alias", "unalias", "alias_magic", "rehashx", "automagic", "sc", "ed", "edit")
UNCHECKED_LINE_MAGICS += ("micromamba", "uv", "pastebin", "load", "loadpy", "pycat")
UNCHECKED_CELL_MAGICS = ("!", "perl", "ruby", "python", "python2", "python3", "pypy")
# The policy only sees these at the start of a line, so `x = %sx ls` and `x = !ls` are refused.
SHELL_LINE_MAGICS = ("system", "sx", "pip", "conda", "mamba")
REFUSED_ASSIGN = "Dalliance can't assign a shell command's output (x = !cmd). Run it on its own line, or use subprocess."
# Line magics that run their argument as a cell, so `%time !ls` would hide a command mid-line.
CODE_LINE_MAGICS = ("time", "timeit", "prun")
SHELL_CALL = re.compile(
    r"get_ipython\(\)\.(?:system|getoutput)\(|run_(?:line|cell)_magic\('(?:system|sx|pip|conda|mamba|sh|bash|script)'"
)
REFUSED_NESTED = "Dalliance can't run a shell command inside %time, %timeit or %prun. Put it on its own line."

# The repr an object gets when it defines none, like <__main__.Thing at 0x10f3> or <IPython.core.display.HTML object>
DEFAULT_REPR = re.compile(r"<[\w.]+(?: object(?: at 0x[0-9a-fA-F]+)?| at 0x[0-9a-fA-F]+)>")
MAX_HTML = 200_000  # characters of markup read for text

# Set per IPython run: the cell ends with ';', which hides its value, and whether it is a cell run.
cell_quiet = False
store_run = False
# Values the displayhook got, shown after the run's figures like the plain path does.
pending_values = []


def is_table(value):
    pd = sys.modules.get("pandas")
    return pd is not None and isinstance(value, (pd.DataFrame, pd.Series))


def bundle_outputs(data):
    """Outputs for an IPython display bundle: a PNG as an image, anything else as text."""
    if not isinstance(data, dict):
        return []
    if OBJECT in data:
        return rich_outputs(data[OBJECT])
    image = png_output(data.get("image/png"))
    if image is not None:
        return [image]
    text = data.get("text/plain")
    if not isinstance(text, str) or DEFAULT_REPR.fullmatch(text.strip()):
        # IPython.display.HTML, or an object with _repr_html_ and no __repr__: the markup's text reads better
        readable = data.get("text/markdown") or html_text(data.get("text/html"))
        if isinstance(readable, str) and readable.strip():
            text = readable
    return [text_output(text)] if isinstance(text, str) else []


def png_output(png):
    """An image output for PNG data from a display bundle, a note if it is too big, or None if it isn't a PNG."""
    try:
        data = png if isinstance(png, bytes) else base64.b64decode(png, validate=False) if isinstance(png, str) else b""
    except ValueError:
        return None
    if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) < 24:
        return None
    width, height = png_size(data)
    if max(width, height) > MAX_FIGURE_SIDE:
        return note(f"An image is {width:,} × {height:,} pixels, too big to show. Make it smaller.")
    return {"type": "image", "mime": "image/png", "data": base64.b64encode(data).decode("ascii")}


def html_text(markup):
    """The readable text of some HTML, without tags, scripts or styles."""
    if not isinstance(markup, str):
        return None
    from html.parser import HTMLParser

    parts = []

    class Text(HTMLParser):
        hidden = 0

        def handle_starttag(self, tag, attrs):
            if tag in ("script", "style"):
                self.hidden += 1
            elif tag in ("br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "pre"):
                parts.append("\n")
            elif tag in ("td", "th"):
                parts.append(" ")

        def handle_endtag(self, tag):
            if tag in ("script", "style"):
                self.hidden = max(0, self.hidden - 1)

        def handle_data(self, data):
            if not self.hidden:
                parts.append(data)

    parser = Text(convert_charrefs=True)
    parser.feed(markup[:MAX_HTML])
    parser.close()
    lines = (" ".join(line.split()) for line in "".join(parts).splitlines())
    return "\n".join(line for line in lines if line)


def ends_with_semicolon(code):
    """Whether a cell's last token is ';', which hides its value in IPython."""
    import tokenize

    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(code).readline))
    except (tokenize.TokenError, SyntaxError):
        return False
    skip = (tokenize.ENDMARKER, tokenize.NL, tokenize.NEWLINE, tokenize.COMMENT, tokenize.INDENT, tokenize.DEDENT)
    for token in reversed(tokens):
        if token.type not in skip:
            return token.type == tokenize.OP and token.string == ";"
    return False


STDLIB = os.path.dirname(os.path.abspath(os.__file__))
# Where a cell with top-level await waits. A Stop there leaves frames from these at the top of the traceback.
EVENT_LOOP = (os.path.join(STDLIB, "asyncio") + os.sep, os.path.join(STDLIB, "selectors.py"))


def user_frame(filename):
    return not filename.endswith("dalliance_kernel.py") and not filename.startswith(IPYTHON_DIR)


def trim_frames(exc, seen):
    """Drop the kernel's and IPython's frames from a TracebackException and the ones chained to it."""
    if exc is None or id(exc) in seen:
        return
    seen.add(id(exc))
    frames = [f for f in exc.stack if user_frame(f.filename)]
    while frames and frames[0].filename.startswith(EVENT_LOOP):
        frames.pop(0)
    exc.stack = traceback.StackSummary.from_list(frames)
    trim_frames(exc.__cause__, seen)
    trim_frames(exc.__context__, seen)
    for inner in getattr(exc, "exceptions", None) or ():
        trim_frames(inner, seen)


def shell_error_output(error):
    """error_output() for IPython runs: the traceback keeps the user's frames only."""
    if type(error).__name__ == "UsageError":  # a misused magic; the message is the whole story
        lines = [f"UsageError: {error}\n"]
    else:
        exc = traceback.TracebackException(type(error), error, error.__traceback__)
        trim_frames(exc, set())
        lines = list(exc.format())
    try:
        message = str(error)
    except Exception:  # IPython's %%bash raises a CalledProcessError that can't print itself after a Stop
        message = f"<{type(error).__name__} that couldn't be printed>"
    return {
        "type": "error",
        "ename": type(error).__name__,
        "evalue": clip(message, MAX_TEXT),
        "traceback": [clip(line, MAX_TEXT) for line in lines],
    }


def run_command(cmd, on_text):
    """
    Run a shell command for !cmd and %pip, with stdin on /dev/null, passing its output to
    on_text(name, text) as it comes. Stop stops the command and everything it started, then the cell.
    Returns the exit code, negative for a signal.
    """
    process = subprocess.Popen(
        cmd, shell=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True
    )
    chunks = queue.SimpleQueue()

    def pump(pipe, name):
        if hasattr(signal, "pthread_sigmask"):  # a Stop must reach the main thread
            signal.pthread_sigmask(signal.SIG_BLOCK, signal.valid_signals())
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        with pipe:
            for block in iter(lambda: pipe.read1(65536), b""):
                chunks.put((name, decoder.decode(block)))
        chunks.put((name, decoder.decode(b"", final=True)))
        chunks.put((name, None))

    for pipe, name in ((process.stdout, "stdout"), (process.stderr, "stderr")):
        threading.Thread(target=pump, args=(pipe, name), name="dalliance-command", daemon=True).start()
    try:
        open_pipes = 2
        while open_pipes:
            try:
                name, text = chunks.get(timeout=0.1)
            except queue.Empty:
                continue
            if text is None:
                open_pipes -= 1
            elif text:
                on_text(name, text)
        return process.wait()
    except BaseException:
        stop_command(process)
        raise


def stop_command(process):
    """SIGINT the command's process group, then SIGKILL it if it hasn't gone within a second."""
    global interruptible
    was, interruptible = interruptible, False  # a second Stop mustn't cut this short
    try:
        for sig in (signal.SIGINT, signal.SIGKILL):
            try:
                if hasattr(os, "killpg"):
                    os.killpg(process.pid, sig)
                else:
                    process.kill()
            except OSError:
                pass
            try:
                process.wait(timeout=1)
                break
            except subprocess.TimeoutExpired:
                pass
    finally:
        interruptible = was


def start_ipython():
    """
    An IPython InteractiveShell over the kernel's namespace, set up to send Dalliance outputs,
    or None when IPython is missing, not version 8 or 9, or turned off with DALLIANCE_KERNEL_NO_IPYTHON=1.
    """
    global IPYTHON_DIR
    if os.environ.get("DALLIANCE_KERNEL_NO_IPYTHON") == "1":
        return None
    saved_path = list(sys.path)
    try:
        import IPython

        # configure() patches IPython internals checked against 8 and 9. A later version may have moved them.
        if IPython.version_info[0] not in IPYTHON_MAJORS:
            return None
        from IPython.core.displayhook import DisplayHook
        from IPython.core.displaypub import DisplayPublisher
        from IPython.core.interactiveshell import InteractiveShell
        from traitlets.config import Config
    except Exception:
        return None
    IPYTHON_DIR = os.path.dirname(os.path.abspath(IPython.__file__)) + os.sep

    class Hook(DisplayHook):
        """Keeps _, __, ___, _N and Out for cell runs only, and holds the value until the figures are out."""

        def __call__(self, result=None):
            if result is None or cell_quiet:
                return
            if store_run:
                self.check_for_underscore()
                self.update_user_ns(result)
            self.fill_exec_result(result)
            pending_values.append(result)

    class Publisher(DisplayPublisher):
        """Sends display() and IPython.display output as Dalliance outputs instead of printing it."""

        def publish(self, data, metadata=None, source=None, *, transient=None, update=False, **kwargs):
            emit_display(bundle_outputs(data))

        def clear_output(self, wait=False):
            pass  # outputs are never taken back

    config = Config()
    config.HistoryManager.hist_file = ":memory:"  # In and Out live in memory; nothing goes to ~/.ipython
    config.InteractiveShell.automagic = False
    saved_main = sys.modules.get("__main__")
    try:
        ip = InteractiveShell.instance(config=config, user_ns=namespace, displayhook_class=Hook, display_pub_class=Publisher)
        configure(ip)
    except Exception:  # a version this doesn't fit: back to the plain path, without IPython's names
        for name in [*(getattr(InteractiveShell._instance, "user_ns_hidden", None) or ()), "_", "__", "___"]:
            namespace.pop(name, None)
        InteractiveShell.clear_instance()
        if saved_main is not None:
            sys.modules["__main__"] = saved_main
        return None
    finally:
        sys.path[:] = saved_path  # IPython may add a virtualenv's site-packages
    return ip


def configure(ip):
    """Fit a new InteractiveShell to the kernel. See docs/kernel.md."""
    from IPython.core.error import UsageError
    from IPython.core.inputtransformer2 import MagicAssign, SystemAssign
    from IPython.utils.text import LSString, SList

    def refuse_shell_assign(transformer, name_of):
        class Checked(transformer):
            @classmethod
            def find(cls, tokens_by_line):
                found = super().find(tokens_by_line)
                if found is not None and name_of(tokens_by_line, found) in SHELL_LINE_MAGICS:
                    raise UsageError(REFUSED_ASSIGN)
                return found

        return Checked

    def magic_name(tokens_by_line, found):
        for line in tokens_by_line:
            for token, following in zip(line, line[1:]):
                if token.start == (found.start_line + 1, found.start_col):
                    return following.string
        return None

    formatter = ip.display_formatter
    formatter.active_types = ["text/plain", "text/html", "text/markdown", "image/png"]
    format_bundle = formatter.format

    def format(obj, include=None, exclude=None):
        if is_table(obj) or is_matplotlib(obj):
            return {OBJECT: obj}, {}  # the kernel's own table and figure outputs
        return format_bundle(obj, include=include, exclude=exclude)

    formatter.format = format

    def showtraceback(exc_tuple=None, filename=None, tb_offset=None, exception_only=False, running_compiled_code=False):
        try:
            _, error, _ = ip._get_exc_info(exc_tuple)
        except ValueError:
            return
        emit(error_output(error))

    def showsyntaxerror(filename=None, running_compiled_code=False):
        _, error, _ = ip._get_exc_info()
        if filename and isinstance(error, SyntaxError):
            error.filename = filename
        emit(error_output(error))

    def system(cmd):
        if cmd.rstrip().endswith("&"):
            raise OSError("Background processes not supported.")
        cmd = ip.var_expand(cmd, depth=1)
        out, err = sys.stdout, sys.stderr
        code = run_command(cmd, lambda name, text: (out if name == "stdout" else err).write(text))
        ip.user_ns["_exit_code"] = code
        if getattr(ip, "system_raise_on_error", False) and code != 0:
            raise subprocess.CalledProcessError(code, cmd)

    def getoutput(cmd, split=True, depth=0):
        if cmd.rstrip().endswith("&"):
            raise OSError("Background processes not supported.")
        parts = []
        run_command(ip.var_expand(cmd, depth=depth + 1), lambda name, text: parts.append(text))
        text = "".join(parts)
        return SList(text.splitlines()) if split else LSString(text)

    ip.showtraceback = showtraceback
    ip.showsyntaxerror = showsyntaxerror
    ip.system = system
    ip.getoutput = getoutput
    # IPython 9 also keeps every print and a formatted copy of every error in its history. Nothing reads
    # them here, they grow without bound, and formatting an error that can't print itself raises again.
    if hasattr(ip, "_tee"):
        ip._tee = lambda channel: contextlib.nullcontext()
    if hasattr(ip, "_format_exception_for_storage"):
        ip._format_exception_for_storage = lambda *args, **kwargs: {}
    try:
        ip.colors = "nocolor"  # for %tb and the debugger
    except Exception:
        pass

    def matplotlib_magic(line=""):
        """Figures show on their own in Dalliance, so %matplotlib changes nothing."""

    def pylab_magic(line=""):
        raise UsageError("%pylab isn't available. Import numpy and matplotlib.pyplot instead; figures show on their own.")

    def refuse(kind, name):
        def refused(line="", cell=None):
            raise UsageError(f"{'%' if kind == 'line' else '%%'}{name} isn't available in Dalliance.")

        # IPython 9 loads magics on first use, and loading a class registers all of its magics, so load
        # the one that provides this magic before replacing it
        if hasattr(ip.magics_manager, "load_lazy"):
            ip.magics_manager.load_lazy(name)
        ip.register_magic_function(refused, kind, name)

    ip.alias_manager.clear_aliases()
    for name in UNCHECKED_LINE_MAGICS:
        refuse("line", name)
    for name in UNCHECKED_CELL_MAGICS:
        refuse("cell", name)
    ip.register_magic_function(matplotlib_magic, "line", "matplotlib")
    ip.register_magic_function(pylab_magic, "line", "pylab")
    transforms = ip.input_transformer_manager.token_transformers
    for i, transformer in enumerate(transforms):
        if transformer is MagicAssign:
            transforms[i] = refuse_shell_assign(MagicAssign, magic_name)
        elif transformer is SystemAssign:
            transforms[i] = refuse_shell_assign(SystemAssign, lambda tokens, found: SHELL_LINE_MAGICS[0])

    inside_line_magic = [0]  # how many of CODE_LINE_MAGICS are running now
    transform = ip.transform_cell

    def transform_cell(raw_cell):
        code = transform(raw_cell)
        if inside_line_magic[0] and SHELL_CALL.search(code):
            raise UsageError(REFUSED_NESTED)
        return code

    def guard(magic):
        def guarded(line="", *args, **kwargs):
            inside_line_magic[0] += 1
            try:
                return magic(line, *args, **kwargs)
            finally:
                inside_line_magic[0] -= 1

        guarded.__doc__ = magic.__doc__
        # IPython reads flags off the magic, such as needs_local_scope and whether ';' silences it
        guarded.__dict__.update(vars(getattr(magic, "__func__", magic)))
        return guarded

    ip.transform_cell = transform_cell
    for name in CODE_LINE_MAGICS:
        magic = ip.find_line_magic(name)
        if magic is not None:
            ip.magics_manager.magics["line"][name] = guard(magic)


IPYTHON_DIR = "\0"  # IPython's package folder, whose frames tracebacks leave out
# The IPython major versions cells run through. Keep in step with IPYTHON_SPEC in python-env.ts.
IPYTHON_MAJORS = (8, 9)


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
        if shell is not None:
            ok = run_shell(code, store)
        else:
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
        del pending_values[:]
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


def run_shell(code, store):
    """Run a cell through IPython. Errors are emitted as they happen. Returns whether it succeeded."""
    global cell_quiet, store_run
    # A cell run takes the next number; explore runs under it without advancing it, or In and Out
    shell.execution_count = execution_count if store else execution_count + 1
    store_run = store
    try:
        cell_quiet = ends_with_semicolon(shell.transform_cell(code))
    except Exception:
        cell_quiet = False  # run_cell reports the same error
    result = shell.run_cell(code, store_history=store)
    ok = result is not None and result.success
    if ok:
        collect_figures()
        for value in pending_values:
            show(value)
    elif "matplotlib.pyplot" in sys.modules:
        sys.modules["matplotlib.pyplot"].close("all")
    return ok


def listed(name, value):
    """Whether a namespace entry shows up in the variables list."""
    import types

    if not isinstance(name, str) or name.startswith("_") or name == "display":
        return False
    if shell is not None and name in shell.user_ns_hidden and shell.user_ns_hidden[name] is value:
        return False  # In, Out, get_ipython, exit and the like, until a cell rebinds them
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
    global current_id, shell
    signal.signal(signal.SIGINT, on_interrupt)
    WRITER.start()
    style_matplotlib()
    shell = start_ipython()
    ipython = sys.modules["IPython"].__version__ if shell is not None else None
    send({"id": None, "type": "ready", "python": sys.version.split()[0], "executable": sys.executable, "ipython": ipython})
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
