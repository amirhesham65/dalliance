// @vitest-environment node
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeFileAtomic, writeFileAtomicSync } from './atomic-write'

const dir = () => mkdtempSync(path.join(tmpdir(), 'dalliance-atomic-'))
const posix = process.platform !== 'win32'

describe.each([
  ['writeFileAtomicSync', async (file: string, data: string, mode?: number) => writeFileAtomicSync(file, data, { mode })],
  ['writeFileAtomic', (file: string, data: string, mode?: number) => writeFileAtomic(file, data, { mode })],
])('%s', (_name, write) => {
  it('creates a new file and leaves no temporary file behind', async () => {
    const folder = dir()
    const file = path.join(folder, 'sales.ipynb')
    await write(file, '{"cells": []}\n')
    expect(readFileSync(file, 'utf-8')).toBe('{"cells": []}\n')
    expect(readdirSync(folder)).toEqual(['sales.ipynb'])
  })

  it('replaces an existing file', async () => {
    const folder = dir()
    const file = path.join(folder, 'settings.json')
    writeFileSync(file, 'a much longer old version of the file')
    await write(file, 'new')
    expect(readFileSync(file, 'utf-8')).toBe('new')
    expect(readdirSync(folder)).toEqual(['settings.json'])
  })

  it.skipIf(!posix)('sets the mode it is given', async () => {
    const file = path.join(dir(), 'settings.json')
    await write(file, '{}', 0o600)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it.skipIf(!posix)('keeps the mode of the file it replaces', async () => {
    const file = path.join(dir(), 'sales.ipynb')
    writeFileSync(file, 'old')
    chmodSync(file, 0o640)
    await write(file, 'new')
    expect(statSync(file).mode & 0o777).toBe(0o640)
  })

  it.skipIf(!posix)('writes through a symlink to the file it points at', async () => {
    const folder = dir()
    const real = path.join(folder, 'real.ipynb')
    const link = path.join(folder, 'link.ipynb')
    writeFileSync(real, 'old')
    symlinkSync(real, link)
    await write(link, 'new')
    expect(readFileSync(real, 'utf-8')).toBe('new')
    expect(readFileSync(link, 'utf-8')).toBe('new')
  })

  it('throws and leaves nothing behind when the folder is missing', async () => {
    const folder = dir()
    const file = path.join(folder, 'missing-folder', 'sales.ipynb')
    await expect(write(file, 'new')).rejects.toThrow()
    expect(readdirSync(folder)).toEqual([])
  })

  it('removes its temporary file when the rename fails', async () => {
    const folder = dir()
    // A folder where the file should be: the temporary file is written, the rename is refused
    const target = path.join(folder, 'taken')
    writeFileSync(path.join(folder, 'keep.txt'), 'keep')
    mkdirSync(path.join(target, 'inside'), { recursive: true })
    await expect(write(target, 'new')).rejects.toThrow()
    expect(readdirSync(folder).sort()).toEqual(['keep.txt', 'taken'])
  })
})
