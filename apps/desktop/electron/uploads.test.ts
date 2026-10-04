// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyIntoUploads, freeName } from './uploads'

const temp = () => mkdtempSync(path.join(tmpdir(), 'dalliance-'))

describe('attaching files', () => {
  it('copies a file into uploads and gives its path inside the project', async () => {
    const [project, desktop] = [temp(), temp()]
    writeFileSync(path.join(desktop, 'visits.csv'), 'id,day\n1,mon\n')
    const result = await copyIntoUploads(project, [path.join(desktop, 'visits.csv')])
    expect(result).toEqual({ paths: ['uploads/visits.csv'], error: null })
    expect(readFileSync(path.join(project, 'uploads', 'visits.csv'), 'utf-8')).toBe('id,day\n1,mon\n')
  })

  it('never overwrites: a second file with the same name gets the next free one', async () => {
    const [project, a, b] = [temp(), temp(), temp()]
    writeFileSync(path.join(a, 'visits.csv'), 'first')
    writeFileSync(path.join(b, 'visits.csv'), 'second')
    await copyIntoUploads(project, [path.join(a, 'visits.csv')])
    const result = await copyIntoUploads(project, [path.join(b, 'visits.csv')])
    expect(result.paths).toEqual(['uploads/visits 2.csv'])
    expect(readFileSync(path.join(project, 'uploads', 'visits.csv'), 'utf-8')).toBe('first')
  })

  it('uses a file already in the project where it is, without a copy', async () => {
    const project = temp()
    mkdirSync(path.join(project, 'data'))
    writeFileSync(path.join(project, 'data', 'labs.csv'), 'x')
    expect(await copyIntoUploads(project, [path.join(project, 'data', 'labs.csv')])).toEqual({ paths: ['data/labs.csv'], error: null })
  })

  it('attaches what it can and names what it could not: folders, missing files and relative paths', async () => {
    const [project, desktop] = [temp(), temp()]
    writeFileSync(path.join(desktop, 'ok.csv'), 'x')
    mkdirSync(path.join(desktop, 'scans'))
    const result = await copyIntoUploads(project, [path.join(desktop, 'ok.csv'), path.join(desktop, 'scans'), path.join(desktop, 'gone.csv'), 'rel.csv'])
    expect(result.paths).toEqual(['uploads/ok.csv'])
    expect(result.error).toContain("Couldn't attach scans: only files can be attached, not folders.")
    expect(result.error).toContain("Couldn't attach gone.csv: it has gone.")
    expect(result.error).toContain("Couldn't attach rel.csv: not a file on this computer.")
  })
})

describe('free names', () => {
  it('counts up before the extension', () => {
    const dir = temp()
    expect(freeName(dir, 'scan.tar.gz')).toBe('scan.tar.gz')
    writeFileSync(path.join(dir, 'scan.tar.gz'), '')
    expect(freeName(dir, 'scan.tar.gz')).toBe('scan.tar 2.gz')
    writeFileSync(path.join(dir, 'README'), '')
    expect(freeName(dir, 'README')).toBe('README 2')
  })
})
