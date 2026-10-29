"""Managed Streamlit startup, script execution signals and parent-death cleanup."""
import json
import os
import signal
import sys
import threading
import time
import uuid

SOURCE, ENTRY, OPTIONS = sys.argv[1:4]
with open(OPTIONS, encoding="utf-8") as handle:
    flags = json.load(handle)
_writer = os.fdopen(os.dup(3), "w", buffering=1, encoding="utf-8")
_lock = threading.Lock()
_active = set()
_runner_handlers = {}
_observable = True


def publish(message):
    try:
        with _lock:
            _writer.write(json.dumps(message, allow_nan=False) + "\n")
    except (OSError, ValueError):
        pass


def watch_parent():
    # This pipe closes when Dalliance exits, even after a crash. No persisted or reusable parent PID.
    for _ in sys.stdin:
        pass
    if os.name == "nt":
        import subprocess
        subprocess.run(["taskkill", "/PID", str(os.getpid()), "/T", "/F"], capture_output=True)
    else:
        os.killpg(os.getpgrp(), signal.SIGKILL)
    os._exit(0)


def telemetry():
    import psutil
    process = psutil.Process()
    while True:
        memory = 0
        cpu = process.cpu_percent()
        for item in [process] + process.children(recursive=True):
            try:
                memory += item.memory_info().rss
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        publish({"type": "runtime", "busy": bool(_active) if _observable else None, "memoryMb": round(memory / 1048576, 1), "cpuPercent": cpu})
        time.sleep(2)


def track_script_runner():
    # Streamlit 1.66 runner events cover full runs and fragment reruns. If this hook changes,
    # report unknown busy state so Dalliance never auto-stops work it cannot observe.
    try:
        from streamlit.runtime import get_instance
        from streamlit.runtime.scriptrunner import get_script_run_ctx
        info = get_instance()._session_mgr.get_session_info(get_script_run_ctx().session_id)
        runner = info.session._scriptrunner
        key = str(id(runner))
        if key not in _runner_handlers:
            def changed(sender, event, **kwargs):
                name = event.name
                if name == 'SCRIPT_STARTED':
                    _active.add(key)
                elif name.startswith('SCRIPT_STOPPED') or name in ('FRAGMENT_STOPPED_WITH_SUCCESS', 'SHUTDOWN'):
                    _active.discard(key)
                if name == 'SHUTDOWN':
                    _runner_handlers.pop(key, None)
                    runner.on_event.disconnect(changed)
                publish({'type': 'runtime', 'busy': bool(_active) if _observable else None})
            runner.on_event.connect(changed, weak=False)
            _runner_handlers[key] = changed
        _active.add(key)
        return True
    except Exception:
        global _observable
        _observable = False
        publish({'type': 'unknown'})
        return False


def run_app():
    import streamlit as st
    tracked = track_script_runner()
    token = uuid.uuid4().hex
    _active.add(token)
    publish({"type": "runtime", "busy": True})
    try:
        st.set_page_config(layout="wide")
        namespace = vars(sys.modules["__main__"])
        namespace.update({"__name__": "__main__", "__file__": SOURCE, "__package__": None})
        with open(SOURCE, encoding="utf-8") as handle:
            exec(compile(handle.read(), SOURCE, "exec"), namespace)
    finally:
        _active.discard(token)
        publish({"type": "runtime", "busy": bool(_active) if tracked else None})


if __name__ == "__main__":
    sys.modules['_dalliance_runtime'] = sys.modules[__name__]
    sys.path.insert(0, os.path.dirname(SOURCE))
    threading.Thread(target=watch_parent, daemon=True).start()
    threading.Thread(target=telemetry, daemon=True).start()
    from streamlit.web import bootstrap
    bootstrap.load_config_options(flags)
    bootstrap.run(ENTRY, False, [], flags)
