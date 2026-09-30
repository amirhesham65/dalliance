// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OpenQueue, notebookFromArgv } from './open-files'

describe('notebookFromArgv', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'dalliance-open-'))
  writeFileSync(path.join(folder, 'sales.ipynb'), '{}')
  writeFileSync(path.join(folder, 'Costs.IPYNB'), '{}')

  it('finds the last notebook that exists, relative to the working directory', () => {
    expect(notebookFromArgv(['/Applications/Dalliance', 'sales.ipynb'], folder)).toBe(path.join(folder, 'sales.ipynb'))
    expect(notebookFromArgv(['Dalliance', 'sales.ipynb', 'Costs.IPYNB'], folder)).toBe(path.join(folder, 'Costs.IPYNB'))
    expect(notebookFromArgv(['Dalliance', path.join(folder, 'sales.ipynb'), 'missing.ipynb'], '/')).toBe(path.join(folder, 'sales.ipynb'))
  })

  it('ignores switches, other files and a plain launch', () => {
    expect(notebookFromArgv(['Dalliance', '--inspect=x.ipynb', 'notes.txt'], folder)).toBeNull()
    expect(notebookFromArgv(['Dalliance'], folder)).toBeNull()
  })
})

describe('OpenQueue', () => {
  it('holds a file until the window can take it, then asks once', () => {
    const ask = vi.fn()
    const queue = new OpenQueue(ask)
    queue.request('/a.ipynb')
    expect(ask).not.toHaveBeenCalled()
    queue.setReady(true)
    queue.setReady(true)
    expect(ask).toHaveBeenCalledOnce()
    expect(queue.take()).toBe('/a.ipynb')
    expect(queue.take()).toBeNull()
  })

  it('lets a later request replace one already asked for, without a second Open', () => {
    const ask = vi.fn()
    const queue = new OpenQueue(ask)
    queue.setReady(true)
    queue.request('/a.ipynb')
    queue.request('/b.ipynb')
    expect(ask).toHaveBeenCalledOnce()
    expect(queue.take()).toBe('/b.ipynb')
    queue.request('/c.ipynb')
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('drops the file when the user keeps their changes', () => {
    const queue = new OpenQueue(() => {})
    queue.setReady(true)
    queue.request('/a.ipynb')
    queue.cancel()
    // An ordinary Open afterwards shows the dialog
    expect(queue.take()).toBeNull()
  })

  it('asks the page again after a reload', () => {
    const ask = vi.fn()
    const queue = new OpenQueue(ask)
    queue.setReady(true)
    queue.request('/a.ipynb')
    queue.setReady(false)
    queue.setReady(true)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(queue.take()).toBe('/a.ipynb')
  })
})
