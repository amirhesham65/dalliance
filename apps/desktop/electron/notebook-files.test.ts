// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { newNotebookPath } from './notebook-files'

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
