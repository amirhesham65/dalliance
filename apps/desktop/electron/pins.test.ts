// @vitest-environment node
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EnvironmentView } from '@dalliance/shared/ipc'
import { type Notebook, type Pins, type PromptCell, newNoteCell, newPromptCell } from '@dalliance/shared/notebook'
import type { Fingerprint } from './file-hash'
import { comparePins, packageKey, pinNotebook, pinnedPath } from './pins'

const DIR = path.resolve('/work/trial')

/** Fingerprints by path relative to DIR. A path not listed has no file. */
const disk = (files: Record<string, Fingerprint>) => {
  const read: string[] = []
  const fingerprint = async (file: string) => {
    const relative = path.relative(DIR, file).split(path.sep).join('/')
    read.push(relative)
    return files[relative] ?? null
  }
  return { fingerprint, read }
}

const cell = (id: string, code: string, extra: Partial<PromptCell> = {}): PromptCell => ({ ...newPromptCell('', code), id, ...extra })
const byCode = (...paths: string[]): Partial<PromptCell> => ({
  provenance: {
    prompt: '',
    corrections: [],
    madeAt: '2026-09-30T12:00:00.000Z',
    model: null,
    effort: null,
    steps: [],
    rationale: { from: 'none', text: [] },
    attemptCount: 1,
    attempts: [],
    filesRead: [...paths.map((p) => ({ path: p, by: 'code' as const })), { path: 'README.md', by: 'agent' as const }],
    filesReadTruncated: false,
    approvals: [],
    codeHash: '',
    outputsHash: '',
  },
})

const OLD: Pins = {
  python: '3.11.9',
  packages: [
    { name: 'numpy', version: '1.26.4' },
    { name: 'scipy', version: '1.13.0' },
  ],
  files: [
    { path: 'visits.csv', size: 10, hash: 'sha256:old-visits' },
    { path: 'labs.csv', size: 20, hash: 'sha256:old-labs' },
  ],
}

const kernel = { python: '3.12.4', packages: [{ name: 'pandas', version: '2.2.3' }, { name: 'numpy', version: '2.1.3' }] }

describe('pinNotebook', () => {
  it('records the kernel and what every cell read once all of them ran in it', async () => {
    const { fingerprint } = disk({ 'visits.csv': { size: 11, hash: 'sha256:visits' }, 'data/labs.csv': { size: 5, hash: 'sha256:labs' } })
    const notebook: Notebook = { cells: [newNoteCell('# Trial'), cell('a', 'load()'), cell('b', 'labs()')], pins: OLD }
    const ran = new Map([
      ['a', ['visits.csv']],
      ['b', ['data/labs.csv', 'visits.csv']],
    ])
    expect(await pinNotebook({ notebook, dir: DIR, environment: kernel, ran, fingerprint })).toEqual({
      python: '3.12.4',
      // Sorted, and nothing from the old pins: every cell ran here
      packages: [
        { name: 'numpy', version: '2.1.3' },
        { name: 'pandas', version: '2.2.3' },
      ],
      files: [
        { path: 'visits.csv', size: 11, hash: 'sha256:visits' },
        { path: 'data/labs.csv', size: 5, hash: 'sha256:labs' },
      ],
    })
  })

  it('keeps the old pins untouched when no cell ran in this kernel', async () => {
    const { fingerprint, read } = disk({ 'visits.csv': { size: 99, hash: 'sha256:edited' } })
    const notebook: Notebook = { cells: [cell('a', 'load()', byCode('visits.csv'))], pins: OLD }
    expect(await pinNotebook({ notebook, dir: DIR, environment: kernel, ran: new Map(), fingerprint })).toEqual(OLD)
    // The outputs came from the data as it was, so the file isn't hashed again
    expect(read).toEqual([])
  })

  it('merges with the old pins while some cells have not run here', async () => {
    const { fingerprint, read } = disk({ 'visits.csv': { size: 12, hash: 'sha256:visits' }, 'meds.csv': { size: 3, hash: 'sha256:meds' } })
    const notebook: Notebook = {
      cells: [cell('a', 'load()'), cell('b', 'meds()', byCode('meds.csv')), cell('c', 'labs()')],
      pins: OLD,
    }
    const pins = await pinNotebook({ notebook, dir: DIR, environment: kernel, ran: new Map([['a', ['visits.csv']]]), fingerprint })
    expect(pins).toEqual({
      python: '3.12.4',
      // This kernel's versions win, and scipy stays for the cells that didn't run
      packages: [
        { name: 'numpy', version: '2.1.3' },
        { name: 'pandas', version: '2.2.3' },
        { name: 'scipy', version: '1.13.0' },
      ],
      files: [
        { path: 'visits.csv', size: 12, hash: 'sha256:visits' },
        // From the record of a cell that didn't run: its code read it, and the pins had nothing on it yet
        { path: 'meds.csv', size: 3, hash: 'sha256:meds' },
        // As the old pins had it, not read again
        { path: 'labs.csv', size: 20, hash: 'sha256:old-labs' },
      ],
    })
    expect(read).toEqual(['visits.csv', 'meds.csv'])
  })

  it('pins a file too big to hash by its size, and leaves out a file that is gone', async () => {
    const { fingerprint } = disk({ 'scans.parquet': { size: 2 ** 31, hash: null, note: 'Not hashed: larger than 1 GB.' } })
    const notebook: Notebook = { cells: [cell('a', 'scans()')] }
    const ran = new Map([['a', ['scans.parquet', 'deleted.csv']]])
    expect((await pinNotebook({ notebook, dir: DIR, environment: kernel, ran, fingerprint }))?.files).toEqual([
      { path: 'scans.parquet', size: 2 ** 31, hash: null, note: 'Not hashed: larger than 1 GB.' },
    ])
  })

  it('never reads a path outside the folder', async () => {
    const { fingerprint, read } = disk({})
    const notebook: Notebook = {
      cells: [cell('a', 'x()', byCode('../secrets.csv', '/etc/hosts'))],
      pins: { python: null, packages: [], files: [] },
    }
    await pinNotebook({ notebook, dir: DIR, environment: null, ran: new Map(), fingerprint })
    expect(read).toEqual([])
  })

  it('is null for a notebook that has nothing to record', async () => {
    const { fingerprint } = disk({})
    expect(await pinNotebook({ notebook: { cells: [cell('a', '')] }, dir: DIR, environment: kernel, ran: new Map(), fingerprint })).toBeNull()
    // A kernel that ran nothing from this notebook knows nothing about it
    expect(await pinNotebook({ notebook: { cells: [cell('a', 'x = 1')] }, dir: DIR, environment: kernel, ran: new Map([['other', []]]), fingerprint })).toBeNull()
  })
})

describe('comparePins', () => {
  const now = (packages: { name: string; version: string }[], version = '3.11.9'): EnvironmentView => ({ python: '/py', version, packages, error: null })

  it('finds nothing when the environment and files are as pinned', async () => {
    const { fingerprint } = disk({ 'visits.csv': { size: 10, hash: 'sha256:old-visits' }, 'labs.csv': { size: 20, hash: 'sha256:old-labs' } })
    const environment = now([
      { name: 'NumPy', version: '1.26.4' },
      { name: 'scipy', version: '1.13.0' },
      { name: 'requests', version: '2.32.0' },
    ])
    expect(await comparePins(OLD, { dir: DIR, environment, fingerprint })).toEqual([])
  })

  it('lists a new Python, changed and missing packages, and missing, resized or edited files', async () => {
    const { fingerprint } = disk({ 'visits.csv': { size: 10, hash: 'sha256:edited' } })
    const pins: Pins = { ...OLD, files: [...OLD.files, { path: 'big.parquet', size: 5, hash: null, note: 'Not hashed: larger than 1 GB.' }] }
    const changes = await comparePins(pins, { dir: DIR, environment: now([{ name: 'numpy', version: '2.1.3' }], '3.12.4'), fingerprint })
    expect(changes).toEqual([
      { kind: 'python', was: '3.11.9', now: '3.12.4' },
      { kind: 'package', name: 'numpy', was: '1.26.4', now: '2.1.3' },
      { kind: 'package', name: 'scipy', was: '1.13.0', now: null },
      { kind: 'file', path: 'visits.csv', change: 'contents' },
      { kind: 'file', path: 'labs.csv', change: 'missing' },
      { kind: 'file', path: 'big.parquet', change: 'missing' },
    ])
  })

  it('compares a file too big to hash by its size alone', async () => {
    const pins: Pins = { python: null, packages: [], files: [{ path: 'big.parquet', size: 5, hash: null, note: 'Not hashed: larger than 1 GB.' }] }
    const same = disk({ 'big.parquet': { size: 5, hash: null, note: 'Not hashed: larger than 1 GB.' } })
    expect(await comparePins(pins, { dir: DIR, environment: null, fingerprint: same.fingerprint })).toEqual([])
    const grown = disk({ 'big.parquet': { size: 6, hash: null, note: 'Not hashed: larger than 1 GB.' } })
    expect(await comparePins(pins, { dir: DIR, environment: null, fingerprint: grown.fingerprint })).toEqual([{ kind: 'file', path: 'big.parquet', change: 'size' }])
  })

  it('leaves the Python and packages out when the interpreter could not be read', async () => {
    const { fingerprint } = disk({ 'visits.csv': { size: 10, hash: 'sha256:old-visits' }, 'labs.csv': { size: 20, hash: 'sha256:old-labs' } })
    const failed: EnvironmentView = { python: '/py', version: '3.12.4', packages: [], error: "Couldn't list the libraries" }
    expect(await comparePins(OLD, { dir: DIR, environment: failed, fingerprint })).toEqual([{ kind: 'python', was: '3.11.9', now: '3.12.4' }])
    const none: EnvironmentView = { python: null, version: null, packages: [], error: 'No Python found.' }
    expect(await comparePins(OLD, { dir: DIR, environment: none, fingerprint })).toEqual([])
  })
})

describe('paths and names', () => {
  it('keeps pinned paths inside the folder', () => {
    expect(pinnedPath(DIR, 'data/visits.csv')).toBe(path.join(DIR, 'data', 'visits.csv'))
    expect(pinnedPath(DIR, '../other/visits.csv')).toBeNull()
    expect(pinnedPath(DIR, 'data/../../x')).toBeNull()
    expect(pinnedPath(DIR, path.resolve('/etc/hosts'))).toBeNull()
    expect(pinnedPath(DIR, '')).toBeNull()
  })

  it('compares package names the way pip does', () => {
    expect(packageKey('Python_Dateutil')).toBe(packageKey('python-dateutil'))
    expect(packageKey('zope.interface')).toBe('zope-interface')
  })
})
