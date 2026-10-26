import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FileEntry } from '@dalliance/shared/ipc'
import { isBroadFolder, isWorkspaceEntry, resolveInside } from './harness/workspace'

/** The Files pane reads one folder at a time. The agent keeps its separate, bounded listing. */
export async function listDirectory(root: string, directory: unknown = '.'): Promise<FileEntry[]> {
  if (isBroadFolder(root)) return []
  if (typeof directory !== 'string' || path.isAbsolute(directory)) throw new Error('Choose a folder inside the workspace.')
  const target = resolveInside(root, directory)
  if (!target) throw new Error('Choose a folder inside the workspace.')
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)])
  if (isBroadFolder(realRoot)) return []
  if (!resolveInside(realRoot, path.relative(realRoot, realTarget))) throw new Error('Choose a folder inside the workspace.')
  const entries = (await readdir(realTarget, { withFileTypes: true }))
    .filter((entry) => isWorkspaceEntry(entry.name) && (entry.isDirectory() || entry.isFile()))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  const result: FileEntry[] = []
  // Bound concurrent stats rather than the number of entries the user can browse.
  for (let offset = 0; offset < entries.length; offset += 32) {
    const batch = await Promise.all(entries.slice(offset, offset + 32).map(async (entry): Promise<FileEntry> => {
      const relative = path.join(directory, entry.name).split(path.sep).join('/')
      if (entry.isDirectory()) return { path: relative, kind: 'directory', size: '' }
      const info = await stat(path.join(realTarget, entry.name)).catch(() => null)
      return { path: relative, kind: 'file', size: info ? formatBytes(info.size) : '' }
    }))
    result.push(...batch)
  }
  return result
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
