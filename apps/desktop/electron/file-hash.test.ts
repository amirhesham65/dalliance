// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FileHasher, TOO_LARGE_NOTE, UNREADABLE_NOTE, sha256File } from './file-hash'

const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`

describe('FileHasher', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-hash-'))
  const file = (name: string, text: string) => {
    const full = path.join(dir, name)
    writeFileSync(full, text)
    return full
  }

  it("gives a file's size and SHA-256", async () => {
    const hasher = new FileHasher()
    expect(await hasher.fingerprint(file('visits.csv', 'id,age\n1,40\n'))).toEqual({ size: 12, hash: sha('id,age\n1,40\n') })
  })

  it('is null for a file that is missing, or a folder', async () => {
    mkdirSync(path.join(dir, 'folder'))
    const hasher = new FileHasher()
    expect(await hasher.fingerprint(path.join(dir, 'nothing.csv'))).toBeNull()
    expect(await hasher.fingerprint(path.join(dir, 'folder'))).toBeNull()
  })

  it('records a file over the limit by its size, with a note', async () => {
    const hasher = new FileHasher({ maxBytes: 4 })
    expect(await hasher.fingerprint(file('big.csv', '12345'))).toEqual({ size: 5, hash: null, note: TOO_LARGE_NOTE })
    expect(await hasher.fingerprint(file('small.csv', '1234'))).toEqual({ size: 4, hash: sha('1234') })
  })

  it('reads a file again only once its size or modification time changes', async () => {
    const hashFile = vi.fn(sha256File)
    const hasher = new FileHasher({ hashFile })
    const full = file('cached.csv', 'a\n')
    await hasher.fingerprint(full)
    await hasher.fingerprint(full)
    expect(hashFile).toHaveBeenCalledTimes(1)
    // The same size and an older mtime still count as a change
    writeFileSync(full, 'b\n')
    utimesSync(full, new Date(2020, 0, 1), new Date(2020, 0, 1))
    expect(await hasher.fingerprint(full)).toEqual({ size: 2, hash: sha('b\n') })
    expect(hashFile).toHaveBeenCalledTimes(2)
  })

  it('shares one read between callers asking at once, and warms the cache in the background', async () => {
    const hashFile = vi.fn(sha256File)
    const hasher = new FileHasher({ hashFile })
    const big = file('shared.csv', 'x'.repeat(5_000_000))
    const [a, b] = await Promise.all([hasher.fingerprint(big), hasher.fingerprint(big)])
    expect(a).toEqual(b)
    expect(a?.hash).toBe(sha('x'.repeat(5_000_000)))
    const warm = file('warm.csv', 'w\n')
    hasher.warm([warm])
    await vi.waitFor(() => expect(hashFile).toHaveBeenCalledTimes(2))
    await hasher.fingerprint(warm)
    expect(hashFile).toHaveBeenCalledTimes(2)
  })

  it("notes a file it couldn't read, and tries again next time", async () => {
    const hashFile = vi.fn(async () => {
      throw new Error('EACCES')
    })
    const hasher = new FileHasher({ hashFile })
    const full = file('locked.csv', 'l\n')
    expect(await hasher.fingerprint(full)).toEqual({ size: 2, hash: null, note: UNREADABLE_NOTE })
    await hasher.fingerprint(full)
    expect(hashFile).toHaveBeenCalledTimes(2)
  })
})
