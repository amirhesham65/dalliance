import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PackageView } from '@dalliance/shared/ipc'

const run = promisify(execFile)

/** One line of JSON: every installed distribution, once, by name. importlib.metadata needs no pip. */
const SCRIPT = `import json, importlib.metadata as m
seen = {}
for d in m.distributions():
    name = d.metadata["Name"]
    if name and name.lower() not in seen:
        seen[name.lower()] = {"name": name, "version": d.version}
print(json.dumps(sorted(seen.values(), key=lambda p: p["name"].lower())))`

export interface ListOptions {
  /**
   * The folder the listing runs in. `python -c` puts it first on sys.path, so a stray `json.py` there would
   * shadow the standard library. Pass a folder the app owns, never the process's own working directory.
   */
  cwd: string
  timeoutMs?: number
}

/** The libraries the given Python has, with versions, for the environment view. Throws with a message the pane can show. */
export async function installedPackages(python: string, { cwd, timeoutMs = 20_000 }: ListOptions): Promise<PackageView[]> {
  let stdout: string
  try {
    ;({ stdout } = await run(python, ['-c', SCRIPT], { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }))
  } catch (err) {
    throw new Error(listingFailure(err, python, timeoutMs))
  }
  // A library that prints while it loads can put lines before ours, so take the last one
  const line = stdout.trim().split('\n').pop() ?? '[]'
  let packages: PackageView[]
  try {
    packages = JSON.parse(line) as PackageView[]
  } catch {
    throw new Error(`${python} answered with something that isn't a list of libraries.`)
  }
  if (!Array.isArray(packages)) throw new Error(`${python} answered with something that isn't a list of libraries.`)
  return packages.map(({ name, version }) => ({ name, version: version ?? '' }))
}

/**
 * Why the listing failed, in words. execFile's own message starts "Command failed: <python> -c <the script>",
 * which says nothing, so this looks at how it failed and at what Python wrote to stderr.
 */
export function listingFailure(err: unknown, python: string, timeoutMs: number): string {
  const e = (err ?? {}) as { code?: unknown; killed?: boolean; signal?: string | null; stderr?: unknown; message?: unknown }
  if (e.code === 'ENOENT') return `There's no Python at ${python}.`
  if (e.code === 'EACCES') return `${python} can't be run. Check that it's a Python and that it's executable.`
  if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'The list of libraries was too long to read.'
  // execFile sets killed when it stops the process itself, which it only does at the timeout
  if (e.killed) return `${python} took longer than ${+(timeoutMs / 1000).toFixed(1)} seconds to list its libraries.`
  if (e.signal) return `${python} stopped with ${e.signal} while listing its libraries.`
  const stderr = typeof e.stderr === 'string' ? e.stderr : ''
  // The last line of a traceback is the error itself, like "ModuleNotFoundError: No module named 'importlib.metadata'"
  const last = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
  if (last) return last.length > 300 ? `${last.slice(0, 300)}…` : last
  if (typeof e.code === 'number') return `${python} exited with code ${e.code}.`
  const message = typeof e.message === 'string' ? e.message.split('\n')[0] : ''
  return message && !message.startsWith('Command failed') ? message : `Couldn't run ${python}.`
}
