import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AppView } from '@dalliance/shared/apps'
import { newPromptCell } from '@dalliance/shared/notebook'
import { TooltipProvider } from '@/components/ui/tooltip'
import { actions, setApi, useNotebook } from '@/store/notebook-store'
import { appActions, useApps } from '@/store/apps-store'
import { fakeApi, result } from '@/test/fake-api'
import { AppsPane } from './AppsPane'
import { AppShell } from './AppShell'

const source = newPromptCell('Create a sales explorer')
const app: AppView = { version: 1, id: 'sales', title: 'Sales explorer', description: 'Filter sales by month', entry: 'app.py', sourceCellId: source.id, sourceNotebook: 'Sales.ipynb', requirements: ['streamlit', 'pandas'], snapshots: [{ variable: 'sales', file: 'data/sales.csv', exportedAt: '2026-10-27T12:00:00Z' }], updatedAt: '2026-10-27T12:00:00Z', status: 'stopped', url: null, logs: '', error: null }

beforeEach(() => {
  actions.load({ cells: [source] }, '/project/Sales.ipynb')
  useApps.setState({ workspace: '/project', apps: [app], selectedId: null, showing: false, error: null, busy: {}, loading: false })
})

it('opens a stopped app, keeps its iframe and session when hidden, and stops it explicitly', async () => {
  const { api } = fakeApi(() => result())
  let view = app
  api.listApps = async () => [view]
  api.startApp = vi.fn(async () => (view = { ...app, status: 'running', url: 'http://127.0.0.1:54321' }))
  api.stopApp = vi.fn(async () => { view = app })
  setApi(api)
  render(<TooltipProvider><AppsPane /><AppShell /></TooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: /Sales explorer/ }))
  await waitFor(() => expect(api.startApp).toHaveBeenCalledWith('sales'))
  const frame = await screen.findByTitle('Sales explorer')
  expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads')
  expect(frame).toHaveAttribute('src', 'http://127.0.0.1:54321/?embed=true')
  fireEvent.click(screen.getByRole('button', { name: 'Back to notebook' }))
  expect(frame).toBeInTheDocument()
  expect(frame).not.toBeVisible()
  await act(() => appActions.open('sales'))
  expect(screen.getByTitle('Sales explorer')).toBe(frame)
  expect(api.startApp).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Stop app' }))
  await waitFor(() => expect(screen.queryByTitle('Sales explorer')).not.toBeInTheDocument())
  expect(api.stopApp).toHaveBeenCalledWith('sales')
})

it('shows snapshot provenance, reveals source files, and creates a new prompt to fix an app', async () => {
  const { api } = fakeApi(() => result())
  api.listApps = async () => [app]
  api.revealFile = vi.fn(async () => {})
  setApi(api)
  useApps.setState({ selectedId: app.id, showing: true })
  render(<TooltipProvider><AppShell /></TooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'App files and snapshots' }))
  expect(within(screen.getByRole('list', { name: 'Saved snapshots' })).getByText(/data\/sales.csv from @sales/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'apps/sales/app.py' }))
  expect(api.revealFile).toHaveBeenCalledWith('apps/sales/app.py')
  fireEvent.click(screen.getByRole('button', { name: 'Edit or fix this app' }))
  expect(useApps.getState().showing).toBe(false)
  const cells = useNotebook.getState().notebook.cells
  expect(cells).toHaveLength(2)
  expect(cells[1]).toMatchObject({ prompt: expect.stringContaining('id: sales') })
})

it('drops a late list response when a different project opens', async () => {
  const { api } = fakeApi(() => result())
  let resolve!: (apps: AppView[]) => void
  api.listApps = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done })).mockResolvedValue([])
  setApi(api)
  const first = appActions.refresh()
  appActions.workspace('/other-project')
  resolve([app])
  await first
  await waitFor(() => expect(useApps.getState().loading).toBe(false))
  expect(useApps.getState().apps).toEqual([])
  expect(useApps.getState().showing).toBe(false)
})

it('refreshes snapshot data without editing the notebook and deletes only after bridge confirmation', async () => {
  const { api } = fakeApi(() => result())
  let apps = [{ ...app, dataState: 'changed' as const }]
  api.listApps = async () => apps
  api.refreshAppData = vi.fn(async () => {})
  api.deleteApp = vi.fn(async () => { apps = []; return true })
  setApi(api)
  useApps.setState({ selectedId: app.id, showing: true, apps })
  render(<TooltipProvider><AppShell /></TooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }))
  await waitFor(() => expect(api.refreshAppData).toHaveBeenCalledWith(app.id))
  expect(useNotebook.getState().notebook.cells).toEqual([source])
  fireEvent.click(screen.getByRole('button', { name: 'App files and snapshots' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete app' }))
  await waitFor(() => expect(api.deleteApp).toHaveBeenCalledWith(app.id))
  expect(useApps.getState().showing).toBe(false)
  expect(useNotebook.getState().notebook.cells).toEqual([source])
})
