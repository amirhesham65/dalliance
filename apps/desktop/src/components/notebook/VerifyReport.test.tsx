import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Output, type PromptCell, newNoteCell, newPromptCell } from '@dalliance/shared/notebook'
import { actions, setApi, useNotebook } from '@/store/notebook-store'
import { fakeApi, result } from '@/test/fake-api'
import App from '@/App'

vi.setConfig({ testTimeout: 15_000 })

const text = (t: string): Output[] => [{ type: 'text', text: t }]
const ran = (prompt: string, code: string, output: string): PromptCell => ({
  ...newPromptCell(prompt, code),
  generatedFrom: prompt,
  state: 'done',
  executionCount: 1,
  outputs: text(output),
})

beforeEach(() => {
  actions.closeSettings()
  actions.openPane(null)
})

describe('Verify', () => {
  it('asks first, reruns the cells and reports each one without touching the saved outputs', async () => {
    const user = userEvent.setup()
    const reruns: Record<string, Output[]> = {
      'patients = load()\nlen(patients)': text('412'),
      'import numpy as np\nnp.random.choice(patients.id, 20)': text('[17, 3, 250]'),
      'cohort.describe()': [{ type: 'error', ename: 'NameError', evalue: "name 'cohort' is not defined", traceback: [] }],
    }
    const { api, requests } = fakeApi((req) => {
      const outputs = reruns[req.code]
      return result({ ok: outputs[0].type !== 'error', generated: false, code: req.code, outputs })
    })
    setApi(api)
    actions.load(
      {
        cells: [
          newNoteCell('# Readout'),
          ran('Load patients.csv', 'patients = load()\nlen(patients)', '412'),
          ran('Pick 20 patients at random', 'import numpy as np\nnp.random.choice(patients.id, 20)', '[5, 81, 102]'),
          ran('Describe the cohort', 'cohort.describe()', 'count 38'),
        ],
      },
      null,
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Verify' }))
    const dialog = screen.getByRole('dialog', { name: 'Verify this notebook?' })
    expect(within(dialog).getByText('Verify restarts Python and re-runs every cell. Variables you created outside cells will be cleared.')).toBeInTheDocument()
    expect(requests).toEqual([])
    await user.click(within(dialog).getByRole('button', { name: 'Verify' }))

    const report = await screen.findByRole('region', { name: 'Verify report' })
    await waitFor(() => expect(within(report).getByRole('status')).toHaveTextContent('Verified 3 cells: 1 the same, 1 changed, 1 failed.'))
    expect(requests.every((r) => !r.generate)).toBe(true)
    const rows = within(report).getAllByRole('listitem')
    expect(within(rows[0]).getByText('Same')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Changed')).toBeInTheDocument()
    expect(within(rows[1]).getByText(/runs with no seed set/)).toBeInTheDocument()
    expect(within(rows[2]).getByText('Failed')).toBeInTheDocument()
    expect(within(rows[2]).getByText("NameError: name 'cohort' is not defined")).toBeInTheDocument()
    expect(within(rows[2]).getByText(/No cell creates/)).toHaveTextContent('No cell creates cohort. It was made outside the cells')

    // The cell still shows what was saved
    const cell = screen.getByRole('article', { name: 'Prompt cell 2' })
    expect(within(cell).getByText('[5, 81, 102]')).toBeInTheDocument()

    // Saved and new side by side, then the new ones kept on purpose
    await user.click(within(rows[1]).getByRole('button', { name: 'Show saved and new outputs' }))
    const both = within(rows[1]).getByRole('group', { name: 'Saved and new outputs of cell 2' })
    expect(within(within(both).getByRole('group', { name: 'Saved' })).getByText('[5, 81, 102]')).toBeInTheDocument()
    expect(within(within(both).getByRole('group', { name: 'New' })).getByText('[17, 3, 250]')).toBeInTheDocument()
    await user.click(within(rows[1]).getByRole('button', { name: 'Keep the new outputs' }))
    expect(within(cell).getByText('[17, 3, 250]')).toBeInTheDocument()
    expect(within(rows[1]).getByText('The new outputs replaced the saved ones.')).toBeInTheDocument()

    await user.click(within(report).getByRole('button', { name: 'Close the report' }))
    expect(screen.queryByRole('region', { name: 'Verify report' })).not.toBeInTheDocument()
  })

  it('stops from the report and keeps what it found so far', async () => {
    const user = userEvent.setup()
    let release: (() => void) | undefined
    const { api } = fakeApi((req) =>
      req.code === 'slow()'
        ? new Promise((resolve) => {
            release = () => resolve(result({ ok: false, generated: false, code: req.code, outputs: [{ type: 'error', ename: 'KeyboardInterrupt', evalue: '', traceback: [] }] }))
          })
        : result({ generated: false, code: req.code, outputs: text('1') }),
    )
    // Like the kernel, an interrupt stops the running cell with a KeyboardInterrupt
    api.interrupt = async () => release?.()
    setApi(api)
    actions.load({ cells: [ran('One', 'a = 1\na', '1'), ran('Slow', 'slow()', '2'), ran('Three', 'c = 3\nc', '3')] }, null)
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Verify' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Verify' }))
    const report = await screen.findByRole('region', { name: 'Verify report' })
    await waitFor(() => expect(within(report).getByRole('status')).toHaveTextContent('Rerunning cell 2, 2 of 3.'))
    await user.click(within(report).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(within(report).getByRole('status')).toHaveTextContent('Stopped verifying after 2 of 3 cells: 1 the same, 1 stopped.'))
    const rows = within(report).getAllByRole('listitem')
    expect(rows.map((r) => within(r).getByText(/^(Same|Stopped|Not run)$/).textContent)).toEqual(['Same', 'Stopped', 'Not run'])
    expect(useNotebook.getState().runs).toEqual({})
  })
})
