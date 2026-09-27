import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { newNoteCell, newPromptCell } from '@/shared/notebook'
import { actions, setApi } from '@/store/notebook-store'
import { fakeApi, result } from '@/test/fake-api'
import App from './App'

beforeEach(() => {
  actions.load({ cells: [newNoteCell('# Sales review'), newPromptCell('')] }, null)
})

describe('App', () => {
  it('turns a prompt into code and shows the result', async () => {
    const user = userEvent.setup()
    const { api, requests } = fakeApi(() =>
      result({
        code: 'orders.total.mean()',
        outputs: [{ type: 'table', columns: ['month', 'total'], index: ['0'], rows: [['Aug', 41.2]], totalRows: 1 }],
        interpretation: 'Order value is [[total including tax]].',
        answer: 'August averaged 41.2.',
      }),
    )
    setApi(api)
    render(<App />)

    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    await user.type(prompt, 'Average order value by month')
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    expect(await screen.findByText('August averaged 41.2.')).toBeInTheDocument()
    expect(requests[0]).toMatchObject({ prompt: 'Average order value by month', generate: true })
    expect(screen.getByRole('button', { name: 'total including tax' })).toBeInTheDocument()
    // With an answer, the table is folded until asked for
    expect(screen.queryByRole('cell', { name: 'Aug' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show table' }))
    expect(screen.getByRole('cell', { name: 'Aug' })).toBeInTheDocument()
    // Shift+Enter on the last cell adds a new prompt cell
    expect(screen.getAllByRole('article', { name: 'Prompt cell' })).toHaveLength(2)

    await user.click(screen.getByRole('tab', { name: 'Code' }))
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveValue('orders.total.mean()')
  })

  it('asks the question the agent raises and sends back the answer', async () => {
    const user = userEvent.setup()
    let finish!: () => void
    const { api, responses } = fakeApi(
      (_req, emit) =>
        new Promise((resolve) => {
          emit({ type: 'question', requestId: 'q1', question: 'Which sales data?', options: ['orders.csv', 'refunds.csv'] })
          finish = () => resolve(result())
        }),
    )
    setApi(api)
    render(<App />)
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Total sales')
    await user.click(screen.getByRole('button', { name: 'Run cell' }))

    const card = await screen.findByRole('alertdialog', { name: 'Which sales data?' })
    await user.click(within(card).getByRole('button', { name: 'orders.csv' }))
    expect(responses).toEqual([['q1', 'orders.csv']])
    finish()
  })

  it('shows why a run could not start', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result({ ok: false, outputs: [], executionCount: null, error: 'Add an AI Gateway key in Settings to run prompts.' })).api)
    render(<App />)
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Plot revenue')
    await user.click(screen.getByRole('button', { name: 'Run cell' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Add an AI Gateway key')
  })

  it('deletes a cell with D D and brings it back with Undo', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result()).api)
    render(<App />)
    await user.click(screen.getByRole('heading', { name: 'Sales review' }))
    await user.keyboard('dd')
    expect(screen.queryByRole('heading', { name: 'Sales review' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('heading', { name: 'Sales review' })).toBeInTheDocument()
  })
})

describe('result layout', () => {
  it('opens a large table on its column overview and folds printed text away', async () => {
    const user = userEvent.setup()
    setApi(
      fakeApi(() =>
        result({
          answer: '**2,863 orders** from 2025.',
          interpretation: 'Loaded the file.',
          variables: [{ name: 'orders', type: 'DataFrame', shape: '2,863 × 2' }],
          outputs: [
            { type: 'stream', name: 'stdout', text: 'shape (2863, 2)\n\n\n' },
            {
              type: 'table',
              columns: ['region', 'total'],
              index: ['0'],
              rows: [['South', 24]],
              totalRows: 2863,
              profile: [
                { name: 'region', dtype: 'object', kind: 'text', count: 2863, missing: 38, unique: 4, top: [['West', 740], ['South', 720]] },
                { name: 'total', dtype: 'float64', kind: 'number', count: 2863, missing: 0, unique: 900, min: 9.5, max: 164.02, mean: 31.4 },
              ],
            },
          ],
        }),
      ).api,
    )
    render(<App />)
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Load orders')
    await user.click(screen.getByRole('button', { name: 'Run cell' }))

    expect(await screen.findByText('2,863 orders')).toHaveProperty('tagName', 'STRONG')
    // An interpretation without [[assumptions]] is not shown
    expect(screen.queryByText('Loaded the file.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show columns' }))
    expect(screen.getByRole('button', { name: 'columns' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('38 (1%)')).toBeInTheDocument()
    expect(screen.getByText('9.5 to 164.02, mean 31.4')).toBeInTheDocument()
    expect(screen.getByText('West 740 · South 720 · …')).toBeInTheDocument()
    expect(screen.getByText('Printed output · 1 line')).toBeInTheDocument()
    expect(screen.getAllByText('orders').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'rows' }))
    expect(screen.getByRole('cell', { name: 'South' })).toBeInTheDocument()
  })
})

describe('folding tables', () => {
  const table = { type: 'table' as const, columns: ['customer', 'spend'], index: ['0'], rows: [['C0001', 812]], totalRows: 1 }

  it('shows a table open when it is the whole result', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result({ answer: null, outputs: [table] })).api)
    render(<App />)
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Top customers')
    await user.click(screen.getByRole('button', { name: 'Run cell' }))
    expect(await screen.findByRole('cell', { name: 'C0001' })).toBeInTheDocument()
  })

  it('folds and unfolds with T, and Hide folds it again', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result({ answer: 'C0001 spent the most.', outputs: [table] })).api)
    render(<App />)
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Top customers')
    await user.click(screen.getByRole('button', { name: 'Run cell' }))
    await screen.findByText('C0001 spent the most.')
    expect(screen.queryByRole('cell', { name: 'C0001' })).not.toBeInTheDocument()

    await user.click(screen.getByText('C0001 spent the most.'))
    await user.keyboard('t')
    expect(screen.getByRole('cell', { name: 'C0001' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByRole('cell', { name: 'C0001' })).not.toBeInTheDocument()
  })
})

describe('question cells', () => {
  it('shows a written answer with its list, and no Code tab', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result({ code: '', outputs: [], executionCount: null, answer: 'Predict returns.\n- target: returned\n- features: region' })).api)
    render(<App />)
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'What model could we build?')
    await user.click(screen.getByRole('button', { name: 'Run cell' }))
    expect(await screen.findByText('Predict returns.')).toBeInTheDocument()
    expect(screen.getByText('target: returned').closest('li')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Code' })).not.toBeInTheDocument()
  })
})
