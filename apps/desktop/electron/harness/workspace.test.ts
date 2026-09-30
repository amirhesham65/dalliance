// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BROAD_FOLDER_MESSAGE, MAX_READ_CHARS, isBroadFolder, listFiles, readFileBounded } from './workspace'

describe('workspace access', () => {
  it('treats home, Documents, Desktop and Downloads as too broad to list', async () => {
    for (const d of ['', 'Documents', 'Desktop', 'Downloads']) expect(isBroadFolder(path.join(homedir(), d))).toBe(true)
    expect(isBroadFolder(path.join(homedir(), 'Documents', 'Dalliance Notebooks'))).toBe(false)
    expect(isBroadFolder('/tmp/project')).toBe(false)
    expect(isBroadFolder('/Volumes')).toBe(true)
    expect(await listFiles(path.join(homedir(), 'Documents'))).toEqual([BROAD_FOLDER_MESSAGE])
  })

  it('refuses to read outside the notebook folder', async () => {
    expect(await readFileBounded('/tmp/project', '../etc/passwd')).toMatch(/^Refused/)
  })
})

describe('read_file bounds', () => {
  const folder = (name: string, text: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-read-'))
    writeFileSync(path.join(dir, name), text)
    return dir
  }

  it('caps the whole result, on a line boundary, and says where to carry on', async () => {
    // 500 lines of 500 characters would be about 250 KB
    const dir = folder('wide.csv', Array.from({ length: 500 }, (_, i) => `${i},${'x'.repeat(495)}`).join('\n'))
    const text = await readFileBounded(dir, 'wide.csv')
    const [body, note] = [text.slice(0, text.lastIndexOf('\n')), text.slice(text.lastIndexOf('\n') + 1)]
    expect(body.length).toBeLessThanOrEqual(MAX_READ_CHARS)
    expect(body.split('\n').every((line) => /^\d+: \d+,x+$/.test(line))).toBe(true)
    const shown = body.split('\n').length
    expect(note).toBe(`... (clipped at 20,000 characters, lines 1-${shown} of 500 shown. Read a range: offset ${shown + 1} and a smaller limit)`)
    expect(await readFileBounded(dir, 'wide.csv', shown + 1, 10)).toMatch(new RegExp(`^${shown + 1}: ${shown},`))
  })

  it('leaves a small file whole', async () => {
    const dir = folder('notes.txt', 'one\ntwo')
    expect(await readFileBounded(dir, 'notes.txt')).toBe('1: one\n2: two')
  })
})
