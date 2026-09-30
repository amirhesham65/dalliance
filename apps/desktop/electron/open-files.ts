import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * The notebook named on a command line: the last argument ending in .ipynb that exists, resolved against `cwd`.
 * Covers a first launch with a file, and the argv a second launch hands over through 'second-instance'.
 */
export function notebookFromArgv(argv: string[], cwd: string): string | null {
  for (const arg of [...argv].reverse()) {
    if (arg.startsWith('-') || !/\.ipynb$/i.test(arg)) continue
    const file = path.resolve(cwd, arg)
    if (existsSync(file)) return file
  }
  return null
}

/**
 * Files the OS asked the app to open: a double-click in Finder, a drop on the Dock icon, or a second launch.
 * They go through the renderer's own Open, so unsaved changes get the same Discard prompt. The queue asks the
 * renderer once the window can take menu actions, and the renderer's `openNotebook()` then takes the file instead
 * of showing the Open dialog. The latest request wins.
 */
export class OpenQueue {
  private pending: string | null = null
  private ready = false
  /** Whether the renderer was already asked for the pending file, so a second request doesn't start a second Open. */
  private asked = false

  private readonly ask: () => void

  /** @param ask Tells the renderer to run its Open flow, which is the `open` menu action. */
  constructor(ask: () => void) {
    this.ask = ask
  }

  request(file: string) {
    this.pending = file
    this.flush()
  }

  /** The window's page can take menu actions (true), or is loading again or gone (false). */
  setReady(ready: boolean) {
    this.ready = ready
    // A reload drops the Open the renderer had started, so ask the new page again
    if (!ready) this.asked = false
    this.flush()
  }

  /** The file for the Open that is running now, if the OS asked for one. */
  take(): string | null {
    const file = this.pending
    this.pending = null
    this.asked = false
    return file
  }

  /** The user kept their unsaved changes instead. */
  cancel() {
    this.pending = null
    this.asked = false
  }

  private flush() {
    if (!this.ready || !this.pending || this.asked) return
    this.asked = true
    this.ask()
  }
}
