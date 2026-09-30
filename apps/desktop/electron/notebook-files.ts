import { existsSync, statSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import path from 'node:path'

/** A name for a new notebook in `dir` that nothing has: "Untitled.ipynb", then "Untitled 2.ipynb", "Untitled 3.ipynb". */
export function newNotebookPath(dir: string, name = 'Untitled'): string {
  let file = path.join(dir, `${name}.ipynb`)
  for (let n = 2; existsSync(file); n++) file = path.join(dir, `${name} ${n}.ipynb`)
  return file
}

const RESERVED = /[\\/:*?"<>|]/
const MAX_NAME = 100

/** A name someone typed for a notebook, as a file name: no ".ipynb", no path characters, not empty. */
export function cleanNotebookName(raw: string): { name: string } | { error: string } {
  const name = raw.trim().replace(/\.ipynb$/i, '').trim()
  if (!name) return { error: 'Give the notebook a name.' }
  if (RESERVED.test(name) || [...name].some((c) => c.charCodeAt(0) < 32)) return { error: 'A name can\'t hold / \\ : * ? " < > |.' }
  if (name.startsWith('.')) return { error: "A name can't start with a dot." }
  if (name.length > MAX_NAME) return { error: `A name can be up to ${MAX_NAME} characters.` }
  return { name }
}

/** The path a notebook called `raw` would have in `dir`, or why it can't: a bad name, or one already taken. */
export function notebookPathIn(dir: string, raw: string): { path: string } | { error: string } {
  const cleaned = cleanNotebookName(raw)
  if ('error' in cleaned) return cleaned
  const file = path.join(dir, `${cleaned.name}.ipynb`)
  return existsSync(file) ? { error: `There is already a notebook called "${cleaned.name}" in this folder.` } : { path: file }
}

/** Rename a notebook file within its folder. Naming it what it already is changes nothing. */
export async function renameNotebookFile(file: string, raw: string): Promise<{ path: string } | { error: string }> {
  const cleaned = cleanNotebookName(raw)
  if ('error' in cleaned) return cleaned
  const target = path.join(path.dirname(file), `${cleaned.name}.ipynb`)
  if (target === file) return { path: file }
  // On a disk that ignores case, like the Mac's, "Foo" is found where "foo" is, but it's the same file, not a clash
  if (!sameFile(file, target)) {
    const free = notebookPathIn(path.dirname(file), cleaned.name)
    if ('error' in free) return free
  }
  try {
    await rename(file, target)
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] : String(err)
    return { error: `Couldn't rename the notebook: ${reason}` }
  }
  return { path: target }
}

function sameFile(a: string, b: string): boolean {
  try {
    const [x, y] = [statSync(a), statSync(b)]
    return x.dev === y.dev && x.ino === y.ino
  } catch {
    return false
  }
}
