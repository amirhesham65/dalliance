import { randomBytes } from 'node:crypto'
import { closeSync, fchmodSync, fsyncSync, openSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { open, realpath, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

export interface AtomicWriteOptions {
  /** File mode for the result. Without one, an existing file keeps its mode and a new file gets the default. */
  mode?: number
}

/**
 * Write a file so that a crash or a full disk leaves either the old contents or the new, never half of each.
 * The data goes to a temporary file in the same folder, is flushed to disk, then renamed over the target.
 */
export function writeFileAtomicSync(file: string, data: string | Uint8Array, options: AtomicWriteOptions = {}) {
  const target = resolveSync(file)
  const mode = options.mode ?? modeSync(target)
  const tmp = tempPath(target)
  let fd: number | null = null
  try {
    fd = openSync(tmp, 'wx', mode ?? 0o666)
    if (mode !== undefined) fchmodSync(fd, mode)
    writeFileSync(fd, data)
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(tmp, target)
  } catch (err) {
    if (fd !== null) closeQuietly(fd)
    try {
      unlinkSync(tmp)
    } catch {
      // Already renamed or never created
    }
    throw err
  }
  syncDirSync(path.dirname(target))
}

/** The async form of `writeFileAtomicSync`, for callers on the main process's event loop. */
export async function writeFileAtomic(file: string, data: string | Uint8Array, options: AtomicWriteOptions = {}) {
  const target = await realpath(file).catch(() => file)
  const mode = options.mode ?? (await stat(target).then((s) => s.mode & 0o7777, () => undefined))
  const tmp = tempPath(target)
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(tmp, 'wx', mode ?? 0o666)
    if (mode !== undefined) await handle.chmod(mode)
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = null
    await rename(tmp, target)
  } catch (err) {
    await handle?.close().catch(() => {})
    await unlink(tmp).catch(() => {})
    throw err
  }
  syncDirSync(path.dirname(target))
}

function tempPath(target: string) {
  return path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
}

/** Follow a symlink, so saving through a link updates the file it points to instead of replacing the link. */
function resolveSync(file: string) {
  try {
    return realpathSync(file)
  } catch {
    return file
  }
}

function modeSync(file: string): number | undefined {
  try {
    return statSync(file).mode & 0o7777
  } catch {
    return undefined
  }
}

function closeQuietly(fd: number) {
  try {
    closeSync(fd)
  } catch {
    // Nothing left to do with it
  }
}

/** Flush the rename itself. Best effort: Windows can't open a folder for this. */
function syncDirSync(dir: string) {
  let fd: number | null = null
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch {
    // The file is already in place; this only narrows the window after a power cut
  } finally {
    if (fd !== null) closeQuietly(fd)
  }
}
