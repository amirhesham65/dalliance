import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { AppView } from '@dalliance/shared/apps'
import { appActions, useApps } from '@/store/apps-store'
import { actions, setApi } from '@/store/notebook-store'
import { fakeApi, result } from '@/test/fake-api'
import { AppLifecycle } from './AppLifecycle'

it('reports visibility, warns before an idle stop and offers Keep running only for an idle background app', async () => {
  const app: AppView = { version: 1, id: 'sales', title: 'Sales', description: '', entry: 'app.py', sourceCellId: 'c1', sourceNotebook: 'Sales.ipynb', requirements: [], snapshots: [], updatedAt: '', status: 'running', url: 'http://127.0.0.1:54321', error: null, logs: '', busy: false, idleStopAt: Date.now() + 30_000 }
  const { api } = fakeApi(() => result())
  api.listApps = async () => [app]
  api.setVisibleApp = vi.fn()
  api.keepAppRunning = vi.fn(async () => {})
  setApi(api)
  actions.load({ cells: [] }, '/project/Sales.ipynb')
  actions.closeSettings()
  useApps.setState({ apps: [app], showing: false, selectedId: 'sales', busy: {} })
  render(<AppLifecycle />)
  expect(screen.getByRole('status')).toHaveTextContent('will stop after inactivity')
  expect(api.setVisibleApp).toHaveBeenCalledWith(null)
  fireEvent.click(screen.getByRole('button', { name: 'Keep running' }))
  await waitFor(() => expect(api.keepAppRunning).toHaveBeenCalledWith('sales', true))
  act(() => useApps.setState({ showing: true }))
  expect(api.setVisibleApp).toHaveBeenCalledWith('sales')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  act(() => { appActions.notebook(); useApps.setState({ apps: [{ ...app, busy: true }] }) })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
