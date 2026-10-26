// @vitest-environment node
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { listFiles } from './harness/workspace'
import { listDirectory } from './workspace-files'

async function folder() {
  const root = await mkdtemp(path.join(tmpdir(), 'dalliance-files-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

describe('Files pane directory listings', () => {
  it('returns every entry beyond 200 while the agent listing stays bounded', async () => {
    const root = await folder()
    await Promise.all(Array.from({ length: 350 }, (_, index) => writeFile(path.join(root, `data-${index}.csv`), 'x')))
    const entries = await listDirectory(root)
    expect(entries).toHaveLength(350)
    expect(entries.every((entry) => entry.kind === 'file' && entry.size === '1 B')).toBe(true)
    expect(entries.find((entry) => entry.path === 'data-349.csv')).toBeDefined()
    expect((await listFiles(root)).at(-1)).toBe('... (stopped at 200 files)')
  })

  it('lists folders without traversing them, including empty folders and paths deeper than four levels', async () => {
    const root = await folder()
    const deep = 'data/a/b/c/d/e/f'
    await mkdir(path.join(root, deep), { recursive: true })
    await mkdir(path.join(root, 'empty'))
    await mkdir(path.join(root, '.hidden'))
    await mkdir(path.join(root, 'node_modules'))
    await writeFile(path.join(root, deep, 'results (copy).csv'), '1,2')
    expect(await listDirectory(root)).toEqual([
      { path: 'data', kind: 'directory', size: '' },
      { path: 'empty', kind: 'directory', size: '' },
    ])
    expect(await listDirectory(root, 'empty')).toEqual([])
    expect(await listDirectory(root, deep)).toEqual([{ path: `${deep}/results (copy).csv`, kind: 'file', size: '3 B' }])
  })

  it('refuses traversal and symlink escapes and never lists a broad folder', async () => {
    const root = await folder()
    const outside = await folder()
    await symlink(outside, path.join(root, 'escape'), 'dir')
    for (const directory of ['..', '../outside', outside, null, 1, {}]) {
      await expect(listDirectory(root, directory)).rejects.toThrow('inside the workspace')
    }
    await expect(listDirectory(root, 'escape')).rejects.toThrow('inside the workspace')
    expect(await listDirectory(root)).toEqual([])
    expect(await listDirectory(homedir())).toEqual([])
  })
})
