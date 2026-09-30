import path from 'node:path'
import type { EnvironmentView, PinChange } from '@dalliance/shared/ipc'
import { MAX_PINNED } from '@dalliance/shared/ipynb'
import type { Notebook, PinnedFile, PinnedPackage, Pins, PromptCell } from '@dalliance/shared/notebook'
import type { Fingerprint } from './file-hash'
import type { KernelEnvironment } from './kernel/kernel'

/** A distribution name as pip compares them (PEP 503), so `Python_Dateutil` and `python-dateutil` match. */
export const packageKey = (name: string) => name.replace(/[-_.]+/g, '-').toLowerCase()

/**
 * The absolute path of a pinned file, or null when the path isn't a plain relative one inside `dir`. Pins come from
 * a file anyone could have edited, so `../` and absolute paths are never read.
 */
export function pinnedPath(dir: string, relative: string): string | null {
  if (!relative || path.isAbsolute(relative) || relative.includes('\0')) return null
  const full = path.resolve(dir, relative)
  return full.startsWith(path.join(dir, path.sep)) ? full : null
}

export interface PinInput {
  notebook: Notebook
  /** The folder the kernel runs in. The kernel reports paths relative to it. */
  dir: string
  /** What the kernel says its executes imported. Null when no kernel answered. */
  environment: KernelEnvironment | null
  /** The files each cell's last run in this kernel read, by cell id. A cell that hasn't run in it isn't there. */
  ran: ReadonlyMap<string, readonly string[]>
  fingerprint: (file: string) => Promise<Fingerprint | null>
}

const promptCells = (nb: Notebook) => nb.cells.filter((c): c is PromptCell => c.kind === 'prompt')

/**
 * The pins to save with the notebook: what the cells ran with. See docs/notebook-model.md#pins.
 *
 * The kernel only knows about the cells it ran. So once every cell with code has run in it, its imports and reads
 * replace what the notebook had. Until then, a cell that hasn't run keeps its part of the old pins: the files its
 * record says its code read, and every file and package the pins had that this kernel didn't touch, as they were.
 * Null when there is nothing to record.
 */
export async function pinNotebook({ notebook, dir, environment, ran, fingerprint }: PinInput): Promise<Pins | null> {
  const old = notebook.pins
  const cells = promptCells(notebook).filter((c) => c.code.trim())
  const ranHere = cells.filter((c) => ran.has(c.id))
  const allRan = ranHere.length === cells.length
  const kernelKnows = environment != null && ranHere.length > 0

  const python = kernelKnows ? environment.python : (old?.python ?? null)
  let packages: PinnedPackage[] = old?.packages ?? []
  if (kernelKnows) {
    const now = new Set(environment.packages.map((p) => packageKey(p.name)))
    const kept = allRan ? [] : packages.filter((p) => !now.has(packageKey(p.name)))
    packages = [...environment.packages, ...kept].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  }

  // Read in this kernel: hashed as they are now. The rest keep what the pins had
  const readHere = new Set(ranHere.flatMap((c) => ran.get(c.id) ?? []))
  const paths = new Set(readHere)
  if (!allRan) {
    for (const c of cells) if (!ran.has(c.id)) for (const f of c.provenance?.filesRead ?? []) if (f.by === 'code') paths.add(f.path)
    for (const f of old?.files ?? []) paths.add(f.path)
  }
  const previous = new Map((old?.files ?? []).map((f) => [f.path, f]))
  const files: PinnedFile[] = []
  for (const relative of [...paths].slice(0, MAX_PINNED)) {
    const kept = previous.get(relative)
    if (kept && !readHere.has(relative)) {
      files.push(kept)
      continue
    }
    const full = pinnedPath(dir, relative)
    const print = full ? await fingerprint(full) : null
    // A file that's gone since can't be pinned. A cell that reads it will fail anyway
    if (print) files.push({ path: relative, ...print })
  }

  if (python == null && !packages.length && !files.length) return null
  return { python, packages, files }
}

export interface CompareInput {
  dir: string
  /** The Python and its libraries now, from the interpreter. Null or with an error when it couldn't be read. */
  environment: EnvironmentView | null
  fingerprint: (file: string) => Promise<Fingerprint | null>
}

/**
 * What differs between the pins and the Python, its packages and the files now, in that order. The Python and
 * packages are left out when the interpreter couldn't be read, since the Python banner says why. A file too big
 * to hash is compared by size only.
 */
export async function comparePins(pins: Pins, { dir, environment, fingerprint }: CompareInput): Promise<PinChange[]> {
  const changes: PinChange[] = []
  if (environment?.version && pins.python && environment.version !== pins.python) changes.push({ kind: 'python', was: pins.python, now: environment.version })
  if (environment?.version && !environment.error) {
    const installed = new Map(environment.packages.map((p) => [packageKey(p.name), p.version]))
    for (const p of pins.packages) {
      const now = installed.get(packageKey(p.name)) ?? null
      if (now !== p.version) changes.push({ kind: 'package', name: p.name, was: p.version, now })
    }
  }
  for (const file of pins.files) {
    const full = pinnedPath(dir, file.path)
    if (!full) continue
    const now = await fingerprint(full)
    if (!now) changes.push({ kind: 'file', path: file.path, change: 'missing' })
    else if (now.size !== file.size) changes.push({ kind: 'file', path: file.path, change: 'size' })
    else if (file.hash != null && now.hash != null && now.hash !== file.hash) changes.push({ kind: 'file', path: file.path, change: 'contents' })
  }
  return changes
}
