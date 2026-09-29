import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { newNoteCell, newPromptCell } from '@dalliance/shared/notebook'
import { actions, setApi, useNotebook } from '@/store/notebook-store'
import { fakeApi, fakeSettings, result } from '@/test/fake-api'
import App from './App'

beforeEach(() => {
  actions.load({ cells: [newNoteCell('# Sales review'), newPromptCell('')] }, null)
  actions.closeSettings()
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

  it('runs a suggested next prompt as a new cell', async () => {
    const user = userEvent.setup()
    const { api, requests } = fakeApi((req) =>
      req.prompt === 'Revenue by month'
        ? result({ answer: 'August led.', suggestions: ['Plot revenue by month', 'Break August down by region'] })
        : result({ answer: 'Here is the chart.' }),
    )
    setApi(api)
    render(<App />)

    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Revenue by month')
    await user.click(screen.getByRole('button', { name: 'Run cell' }))
    const list = await screen.findByRole('list', { name: 'Suggested next prompts' })
    await user.click(within(list).getByRole('button', { name: 'Plot revenue by month' }))

    expect(await screen.findByText('Here is the chart.')).toBeInTheDocument()
    expect(requests.map((r) => r.prompt)).toEqual(['Revenue by month', 'Plot revenue by month'])
    // The empty cell below the first one is reused rather than stacking a new one
    expect(screen.getAllByRole('article', { name: 'Prompt cell' })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /Activity/ }))
    expect(screen.getByRole('list', { name: 'Run log' })).toHaveTextContent('Wrote “Plot revenue by month”')
  })

  it('keeps earlier versions of a cell and restores one', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi((req) => result({ code: req.prompt === 'Total sales' ? 'orders.total.sum()' : 'orders.total.mean()' }))
    setApi(api)
    render(<App />)

    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    await user.type(prompt, 'Total sales')
    await user.click(screen.getByRole('button', { name: 'Run cell' }))
    await screen.findByRole('tab', { name: 'Code' })
    await user.clear(prompt)
    await user.type(prompt, 'Average sale')
    await user.click(screen.getByRole('button', { name: 'Run cell' }))
    await waitFor(() => expect(useNotebook.getState().runs).toEqual({}))

    await user.click(screen.getByRole('button', { name: /History/ }))
    const pane = screen.getByRole('region', { name: 'History' })
    expect(within(pane).getByText('Earlier')).toBeInTheDocument()
    await user.click(within(pane).getByRole('button', { name: 'Restore' }))

    expect(prompt).toHaveValue('Total sales')
    const cell = useNotebook.getState().notebook.cells[1]
    expect(cell).toMatchObject({ code: 'orders.total.sum()', state: 'edited' })
  })

  it('writes the brief to AGENTS.md from its pane', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    const writes: string[] = []
    api.writeBrief = async (text) => {
      writes.push(text)
      return { path: '/tmp/AGENTS.md', text }
    }
    setApi(api)
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Brief/ }))
    await user.click(await screen.findByRole('button', { name: 'Start a brief' }))
    await user.click(screen.getByRole('button', { name: 'Done editing' }))

    expect(writes[0]).toContain('## Done when')
    expect(await screen.findByRole('heading', { name: 'What this notebook is for' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'A check the results should pass' }))
    expect(writes[1]).toContain('- [x] A check the results should pass')
  })

  it('sums up where the notebook stands', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    setApi(api)
    render(<App />)

    expect(screen.getByText('Nothing has run yet. Press Run all, or Shift+Enter in a cell.')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Total sales')
    await user.click(screen.getByRole('button', { name: 'Run cell' }))
    expect(await screen.findByText('The cell is up to date.')).toBeInTheDocument()
  })

  it('pins several results side by side', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi((req) => result({ answer: `Answer to ${req.prompt}.` }))
    setApi(api)
    actions.load({ cells: [newPromptCell('First'), newPromptCell('Second')] }, null)
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Run all' }))
    await screen.findByText('Answer to Second.')
    for (const pin of screen.getAllByRole('button', { name: 'Pin result to the side' })) await user.click(pin)

    const pane = screen.getByRole('region', { name: 'Pinned' })
    expect(within(pane).getAllByRole('listitem')).toHaveLength(2)
    await user.click(within(pane).getAllByRole('button', { name: 'Unpin' })[0])
    expect(within(pane).getAllByRole('listitem')).toHaveLength(1)
    expect(within(pane).getByText('Answer to Second.')).toBeInTheDocument()
  })

  it('picks a model from any maker the gateway offers', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    const updates: unknown[] = []
    api.updateSettings = async (u) => {
      updates.push(u)
      return { ...(await api.getSettings()), ...u }
    }
    setApi(api)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /Opus 5/ }))
    await user.type(await screen.findByPlaceholderText('Search models'), 'gemini')
    await user.click(await screen.findByRole('option', { name: /Gemini 3 Pro/ }))
    expect(updates).toContainEqual({ model: 'google/gemini-3-pro' })
  })

  it('opens Settings as its own screen, with a tab per section', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    api.getSettings = async () => ({ ...fakeSettings(), keySource: null, hasKey: { gateway: false, anthropic: false } })
    setApi(api)
    render(<App />)

    // The banner for a missing key goes straight to Models
    await user.click(await screen.findByRole('button', { name: 'Open Settings' }))
    expect(screen.getByRole('tab', { name: 'Models' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('anthropic/claude-opus-5')

    await user.click(screen.getByRole('tab', { name: 'Python' }))
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument()

    // Notebook keys stay off while Settings is up
    const cells = screen.getAllByRole('article', { hidden: true }).length
    await user.keyboard('b')
    expect(screen.getAllByRole('article', { hidden: true })).toHaveLength(cells)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tab', { name: 'Python' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeInTheDocument()

    // It reopens where it was left
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('tab', { name: 'Python' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the pane shortcuts in the overview tooltips', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result()).api)
    render(<App />)
    await user.hover(screen.getByRole('button', { name: /^Brief/ }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Brief.+1$/)
  })

  it('shows the account in the top bar, with a menu to sign out', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    api.getAccount = async () => ({ user: { name: 'Ada Lovelace', email: 'ada@example.com' }, checking: false, waiting: false, error: null })
    let signedOut = false
    api.signOut = async () => {
      signedOut = true
      return { user: null, checking: false, waiting: false, error: null }
    }
    setApi(api)
    render(<App />)

    // The gear's tooltip carries the shortcut
    await user.hover(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Settings.+,$/)
    await user.unhover(screen.getByRole('button', { name: 'Settings' }))
    const avatar = await screen.findByRole('button', { name: 'Account: Ada Lovelace' })
    expect(avatar).toHaveTextContent('AL')

    await user.click(avatar)
    expect(await screen.findByText('ada@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(signedOut).toBe(true)
    expect(await screen.findByRole('button', { name: 'Account' })).toBeInTheDocument()

    // Signed out, the menu offers sign-in and Settings
    await user.click(screen.getByRole('button', { name: 'Account' }))
    expect(await screen.findByRole('menuitem', { name: 'Sign in…' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /^Settings/ }))
    expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument()
  })

  it('signs in from Settings, and takes the code when the browser could not open the app', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    const codes: string[] = []
    const redeem = api.redeemSignInCode
    api.redeemSignInCode = async (code) => {
      codes.push(code)
      return redeem(code)
    }
    let push: (account: Awaited<ReturnType<typeof api.getAccount>>) => void = () => {}
    api.onAccount = (listener) => {
      push = listener
      return () => {}
    }
    setApi(api)
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Account' }))
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))
    await user.type(await screen.findByRole('textbox', { name: 'Code from the sign-in page' }), 'abc123')
    await user.click(screen.getByRole('button', { name: 'Use code' }))
    expect(codes).toEqual(['abc123'])
    expect(await screen.findByText(/Signed in as/)).toHaveTextContent('Signed in as Ada (ada@example.com).')

    // The main process reports a sign-out made elsewhere, like the session ending
    act(() => push({ user: null, checking: false, waiting: false, error: null }))
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows the short title a small model wrote for a long prompt', async () => {
    const user = userEvent.setup()
    const long = 'Plot the return rate for each product category over time, month by month'
    const { api, requests } = fakeApi((req, emit) => {
      if (req.nameIt) emit({ type: 'title', title: 'Return rate by category', prompt: req.prompt })
      return result()
    })
    setApi(api)
    render(<App />)

    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), long)
    await user.click(screen.getByRole('button', { name: 'Run cell' }))
    const outline = screen.getByRole('complementary', { name: 'Overview' })
    expect(await within(outline).findByRole('button', { name: 'Return rate by category' })).toBeInTheDocument()
    expect(requests[0].nameIt).toBe(true)

    // Rerunning the same prompt doesn't ask again, and editing it shows the prompt until it's named anew
    await user.click(screen.getByRole('button', { name: 'Run cell' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1].nameIt).toBeFalsy()
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), ' for Pro')
    expect(within(outline).queryByRole('button', { name: 'Return rate by category' })).not.toBeInTheDocument()
  })

  it('names short shorthand prompts and saved cells that rerun without the agent', async () => {
    const user = userEvent.setup()
    const { api, requests } = fakeApi((req, emit) => {
      if (req.nameIt) emit({ type: 'title', title: req.prompt.startsWith('plt') ? 'Monthly revenue by category' : 'Data overview', prompt: req.prompt })
      return result({ generated: req.generate })
    })
    setApi(api)
    // A cell that already has code from an earlier session, and a new shorthand prompt
    actions.load({ cells: [newPromptCell('Load the data and describe it', 'orders = pd.read_csv("orders.csv")'), newPromptCell('plt monthly rev by category?')] }, null)
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Run all' }))
    const outline = screen.getByRole('complementary', { name: 'Overview' })
    expect(await within(outline).findByRole('button', { name: 'Monthly revenue by category' })).toBeInTheDocument()
    expect(within(outline).getByRole('button', { name: 'Data overview' })).toBeInTheDocument()
    expect(requests.map((r) => [r.generate, r.nameIt])).toEqual([
      [false, true],
      [true, true],
    ])
  })

  it('keeps Cmd+A to text fields and the block holding the selection, like a desktop app', async () => {
    const { api } = fakeApi(() => result())
    setApi(api)
    render(<App />)
    await screen.findByRole('textbox', { name: 'Prompt' })

    // On the app's chrome it does nothing, instead of selecting the whole window
    expect(fireEvent.keyDown(document.body, { key: 'a', metaKey: true })).toBe(false)
    // In a text field it's left to the field
    expect(fireEvent.keyDown(screen.getByRole('textbox', { name: 'Prompt' }), { key: 'a', metaKey: true })).toBe(true)

    // Inside a selectable block it selects that block only
    const block = document.createElement('div')
    block.setAttribute('data-selectable', '')
    block.textContent = 'August averaged 41.2.'
    document.body.append(block)
    window.getSelection()!.collapse(block.firstChild!, 3)
    fireEvent.keyDown(document.body, { key: 'a', metaKey: true })
    expect(window.getSelection()!.toString()).toBe('August averaged 41.2.')
    block.remove()
  })
})
