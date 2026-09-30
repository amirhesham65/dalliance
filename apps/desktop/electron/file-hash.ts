import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { MAX_HASHED_BYTES } from '@dalliance/shared/notebook'

/** A data file's size and SHA-256 as `sha256:<hex>`, or its size and why it has no hash. */
export type Fingerprint = { size: number; hash: string } | { size: number; hash: null; note: string }

export const TOO_LARGE_NOTE = 'Not hashed: larger than 1 GB.'
export const UNREADABLE_NOTE = "Not hashed: the file couldn't be read."

interface Entry {
  size: number
  mtimeMs: number
  hash: Promise<string>
}

export interface FileHasherOptions {
  /** Files larger than this get a note instead of a hash. Defaults to MAX_HASHED_BYTES, 1 GB. */
  maxBytes?: number
  /** How many hashes the cache keeps. The oldest goes first. */
  maxEntries?: number
  /** Reads and hashes one file. Defaults to sha256File; tests count the reads. */
  hashFile?: (file: string) => Promise<string>
}

/** SHA-256 of a file, read in 1 MB chunks so the main process keeps answering while it works. */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file, { highWaterMark: 1 << 20 })
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(`sha256:${hash.digest('hex')}`))
  })
}

/**
 * Hashes the data files a notebook read, for its pins. One file at a time, and each hash is kept by path, size
 * and modification time, so saving again, or checking on open, only reads a file that changed.
 */
export class FileHasher {
  private cache = new Map<string, Entry>()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly maxBytes: number
  private readonly maxEntries: number
  private readonly hashFile: (file: string) => Promise<string>

  constructor(options: FileHasherOptions = {}) {
    this.maxBytes = options.maxBytes ?? MAX_HASHED_BYTES
    this.maxEntries = options.maxEntries ?? 2000
    this.hashFile = options.hashFile ?? sha256File
  }

  /** The file's fingerprint, or null when there is no file there. */
  async fingerprint(file: string): Promise<Fingerprint | null> {
    let info
    try {
      info = await stat(file)
    } catch {
      return null
    }
    if (!info.isFile()) return null
    const size = info.size
    if (size > this.maxBytes) return { size, hash: null, note: TOO_LARGE_NOTE }
    let entry = this.cache.get(file)
    if (!entry || entry.size !== size || entry.mtimeMs !== info.mtimeMs) {
      entry = { size, mtimeMs: info.mtimeMs, hash: this.enqueue(() => this.hashFile(file)) }
      this.remember(file, entry)
      const failed = entry
      // A failure isn't kept, so the next save tries again
      entry.hash.catch(() => {
        if (this.cache.get(file) === failed) this.cache.delete(file)
      })
    }
    try {
      return { size, hash: await entry.hash }
    } catch {
      return { size, hash: null, note: UNREADABLE_NOTE }
    }
  }

  /** Hash these files in the background, so a save soon after finds them ready. */
  warm(files: string[]) {
    for (const file of files) void this.fingerprint(file)
  }

  private enqueue(work: () => Promise<string>): Promise<string> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => {})
    return next
  }

  private remember(file: string, entry: Entry) {
    this.cache.delete(file)
    this.cache.set(file, entry)
    if (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value!)
  }
}
