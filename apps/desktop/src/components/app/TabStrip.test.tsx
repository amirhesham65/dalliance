import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DocumentState, PythonState, SettingsView, TabInfo } from '@dalliance/shared/ipc'
import { newPromptCell } from '@dalliance/shared/notebook'
import App from '@/App'
import { actions, setApi, useNotebook } from '@/store/notebook-store'
import { fakeApi, fakeSettings, fakeTabs, result } from '@/test/fake-api'

const tab = (id: string, title: string, more: Partial<TabInfo> = {}): TabInfo => ({ id, title, path: `/work/${title}.ipynb`, dirty: false, running: false, ...more })

function setup(list: TabInfo[] = [tab('tab-1', 'readout'), tab('tab-2', 'cohorts', { dirty: true }), tab('tab-3', 'Adverse events by grade', { running: true })]) {
  const fake = fakeApi(() => result())
  const tabs = fakeTabs(list)
  Object.assign(fake.api, tabs.api)
  setApi(fake.api)
  render(<App />)
  return { ...fake, tabs }
}

const strip = () => screen.getByRole('tablist', { name: 'Notebooks' })

beforeEach(() => {
  useNotebook.setState({ tabs: null })
  actions.load({ cells: [newPromptCell('')] }, '/work/readout.ipynb')
  actions.closeSettings()
})

describe('the tab strip', () => {
  it('shows every notebook open in the window, with unsaved changes and running cells marked', async () => {
    setup()
    const tabs = await within(await screen.findByRole('tablist', { name: 'Notebooks' })).findAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(['readout', 'cohorts, unsaved changes', 'Adverse events by grade, running'])
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(within(tabs[1]).getByTestId('tab-dirty')).toBeInTheDocument()
    expect(within(tabs[2]).getByTestId('tab-running')).toBeInTheDocument()
    expect(within(tabs[0]).queryByTestId('tab-dirty')).not.toBeInTheDocument()
    // A long name is cut short on screen, and the whole path is in the tooltip
    expect(tabs[2]).toHaveAttribute('title', '/work/Adverse events by grade.ipynb')
    // Only one tab is in the Tab order: the one showing
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1])
  })

  it('switches on a click, closes on a middle click or the cross, and opens a tab with +', async () => {
    const user = userEvent.setup()
    const { tabs } = setup()
    await user.click(await screen.findByRole('tab', { name: 'cohorts, unsaved changes' }))
    expect(tabs.calls).toEqual([['switch', 'tab-2']])
    expect(screen.getByRole('tab', { name: 'cohorts, unsaved changes' })).toHaveAttribute('aria-selected', 'true')

    fireEvent(screen.getByRole('tab', { name: 'readout' }), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(tabs.calls.at(-1)).toEqual(['close', 'tab-1'])
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'readout' })).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Close Adverse events by grade' }))
    expect(tabs.calls.at(-1)).toEqual(['close', 'tab-3'])

    await user.click(screen.getByRole('button', { name: 'New tab' }))
    expect(tabs.calls.at(-1)).toEqual(['new'])
    expect(await screen.findByRole('tab', { name: 'Untitled', selected: true })).toBeInTheDocument()
  })

  it('moves focus with the arrow keys, Home and End, and shows the focused tab on Enter', async () => {
    const user = userEvent.setup()
    const { tabs } = setup()
    const first = await screen.findByRole('tab', { name: 'readout' })
    act(() => first.focus())
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'cohorts, unsaved changes' })).toHaveFocus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(first).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Adverse events by grade, running' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Adverse events by grade, running' }).tabIndex).toBe(0)
    await user.keyboard('{Home}')
    expect(first).toHaveFocus()
    await user.keyboard('{End}{Enter}')
    expect(tabs.calls).toEqual([['switch', 'tab-3']])
    // Moving focus never switched on its own
    expect(tabs.calls).toHaveLength(1)
    await user.keyboard('{Delete}')
    expect(tabs.calls.at(-1)).toEqual(['close', 'tab-3'])
  })

  it('keeps up with the list the main process sends', async () => {
    const { tabs } = setup([tab('tab-1', 'readout')])
    await screen.findByRole('tab', { name: 'readout' })
    act(() => tabs.set({ tabs: [tab('tab-1', 'readout', { dirty: true }), tab('tab-2', 'Untitled', { path: null })], activeId: 'tab-2' }))
    expect(within(strip()).getAllByRole('tab').map((t) => t.getAttribute('aria-label'))).toEqual(['readout, unsaved changes', 'Untitled'])
    expect(screen.getByRole('tab', { name: 'Untitled' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Untitled' })).toHaveAttribute('title', 'Untitled')
  })

  it('tells the main process when this tab has cells running, for its indicator', async () => {
    let finish!: () => void
    const { api } = setup()
    api.runCell = () => new Promise((resolve) => (finish = () => resolve(result())))
    const reports: DocumentState[] = []
    api.setDocumentState = (state) => reports.push(state)
    const cell = newPromptCell('Total sales')
    act(() => actions.load({ cells: [cell] }, '/work/readout.ipynb'))
    act(() => actions.run(cell.id))
    await waitFor(() => expect(reports.at(-1)).toMatchObject({ path: '/work/readout.ipynb', running: true }))
    await act(async () => finish())
    await waitFor(() => expect(reports.at(-1)).toMatchObject({ running: false }))
  })

  it('stays out of the first-run setup', async () => {
    const { api } = setup()
    await screen.findByRole('tablist', { name: 'Notebooks' })
    act(() => useNotebook.setState({ settings: { ...fakeSettings(), onboarded: false } }))
    expect(screen.queryByRole('tablist', { name: 'Notebooks' })).not.toBeInTheDocument()
    expect(api).toBeDefined()
  })
})

describe('changes made in another tab', () => {
  it('shows settings and the Python another tab changed', async () => {
    const fake = fakeApi(() => result())
    let settingsChanged!: (view: SettingsView) => void
    let pythonChanged!: (state: PythonState) => void
    fake.api.onSettingsChanged = (l) => {
      settingsChanged = l
      return () => {}
    }
    fake.api.onPythonState = (l) => {
      pythonChanged = l
      return () => {}
    }
    setApi(fake.api)
    render(<App />)
    await waitFor(() => expect(settingsChanged).toBeDefined())
    act(() => settingsChanged({ ...fakeSettings(), model: 'anthropic/claude-sonnet-5' }))
    expect(useNotebook.getState().settings?.model).toBe('anthropic/claude-sonnet-5')
    const python: PythonState = { python: '/env/bin/python', version: '3.13.0', source: 'managed', managedEnvExists: true, missingPackages: [] }
    act(() => pythonChanged(python))
    expect(useNotebook.getState().python).toEqual(python)
  })
})
