// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cleanNotebookName,
  folderForNewNotebook,
  newNotebookPath,
  notebookInProject,
  notebookPathIn,
  projectPathIn,
  renameNotebookFile,
} from './notebook-files'

describe('new notebook names', () => {
  it('takes Untitled first, then counts up past the names that are taken', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-'))
    expect(newNotebookPath(dir)).toBe(path.join(dir, 'Untitled.ipynb'))
    writeFileSync(path.join(dir, 'Untitled.ipynb'), '{}')
    expect(newNotebookPath(dir)).toBe(path.join(dir, 'Untitled 2.ipynb'))
    writeFileSync(path.join(dir, 'Untitled 2.ipynb'), '{}')
    expect(newNotebookPath(dir)).toBe(path.join(dir, 'Untitled 3.ipynb'))
  })
})

describe('the folder for a new notebook', () => {
  it('is the folder in use, unless that is a broad one like Documents, where the default folder takes over', () => {
    const fallback = path.join(homedir(), 'Documents', 'Dalliance Notebooks')
    const project = path.join(homedir(), 'Documents', 'trials')
    expect(folderForNewNotebook(project, fallback)).toBe(project)
    for (const broad of [homedir(), path.join(homedir(), 'Documents'), path.join(homedir(), 'Desktop'), path.join(homedir(), 'Downloads')]) {
      expect(folderForNewNotebook(broad, fallback)).toBe(fallback)
    }
  })
})

describe('notebook names', () => {
  it('drops .ipynb and spaces, and refuses what cannot be a file name', () => {
    expect(cleanNotebookName('  Trial readout.ipynb ')).toEqual({ name: 'Trial readout' })
    for (const bad of ['', '   ', '.ipynb', 'a/b', 'a\\b', 'what?', '.hidden', 'x'.repeat(101)]) {
      expect(cleanNotebookName(bad)).toHaveProperty('error')
    }
  })

  it('will not name a new notebook after one that is already there', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-'))
    expect(notebookPathIn(dir, 'Trials')).toEqual({ path: path.join(dir, 'Trials.ipynb') })
    writeFileSync(path.join(dir, 'Trials.ipynb'), '{}')
    expect(notebookPathIn(dir, 'Trials')).toHaveProperty('error')
  })

  it('renames the file within its folder, and says so when the name is taken', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-'))
    const file = path.join(dir, 'Untitled.ipynb')
    writeFileSync(file, '{}')
    writeFileSync(path.join(dir, 'Taken.ipynb'), '{}')

    expect(await renameNotebookFile(file, 'Taken')).toHaveProperty('error')
    expect(existsSync(file)).toBe(true)
    expect(await renameNotebookFile(file, 'Untitled')).toEqual({ path: file })

    expect(await renameNotebookFile(file, 'Survival')).toEqual({ path: path.join(dir, 'Survival.ipynb') })
    expect(existsSync(file)).toBe(false)
    expect(existsSync(path.join(dir, 'Survival.ipynb'))).toBe(true)
  })

  it('changes only the case of a name, even on a disk that ignores case', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-'))
    const file = path.join(dir, 'survival.ipynb')
    writeFileSync(file, '{}')
    writeFileSync(path.join(dir, 'Taken.ipynb'), '{}')

    expect(await renameNotebookFile(file, 'Survival')).toEqual({ path: path.join(dir, 'Survival.ipynb') })
    expect(readdirSync(dir).sort()).toEqual(['Survival.ipynb', 'Taken.ipynb'])
    // Where case doesn't count, another file that differs only in case is still taken
    if (existsSync(path.join(dir, 'taken.ipynb'))) {
      expect(await renameNotebookFile(path.join(dir, 'Survival.ipynb'), 'taken')).toHaveProperty('error')
      expect(readdirSync(dir).sort()).toEqual(['Survival.ipynb', 'Taken.ipynb'])
    }
  })

  it('reports a rename the disk refuses instead of throwing', async () => {
    expect(await renameNotebookFile('/no/such/folder/Untitled.ipynb', 'Other')).toHaveProperty('error')
  })
})

describe('new projects', () => {
  it('get a folder named as typed, trimmed, and refuse a bad name or one already there', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'dalliance-'))
    expect(projectPathIn(parent, '  Churn analysis ')).toEqual({ path: path.join(parent, 'Churn analysis'), name: 'Churn analysis' })
    expect(projectPathIn(parent, '   ')).toEqual({ error: 'Give the project a name.' })
    expect(projectPathIn(parent, 'a/b')).toHaveProperty('error')
    expect(projectPathIn(parent, '.hidden')).toHaveProperty('error')
    mkdirSync(path.join(parent, 'Churn'))
    expect(projectPathIn(parent, 'Churn')).toEqual({ error: 'There is already a folder called "Churn" there.' })
  })
})

describe('opening a project', () => {
  const at = (file: string, seconds: number) => {
    writeFileSync(file, '{}')
    utimesSync(file, seconds, seconds)
  }

  it('picks the notebook opened there last, ahead of the newest one', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-'))
    at(path.join(dir, 'old.ipynb'), 1_000)
    at(path.join(dir, 'new.ipynb'), 2_000)
    const recent = [{ path: path.join(tmpdir(), 'elsewhere.ipynb') }, { path: path.join(dir, 'old.ipynb') }]
    expect(await notebookInProject(dir, recent)).toBe(path.join(dir, 'old.ipynb'))
  })

  it('otherwise picks the newest notebook right in the folder, skipping other files, hidden ones and subfolders', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-'))
    at(path.join(dir, 'old.ipynb'), 1_000)
    at(path.join(dir, 'new.ipynb'), 2_000)
    at(path.join(dir, 'data.csv'), 3_000)
    at(path.join(dir, '.scratch.ipynb'), 3_000)
    mkdirSync(path.join(dir, 'sub'))
    at(path.join(dir, 'sub', 'deeper.ipynb'), 3_000)
    // A recent entry whose file has gone doesn't count
    expect(await notebookInProject(dir, [{ path: path.join(dir, 'gone.ipynb') }])).toBe(path.join(dir, 'new.ipynb'))
  })

  it('finds nothing in a folder without notebooks', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-'))
    at(path.join(dir, 'data.csv'), 1_000)
    expect(await notebookInProject(dir, [])).toBeNull()
  })
})
