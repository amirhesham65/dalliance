import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { type PromptCell, newNoteCell, newPromptCell } from '@dalliance/shared/notebook'
import { actions, setApi, useNotebook } from '@/store/notebook-store'
import { fakeApi, fakeSettings, result } from '@/test/fake-api'
import App from './App'

// These tests type and run whole cells, which takes longer than the 5s default on a loaded machine
vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  actions.load({ cells: [newNoteCell('# Sales review'), newPromptCell('')] }, null)
  actions.closeSettings()
  actions.openPane(null)
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
    expect(screen.getAllByRole('article', { name: /^Prompt cell/ })).toHaveLength(2)

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
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))

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
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))
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

  it('makes a prompt cell with code a note with M, and Undo brings the cell back as it was', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result()).api)
    const rev = { at: 1, prompt: 'Revenue by month', code: 'rev = orders.total.sum()', interpretation: null, answer: 'Revenue rose.', edited: false }
    const original: PromptCell = {
      ...newPromptCell('Revenue by month', 'rev = orders.total.sum()'),
      outputs: [{ type: 'text', text: '41.2' }],
      answer: 'Revenue rose.',
      history: [rev],
      executionCount: 3,
      state: 'done',
    }
    actions.load({ cells: [newNoteCell('# Sales review'), original] }, null)
    render(<App />)

    await user.click(screen.getByText('Revenue rose.'))
    await user.keyboard('m')
    expect(screen.queryByRole('article', { name: /^Prompt cell/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Made the cell a note')

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useNotebook.getState().notebook.cells[1]).toEqual(original)
    expect(screen.getByText('Revenue rose.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a failed save instead of dropping it', async () => {
    const { api } = fakeApi(() => result())
    let menu!: (action: 'save') => void
    api.onMenu = (l) => {
      menu = l
      return () => {}
    }
    api.saveNotebook = async () => {
      throw new Error("Error invoking remote method 'save-notebook': Error: EACCES: permission denied")
    }
    setApi(api)
    render(<App />)
    await waitFor(() => expect(menu).toBeDefined())
    menu('save')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save the notebook. EACCES: permission denied")
    expect(useNotebook.getState().dirty).toBe(false)
  })

  it('keeps the notebook up when one cell fails to draw, and Retry draws it again', async () => {
    const user = userEvent.setup()
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    setApi(fakeApi(() => result()).api)
    // A cell from a damaged file, with no outputs list
    const broken = { ...newPromptCell('Broken', 'x = 1'), outputs: null } as unknown as PromptCell
    actions.load({ cells: [newNoteCell('# Sales review'), broken] }, null)
    render(<App />)

    expect(screen.getByRole('alert')).toHaveTextContent("This cell couldn't be shown.")
    expect(screen.getByRole('heading', { name: 'Sales review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run all' })).toBeInTheDocument()

    useNotebook.setState((s) => ({ notebook: { cells: s.notebook.cells.map((c) => (c.id === broken.id ? { ...broken, outputs: [] } : c)) } }))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Broken')
    quiet.mockRestore()
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
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))

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
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))
    expect(await screen.findByRole('cell', { name: 'C0001' })).toBeInTheDocument()
  })

  it('folds and unfolds with T, and Hide folds it again', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result({ answer: 'C0001 spent the most.', outputs: [table] })).api)
    render(<App />)
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Top customers')
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))
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
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))
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
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))
    const list = await screen.findByRole('list', { name: 'Suggested next prompts' })
    await user.click(within(list).getByRole('button', { name: 'Plot revenue by month' }))

    expect(await screen.findByText('Here is the chart.')).toBeInTheDocument()
    expect(requests.map((r) => r.prompt)).toEqual(['Revenue by month', 'Plot revenue by month'])
    // The empty cell below the first one is reused rather than stacking a new one
    expect(screen.getAllByRole('article', { name: /^Prompt cell/ })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /Activity/ }))
    expect(screen.getByRole('list', { name: 'Run log' })).toHaveTextContent('Wrote “Plot revenue by month”')
  })

  it('renames the notebook from its name at the top of the overview', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    const calls: unknown[][] = []
    api.renameNotebook = async (current, name) => {
      calls.push([current, name])
      return { path: `/work/${name}.ipynb`, saved: false }
    }
    setApi(api)
    actions.load({ cells: [newPromptCell('Total sales')] }, '/work/Untitled.ipynb')
    render(<App />)

    // Only the heading of the overview renames. The tab in the top bar keeps opening the recent notebooks
    expect(screen.getAllByRole('button', { name: /Notebook name/ })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /Notebook name: Untitled/ }))
    const field = screen.getByRole('textbox', { name: 'Notebook name' })
    expect(field).toHaveValue('Untitled')
    await user.clear(field)
    await user.type(field, 'Survival readout.ipynb{Enter}')

    expect(calls).toEqual([['/work/Untitled.ipynb', 'Survival readout']])
    expect(await screen.findByRole('button', { name: /Notebook name: Survival readout/ })).toBeInTheDocument()
    expect(useNotebook.getState().path).toBe('/work/Survival readout.ipynb')
  })

  it('keeps the name field open with the reason when a name is refused, and Esc puts the old name back', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    api.renameNotebook = async (_c, name) => ({ error: `There is already a notebook called "${name}" in this folder.` })
    setApi(api)
    actions.load({ cells: [newPromptCell('Total sales')] }, '/work/Untitled.ipynb')
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Notebook name: Untitled/ }))
    await user.clear(screen.getByRole('textbox', { name: 'Notebook name' }))
    await user.type(screen.getByRole('textbox', { name: 'Notebook name' }), 'Taken{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('There is already a notebook called "Taken"')
    expect(screen.getByRole('textbox', { name: 'Notebook name' })).toHaveValue('Taken')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Notebook name' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Notebook name: Untitled/ })).toBeInTheDocument()
    expect(useNotebook.getState().path).toBe('/work/Untitled.ipynb')
  })

  it('shows an error when the rename call itself fails, and names an unsaved notebook by writing it', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    let fail = true
    api.renameNotebook = async (current, name) => {
      if (fail) throw new Error('ipc closed')
      return { path: `/work/${name}.ipynb`, saved: current == null }
    }
    setApi(api)
    actions.load({ cells: [newPromptCell('Total sales')] }, null)
    useNotebook.setState({ dirty: true })
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Notebook name: Untitled/ }))
    await user.type(screen.getByRole('textbox', { name: 'Notebook name' }), '{Control>}a{/Control}Trials{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't rename the notebook: ipc closed")

    fail = false
    await user.type(screen.getByRole('textbox', { name: 'Notebook name' }), '{Enter}')
    await vi.waitFor(() => expect(useNotebook.getState()).toMatchObject({ path: '/work/Trials.ipynb', dirty: false }))
  })

  it('keeps earlier versions of a cell and restores one', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi((req) => result({ code: req.prompt === 'Total sales' ? 'orders.total.sum()' : 'orders.total.mean()' }))
    setApi(api)
    render(<App />)

    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    await user.type(prompt, 'Total sales')
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))
    await screen.findByRole('tab', { name: 'Code' })
    await user.clear(prompt)
    await user.type(prompt, 'Average sale')
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))
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
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))
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
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))
    const outline = screen.getByRole('complementary', { name: 'Overview' })
    expect(await within(outline).findByRole('button', { name: 'Return rate by category' })).toBeInTheDocument()
    expect(requests[0].nameIt).toBe(true)

    // Rerunning the same prompt doesn't ask again, and editing it shows the prompt until it's named anew
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))
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

/** The fake bridge, with a handle on the menu the main process would drive. */
function withMenu(api: ReturnType<typeof fakeApi>['api']) {
  const menu: { send?: (action: string) => void } = {}
  api.onMenu = (l) => {
    menu.send = l as (action: string) => void
    return () => {}
  }
  return menu
}

describe('command mode', () => {
  it('ignores command keys on buttons in the overview and side panes, so D D there deletes nothing', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result()).api)
    render(<App />)
    const count = () => screen.getAllByRole('article').length
    const cells = count()

    await user.click(screen.getByRole('button', { name: /^Variables/ }))
    expect(screen.getByRole('button', { name: /^Variables/ })).toHaveFocus()
    await user.keyboard('dd')
    expect(count()).toBe(cells)
    within(screen.getByRole('region', { name: 'Variables' })).getByRole('button', { name: 'Refresh' }).focus()
    await user.keyboard('dd')
    expect(count()).toBe(cells)

    // In the notebook they still act on the selected cell
    await user.click(screen.getByRole('heading', { name: 'Sales review' }))
    await user.keyboard('dd')
    expect(count()).toBe(cells - 1)
  })
})

describe('switching notebooks', () => {
  it('stops a running cell before another notebook opens, and its result never lands there', async () => {
    const user = userEvent.setup()
    let release!: () => void
    const { api } = fakeApi(() => new Promise((resolve) => (release = () => resolve(result({ answer: 'A late answer.' })))))
    let interrupts = 0
    api.interrupt = async () => void interrupts++
    api.openNotebook = async () => ({ notebook: { cells: [newPromptCell('Another notebook')] }, path: '/tmp/other.ipynb' })
    const menu = withMenu(api)
    setApi(api)
    render(<App />)

    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Slow sum')
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))
    await waitFor(() => expect(Object.values(useNotebook.getState().runs)[0]?.status).toBe('running'))
    menu.send!('open')

    expect(await screen.findByDisplayValue('Another notebook')).toBeInTheDocument()
    expect(interrupts).toBe(1)
    release()
    await waitFor(() => expect(useNotebook.getState().runs).toEqual({}))
    expect(screen.queryByText('A late answer.')).not.toBeInTheDocument()
    expect(useNotebook.getState()).toMatchObject({ dirty: false, log: [] })
  })
})

describe('narrow windows', () => {
  it('opens a side pane over the notebook, and Esc or a click outside closes it', async () => {
    const user = userEvent.setup()
    const matchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({ ...matchMedia(query), matches: query === '(max-width: 1199px)' })) as typeof window.matchMedia
    try {
      setApi(fakeApi(() => result()).api)
      render(<App />)
      await user.click(screen.getByRole('button', { name: /^Variables/ }))
      expect(screen.getByRole('region', { name: 'Variables' })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('region', { name: 'Variables' })).not.toBeInTheDocument()
      // Focus goes back to the button that opened it
      expect(screen.getByRole('button', { name: /^Variables/ })).toHaveFocus()

      await user.click(screen.getByRole('button', { name: /^Variables/ }))
      await user.click(screen.getByTestId('pane-scrim'))
      expect(screen.queryByRole('region', { name: 'Variables' })).not.toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeInTheDocument()
    } finally {
      window.matchMedia = matchMedia
    }
  })
})

describe('undo and redo', () => {
  // One clock for the whole block: every Undo looks simultaneous with the one before, as on a fast machine, so
  // state left over from an earlier test would swallow the next menu Undo here, not only in CI
  beforeEach(() => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    onTestFinished(() => now.mockRestore())
  })

  it('undoes and redoes a delete and a move with Cmd+Z and Shift+Cmd+Z in command mode', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result()).api)
    render(<App />)
    const kinds = () => screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))

    await user.click(screen.getByRole('heading', { name: 'Sales review' }))
    await user.keyboard('dd')
    expect(kinds()).toEqual(['Prompt cell 1'])
    await user.keyboard('{Meta>}z{/Meta}')
    expect(kinds()).toEqual(['Note', 'Prompt cell 1'])
    expect(screen.queryByText('Cell deleted')).not.toBeInTheDocument()
    await user.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}')
    expect(kinds()).toEqual(['Prompt cell 1'])
    await user.keyboard('{Control>}z{/Control}')
    expect(kinds()).toEqual(['Note', 'Prompt cell 1'])

    await user.click(within(screen.getByRole('article', { name: 'Note' })).getByRole('button', { name: 'Move down' }))
    expect(kinds()).toEqual(['Prompt cell 1', 'Note'])
    await user.keyboard('{Meta>}z{/Meta}')
    expect(kinds()).toEqual(['Note', 'Prompt cell 1'])
  })

  it('leaves Cmd+Z to a text field, and the menu asks the field to undo', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    const menu = withMenu(api)
    setApi(api)
    const execCommand = vi.fn(() => true)
    const original = document.execCommand
    document.execCommand = execCommand
    onTestFinished(() => void (document.execCommand = original))
    render(<App />)

    await user.click(screen.getByRole('heading', { name: 'Sales review' }))
    await user.keyboard('dd')
    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    await user.click(prompt)
    await user.keyboard('{Meta>}z{/Meta}')
    expect(screen.queryByRole('heading', { name: 'Sales review' })).not.toBeInTheDocument()
    menu.send!('undo')
    expect(execCommand).toHaveBeenCalledWith('undo')
    expect(screen.queryByRole('heading', { name: 'Sales review' })).not.toBeInTheDocument()

    // Outside a text field the menu undoes the notebook edit
    prompt.blur()
    act(() => menu.send!('undo'))
    expect(screen.getByRole('heading', { name: 'Sales review' })).toBeInTheDocument()
    act(() => menu.send!('redo'))
    expect(screen.queryByRole('heading', { name: 'Sales review' })).not.toBeInTheDocument()
  })

  it('offers Undo in the notice after D D, from the same stack as Cmd+Z', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result()).api)
    render(<App />)
    await user.click(screen.getByRole('heading', { name: 'Sales review' }))
    await user.keyboard('dd')
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('heading', { name: 'Sales review' })).toBeInTheDocument()
    // Redo deletes it again: the notice's Undo went through the stack
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true, shiftKey: true })
    expect(screen.queryByRole('heading', { name: 'Sales review' })).not.toBeInTheDocument()
  })
})

describe('accessibility', () => {
  it('names each run button after its cell and keeps its count readable', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result()).api)
    actions.load({ cells: [newNoteCell('# Sales review'), newPromptCell('First'), newPromptCell('Second')] }, null)
    render(<App />)
    expect(screen.getByRole('button', { name: 'Run cell 2' })).toHaveAccessibleDescription('Not run yet')
    await user.click(screen.getByRole('button', { name: 'Run cell 2' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run cell 2' })).toHaveAccessibleDescription('Execution count 1'))
    expect(screen.getByRole('button', { name: 'Run cell 1' })).toHaveAccessibleDescription('Not run yet')
  })

  it('reaches a note by keyboard and opens it with Enter, keeping its heading a heading', async () => {
    const user = userEvent.setup()
    setApi(fakeApi(() => result()).api)
    render(<App />)
    const heading = screen.getByRole('heading', { level: 1, name: 'Sales review' })
    const preview = heading.parentElement!
    expect(preview).toHaveAttribute('tabindex', '0')
    expect(preview).toHaveAccessibleDescription('Press Enter to edit this note.')
    preview.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('heading', { name: 'Sales review' }).parentElement).toHaveFocus()
  })

  it('says each status in words in the overview, and announces only when a run ends', async () => {
    const user = userEvent.setup()
    let release!: () => void
    setApi(fakeApi(() => new Promise((resolve) => (release = () => resolve(result({ ok: false, outputs: [{ type: 'error', ename: 'KeyError', evalue: 'x', traceback: [] }] }))))).api)
    render(<App />)
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Total sales by region')
    await user.click(screen.getByRole('button', { name: 'Run cell 1' }))
    const overview = screen.getByRole('complementary', { name: 'Overview' })
    const live = overview.querySelector('[aria-live]')!
    await within(overview).findByRole('button', { name: /, running$/ })
    expect(live).toHaveTextContent('')

    release()
    expect(await within(overview).findByRole('button', { name: 'Total sales by region, failed' })).toBeInTheDocument()
    expect(within(overview).getByRole('button', { name: 'Cell 1, Total sales by region: failed' })).toBeInTheDocument()
    expect(live).toHaveTextContent('Finished running. 0 of 1 cells up to date, 1 failed.')
  })
})
