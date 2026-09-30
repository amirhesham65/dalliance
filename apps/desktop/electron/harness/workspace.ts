import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.ipynb_checkpoints', '.DS_Store'])
const MAX_LINES = 500
const MAX_LINE_CHARS = 500
/** 500 full lines would be 250 KB, so the whole result has a cap too. */
export const MAX_READ_CHARS = 20_000

/**
 * Folders too general to hand to the agent: listing them would expose unrelated personal files.
 * A notebook saved in one of these gets no file listing until it moves to a project folder.
 */
export function isBroadFolder(dir: string): boolean {
  const home = homedir()
  const broad = [home, '/', ...['Documents', 'Desktop', 'Downloads', 'Library', 'Library/Mobile Documents/com~apple~CloudDocs'].map((d) => path.join(home, d))]
  const resolved = path.resolve(dir)
  return broad.some((b) => path.resolve(b) === resolved) || path.relative(home, resolved).startsWith('..') && resolved.split(path.sep).length <= 2
}

export const BROAD_FOLDER_MESSAGE =
  "The notebook is in a general folder (like Documents or your home folder), so its files aren't listed. Ask the user for the file's name or path, or suggest saving the notebook into the folder with their data."

/** Resolve a path inside the notebook's folder. Returns null for anything outside it. */
export function resolveInside(root: string, relative: string): string | null {
  const abs = path.resolve(root, relative)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return abs
}

export async function listFiles(root: string, max = 200): Promise<string[]> {
  if (isBroadFolder(root)) return [BROAD_FOLDER_MESSAGE]
  const found: string[] = []
  async function walk(dir: string, depth: number) {
    if (found.length >= max || depth > 4) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (found.length >= max) return
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) await walk(abs, depth + 1)
      else {
        const size = (await stat(abs).catch(() => null))?.size ?? 0
        found.push(`${path.relative(root, abs)} (${formatBytes(size)})`)
      }
    }
  }
  await walk(root, 0)
  if (found.length >= max) found.push(`... (stopped at ${max} files)`)
  return found
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Numbered lines with a 500-line cap, as in the course's read tool, and 20,000 characters in all. */
export async function readFileBounded(root: string, relative: string, offset = 1, limit = MAX_LINES): Promise<string> {
  const abs = resolveInside(root, relative)
  if (!abs) return `Refused: ${relative} is outside the notebook's folder.`
  if (!existsSync(abs)) return `Not found: ${relative}. Use list_files to see what exists.`
  const info = await stat(abs)
  if (info.isDirectory()) return `${relative} is a folder. Use list_files instead.`
  const buf = await readFile(abs)
  if (buf.subarray(0, 8000).includes(0)) return `${relative} is a binary file (${info.size} bytes). Load it with Python instead.`
  const all = buf.toString('utf-8').split('\n')
  const total = all.length
  const lines = all.slice(Math.max(0, offset - 1), Math.max(0, offset - 1) + Math.min(limit, MAX_LINES))
  const numbered: string[] = []
  let size = 0
  for (const [i, l] of lines.entries()) {
    const line = `${offset + i}: ${l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)}…` : l}`
    // Stop on a whole line, so the model can carry on from the next one
    if (numbered.length && size + line.length + 1 > MAX_READ_CHARS) break
    numbered.push(line)
    size += line.length + 1
  }
  const end = offset + numbered.length - 1
  if (numbered.length < lines.length) {
    return `${numbered.join('\n')}\n... (clipped at ${MAX_READ_CHARS.toLocaleString('en-US')} characters, lines ${offset}-${end} of ${total} shown. Read a range: offset ${end + 1} and a smaller limit)`
  }
  return end < total ? `${numbered.join('\n')}\n... (lines ${offset}-${end} of ${total})` : numbered.join('\n')
}
