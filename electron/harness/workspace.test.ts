// @vitest-environment node
import { homedir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BROAD_FOLDER_MESSAGE, isBroadFolder, listFiles, readFileBounded } from './workspace'

describe('workspace access', () => {
  it('treats home, Documents, Desktop and Downloads as too broad to list', async () => {
    for (const d of ['', 'Documents', 'Desktop', 'Downloads']) expect(isBroadFolder(path.join(homedir(), d))).toBe(true)
    expect(isBroadFolder(path.join(homedir(), 'Documents', 'Ilios Notebooks'))).toBe(false)
    expect(isBroadFolder('/tmp/project')).toBe(false)
    expect(isBroadFolder('/Volumes')).toBe(true)
    expect(await listFiles(path.join(homedir(), 'Documents'))).toEqual([BROAD_FOLDER_MESSAGE])
  })

  it('refuses to read outside the notebook folder', async () => {
    expect(await readFileBounded('/tmp/project', '../etc/passwd')).toMatch(/^Refused/)
  })
})
