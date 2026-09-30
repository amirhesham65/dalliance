/// <reference types="node" />
// Opening and saving notebooks written by Jupyter. The fixtures are in packages/shared/fixtures.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FORMAT_VERSION, TABLE_MIME, fromIpynb, toIpynb } from './ipynb'
import { type Notebook, type NoteCell, type Pins, type PromptCell, newPromptCell } from './notebook'

type Json = Record<string, any>

const FIXTURES = ['jupyter-python.ipynb', 'jupyter-r.ipynb', 'jupyter-legacy.ipynb']
const fixture = (name: string): Json => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf-8'))
const save = (nb: Notebook): Json => JSON.parse(JSON.stringify(toIpynb(nb)))
const prompt = (nb: Notebook, i: number) => nb.cells[i] as PromptCell

/** A file without what Dalliance adds on save: metadata.dalliance, the minor version and cell ids. Sources are joined. */
function withoutDalliance(file: Json, { ids = true } = {}): Json {
  const copy = structuredClone(file)
  delete copy.metadata.dalliance
  delete copy.nbformat_minor
  for (const cell of copy.cells) {
    delete cell.metadata.dalliance
    if (!ids) delete cell.id
    if (Array.isArray(cell.source)) cell.source = cell.source.join('')
  }
  return copy
}

// nbformat.validate through Python, when python3 with nbformat is installed. Returns the error text, or '' when valid
const VALIDATE = 'import json, sys, nbformat\nnbformat.validate(nbformat.from_dict(json.load(sys.stdin)))'
const hasNbformat = (() => {
  try {
    return spawnSync('python3', ['-c', 'import nbformat'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
})()
function nbformatErrors(file: Json): string {
  const run = spawnSync('python3', ['-c', VALIDATE], { input: JSON.stringify(file), encoding: 'utf-8' })
  return run.status === 0 ? '' : run.stderr || `exit ${run.status}`
}

describe('Jupyter notebooks survive a save', () => {
  it.each(['jupyter-python.ipynb', 'jupyter-r.ipynb'])('%s saves as it was found, plus Dalliance fields', (name) => {
    const original = fixture(name)
    const saved = save(fromIpynb(original))
    expect(withoutDalliance(saved)).toEqual(withoutDalliance(original))
    expect(saved.metadata.dalliance).toEqual({ version: FORMAT_VERSION })
    expect(saved.nbformat_minor).toBe(5)
  })

  it('upgrades a 4.4 file to 4.5 with cell ids and loses nothing else', () => {
    const original = fixture('jupyter-legacy.ipynb')
    const saved = save(fromIpynb(original))
    expect(withoutDalliance(saved, { ids: false })).toEqual(withoutDalliance(original, { ids: false }))
    for (const cell of saved.cells) expect(cell.id).toMatch(/^[a-zA-Z0-9-_]{1,64}$/)
    // No language_info is invented for a file that names its kernel
    expect(saved.metadata).not.toHaveProperty('language_info')
  })

  it.each(FIXTURES)('%s saves the same file again after reopening', (name) => {
    const once = save(fromIpynb(fixture(name)))
    expect(save(fromIpynb(once))).toEqual(once)
  })

  it('keeps the kernelspec as found and defaults to Python 3 only without one', () => {
    expect(save(fromIpynb(fixture('jupyter-r.ipynb'))).metadata).toMatchObject({ kernelspec: { name: 'ir', language: 'R' }, language_info: { name: 'R' } })
    expect(save({ cells: [] }).metadata).toMatchObject({ kernelspec: { name: 'python3' }, language_info: { name: 'python' } })
    const noKernel = fromIpynb({ nbformat: 4, metadata: { authors: [{ name: 'Ana' }], kernelspec: 'bad' }, cells: [] })
    expect(save(noKernel).metadata).toEqual({
      authors: [{ name: 'Ana' }],
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
      dalliance: { version: FORMAT_VERSION },
    })
  })

  it('keeps widget state and other notebook metadata', () => {
    const original = fixture('jupyter-python.ipynb')
    const saved = save(fromIpynb(original))
    expect(saved.metadata.widgets).toEqual(original.metadata.widgets)
    expect(saved.metadata.toc).toEqual({ number_sections: false })
  })
})

describe('what Dalliance shows from a Jupyter notebook', () => {
  const nb = fromIpynb(fixture('jupyter-python.ipynb'))

  it('shows a raw cell as a note and saves it as raw', () => {
    const raw = nb.cells[1] as NoteCell
    expect(raw).toMatchObject({ kind: 'note', markdown: '.. note::\n   Exported with nbconvert for the wiki.', jupyter: { raw: true } })
    expect(save(nb).cells[1]).toMatchObject({ cell_type: 'raw', metadata: { raw_mimetype: 'text/restructuredtext' } })
  })

  it('shows the outputs it understands and holds on to the rest in place', () => {
    // stderr, a widget view (its text/plain fallback shows), a chart, an HTML-only display (not shown)
    expect(prompt(nb, 7).outputs.map((o) => o.type)).toEqual(['stream', 'text', 'image'])
    expect(prompt(nb, 7).jupyter?.outputs?.map((o) => Object.keys((o.data as Json) ?? {}))).toEqual([
      [],
      ['application/vnd.jupyter.widget-view+json', 'text/plain'],
      ['image/png', 'text/plain'],
      ['text/html'],
    ])
    // SVG and JPEG have plain text fallbacks only
    expect(prompt(nb, 5).outputs).toEqual([
      { type: 'text', text: '<IPython.core.display.SVG object>' },
      { type: 'text', text: '<IPython.core.display.Image object>' },
    ])
  })

  it('keeps notes, attachments and tags through edits', () => {
    const edited: Notebook = {
      ...nb,
      cells: nb.cells.map((c) =>
        c.kind === 'note' ? { ...c, markdown: `${c.markdown}\n\nEdited.` } : { ...c, prompt: 'Load the subscriptions', code: `${c.code}\n# edited`, codeEdited: true },
      ),
    }
    const saved = save(edited)
    expect(saved.cells[0].attachments).toEqual(fixture('jupyter-python.ipynb').cells[0].attachments)
    expect(saved.cells[0].source.join('')).toMatch(/Edited\.$/)
    expect(saved.cells[3].metadata).toMatchObject({ tags: ['hide-input'], jupyter: { source_hidden: true }, dalliance: { prompt: 'Load the subscriptions' } })
    expect(saved.cells[2].metadata.execution).toBeDefined()
  })

  it('carries nothing extra for a notebook made in Dalliance', () => {
    const cell: PromptCell = {
      ...newPromptCell('Total revenue', 'orders.total.sum()'),
      executionCount: 2,
      outputs: [
        { type: 'stream', name: 'stdout', text: 'ok\n' },
        { type: 'text', text: '42' },
        { type: 'table', columns: ['a'], index: ['0'], rows: [[1]], totalRows: 1 },
        { type: 'image', mime: 'image/png', data: 'iVBORw0KGgo=' },
      ],
    }
    const back = fromIpynb(save({ cells: [cell] }))
    expect(back.cells[0]).not.toHaveProperty('jupyter')
    expect(back.metadata).toEqual({ kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' } })
  })
})

describe('outputs Dalliance cannot show', () => {
  const original = fixture('jupyter-python.ipynb')

  it('are dropped once the cell reruns', () => {
    const nb = fromIpynb(original)
    const cell = prompt(nb, 3)
    const rerun: PromptCell = {
      ...cell,
      executionCount: 1,
      state: 'done',
      outputs: [
        { type: 'stream', name: 'stdout', text: 'Loaded 12,408 subscriptions\n' },
        { type: 'table', columns: ['plan', 'churned'], index: ['0', '1'], rows: [['Pro', 0.038], ['Team', 0.021]], totalRows: 2 },
      ],
    }
    const saved = save({ ...nb, cells: nb.cells.map((c) => (c.id === cell.id ? rerun : c)) })
    expect(saved.cells[3].outputs).toEqual([
      { output_type: 'stream', name: 'stdout', text: ['Loaded 12,408 subscriptions\n'] },
      { output_type: 'display_data', metadata: {}, data: { [TABLE_MIME]: expect.any(Object), 'text/plain': ['<table 2 rows × 2 columns>'] } },
    ])
    // The cell's metadata stays: only the outputs were replaced
    expect(saved.cells[3].metadata).toMatchObject({ tags: ['hide-input'], jupyter: { source_hidden: true } })
    // Other cells are untouched
    expect(saved.cells[7].outputs).toEqual(original.cells[7].outputs)
  })

  it('are dropped when a rerun gives the same outputs under a new execution count', () => {
    const nb = fromIpynb(original)
    const saved = save({ ...nb, cells: nb.cells.map((c, i) => (i === 7 ? { ...(c as PromptCell), executionCount: 12 } : c)) })
    expect(saved.cells[7].outputs.map((o: Json) => Object.keys(o.data ?? {}))).toEqual([[], ['text/plain'], ['image/png', 'text/plain']])
  })

  it('are kept when nothing reran, including after Python restarts', () => {
    const nb = fromIpynb(original)
    // Restarting clears execution counts and keeps outputs
    const restarted = { ...nb, cells: nb.cells.map((c) => (c.kind === 'prompt' ? { ...c, executionCount: null, state: 'stale' as const } : c)) }
    const saved = save(restarted)
    saved.cells.forEach((cell: Json, i: number) => {
      if (cell.cell_type === 'code') expect(cell.outputs).toEqual(original.cells[i].outputs)
    })
    // And they survive the next reopen too
    expect(save(fromIpynb(saved)).cells[7].outputs).toEqual(original.cells[7].outputs)
  })
})

describe('Dalliance fields under metadata.dalliance', () => {
  it('win over what the file had, and keys Dalliance does not know are kept', () => {
    const nb = fromIpynb({
      nbformat: 4,
      metadata: { dalliance: { version: 0, theme: 'dark' } },
      cells: [{ cell_type: 'code', source: ['x = 1'], metadata: { tags: ['a'], dalliance: { prompt: 'Set x', suggestions: ['Plot x'], pinned: true } }, outputs: [] }],
    })
    const cell = { ...prompt(nb, 0), prompt: 'Set x to one', suggestions: [] }
    const saved = save({ ...nb, cells: [cell] })
    expect(saved.metadata.dalliance).toEqual({ theme: 'dark', version: FORMAT_VERSION })
    expect(saved.cells[0].metadata.tags).toEqual(['a'])
    expect(saved.cells[0].metadata.dalliance).toMatchObject({ prompt: 'Set x to one', pinned: true })
    // A field Dalliance cleared does not come back from the file
    expect(saved.cells[0].metadata.dalliance).not.toHaveProperty('suggestions')
  })
})

describe.skipIf(!hasNbformat)('nbformat.validate', () => {
  it.each(FIXTURES)('accepts the fixture %s and its saved copy', (name) => {
    const original = fixture(name)
    expect(nbformatErrors(original)).toBe('')
    expect(nbformatErrors(save(fromIpynb(original)))).toBe('')
  })

  it('accepts a saved copy after a rerun and a restart', () => {
    const nb = fromIpynb(fixture('jupyter-python.ipynb'))
    const cells = nb.cells.map((c, i) =>
      c.kind !== 'prompt'
        ? c
        : i === 3
          ? { ...c, executionCount: 1, outputs: [{ type: 'table' as const, columns: ['a'], index: ['0'], rows: [[1]], totalRows: 1 }] }
          : { ...c, executionCount: null },
    )
    expect(nbformatErrors(save({ ...nb, cells }))).toBe('')
  })

  it('accepts a cell with the record of how it was made', () => {
    const cell: PromptCell = {
      ...newPromptCell('Mean total', 'orders.total.mean()'),
      provenance: {
        prompt: 'Mean total',
        corrections: [],
        madeAt: '2026-09-30T12:00:00.000Z',
        model: 'anthropic/claude-sonnet-5.5',
        effort: 'medium',
        steps: [{ step: 1, model: 'anthropic/claude-sonnet-5.5', fallback: false }],
        rationale: { from: 'interpretation', text: ['The mean of the total column.'] },
        attemptCount: 1,
        attempts: [{ code: 'orders.total.mean()', error: null, changed: null }],
        filesRead: [{ path: 'orders.csv', by: 'code' }],
        filesReadTruncated: false,
        approvals: [],
        codeHash: `sha256:${'0'.repeat(64)}`,
        outputsHash: `sha256:${'1'.repeat(64)}`,
      },
    }
    expect(nbformatErrors(save({ cells: [cell] }))).toBe('')
  })

  it('accepts a notebook with pins', () => {
    const nb = fromIpynb(fixture('jupyter-python.ipynb'))
    expect(nbformatErrors(save({ ...nb, pins: PINS }))).toBe('')
  })
})

const PINS: Pins = {
  python: '3.12.4',
  packages: [
    { name: 'numpy', version: '2.1.3' },
    { name: 'pandas', version: '2.2.3' },
  ],
  files: [
    { path: 'data/visits.csv', size: 48213, hash: `sha256:${'a'.repeat(64)}` },
    { path: 'imaging/all.parquet', size: 2_147_483_648, hash: null, note: 'Not hashed: larger than 1 GB.' },
  ],
}

describe('pins', () => {
  it('save under the notebook metadata beside the version, and read back the same', () => {
    const saved = save({ cells: [newPromptCell('Load visits', 'visits = pd.read_csv("data/visits.csv")')], pins: PINS })
    expect(saved.metadata.dalliance).toEqual({ version: FORMAT_VERSION, pins: PINS })
    const back = fromIpynb(saved)
    expect(back.pins).toEqual(PINS)
    // Read into the notebook, not carried as passthrough, so a save writes the notebook's own
    expect(back.metadata?.dalliance).toBeUndefined()
    expect(save(back)).toEqual(saved)
  })

  it('are absent from a Jupyter file and from a notebook saved before them', () => {
    const nb = fromIpynb(fixture('jupyter-python.ipynb'))
    expect(nb).not.toHaveProperty('pins')
    expect(save(nb).metadata.dalliance).toEqual({ version: FORMAT_VERSION })
  })

  it('keep other keys under metadata.dalliance, and drop pins a save cleared', () => {
    const nb = fromIpynb({ nbformat: 4, metadata: { dalliance: { version: 1, theme: 'dark', pins: PINS } }, cells: [] })
    expect(nb.pins).toEqual(PINS)
    expect(save({ ...nb, pins: undefined }).metadata.dalliance).toEqual({ theme: 'dark', version: FORMAT_VERSION })
  })

  it('read malformed parts as missing', () => {
    const read = (pins: unknown) => fromIpynb({ nbformat: 4, metadata: { dalliance: { version: 1, pins } }, cells: [] }).pins
    expect(read('3.12')).toBeUndefined()
    expect(read({ python: 3.12, packages: 'pandas', files: {} })).toBeUndefined()
    expect(
      read({
        python: '3.12.4',
        packages: [{ name: 'pandas', version: '2.2.3' }, { name: 'numpy' }, 'scipy', null],
        files: [
          { path: 'a.csv', size: 3, hash: 'sha256:00' },
          { path: 'b.csv', size: -1, hash: 'sha256:00' },
          { path: 'c.csv', hash: 'sha256:00' },
          { path: 'd.csv', size: 5, hash: 7 },
          { size: 5, hash: 'sha256:00' },
        ],
      }),
    ).toEqual({
      python: '3.12.4',
      packages: [{ name: 'pandas', version: '2.2.3' }],
      files: [
        { path: 'a.csv', size: 3, hash: 'sha256:00' },
        { path: 'd.csv', size: 5, hash: null, note: 'Not hashed.' },
      ],
    })
  })
})
