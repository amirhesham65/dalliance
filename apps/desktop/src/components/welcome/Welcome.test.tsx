import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { MenuAction, SettingsUpdate, SettingsView } from '@dalliance/shared/ipc'
import { newPromptCell } from '@dalliance/shared/notebook'
import { actions, setApi, useNotebook } from '@/store/notebook-store'
import { SIGNED_OUT, fakeApi, fakeSettings, result } from '@/test/fake-api'

beforeEach(() => {
  actions.load({ cells: [newPromptCell('')] }, null)
  useNotebook.setState({ settings: null, newProject: false })
})

function setup(settings: Partial<SettingsView> = {}, { signedIn = true } = {}) {
  const fake = fakeApi(() => result({ answer: 'Seven is the most common total.' }))
  if (!signedIn) fake.api.getAccount = async () => SIGNED_OUT
  let current = { ...fakeSettings(), ...settings }
  const updates: SettingsUpdate[] = []
  let menu: ((action: MenuAction) => void) | undefined
  fake.api.getSettings = async () => current
  fake.api.updateSettings = async (u) => {
    updates.push(u)
    current = { ...current, ...u }
    return current
  }
  fake.api.onMenu = (l) => {
    menu = l
    return () => {}
  }
  fake.api.recentNotebooks = async () => [{ path: '/work/review.ipynb', name: 'review', folder: 'work', openedAt: Date.now() }]
  setApi(fake.api)
  return { ...fake, updates, menu: (action: MenuAction) => act(() => menu?.(action)) }
}

describe('Welcome', () => {
  it('walks a first launch through setup, and remembers when it is skipped', async () => {
    const user = userEvent.setup()
    const { updates } = setup({ onboarded: false }, { signedIn: false })
    actions.showWelcome(false)
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Write what you want to know' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(screen.getByRole('heading', { name: 'Sign in to Dalliance' })).toBeInTheDocument()
    // Signed out, the step can still be passed over
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Set up later' }))
    expect(updates).toContainEqual({ onboarded: true })
    expect(await screen.findByRole('heading', { name: 'Before your first run' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /review/ })).toBeInTheDocument()
  })

  it('signs in from the setup, and goes on once the account is on a plan', async () => {
    const user = userEvent.setup()
    setup({ onboarded: false }, { signedIn: false })
    actions.showWelcome(false)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /Continue/ }))
    expect(screen.getByText(/Sign in with your email/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/Pro plan/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue/ })).toBeInTheDocument()
  })

  it('opens a starter prompt as a new notebook and runs it', async () => {
    const user = userEvent.setup()
    const { requests } = setup()
    actions.showWelcome(false)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /Roll two dice/ }))
    expect(await screen.findByText('Seven is the most common total.')).toBeInTheDocument()
    expect(requests[0]).toMatchObject({ prompt: expect.stringMatching(/^Roll two dice/), generate: true })
    expect(useNotebook.getState().screen).toBe('notebook')
  })

  it('opens from the Help menu over a notebook and goes back to it', async () => {
    const user = userEvent.setup()
    const { menu } = setup()
    render(<App />)
    expect(await screen.findByRole('textbox', { name: 'Prompt' })).toBeInTheDocument()

    menu('welcome')
    await user.click(await screen.findByRole('button', { name: 'Back to Untitled' }))
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeInTheDocument()
  })

  it('makes a new notebook a file in the folder in use, with a path from the start', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const made: unknown[] = []
    api.newNotebook = async (notebook) => {
      made.push(notebook)
      return { path: '/work/Untitled 2.ipynb', notebook }
    }
    actions.showWelcome(false)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /New notebook/ }))
    expect(made).toHaveLength(1)
    expect(useNotebook.getState()).toMatchObject({ path: '/work/Untitled 2.ipynb', screen: 'notebook' })
  })

  it('opens the project that was picked, and stays put when the dialog is cancelled', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    let picked: string | null = null
    api.openProject = async (notebook) => (picked ? { path: `${picked}/survival.ipynb`, notebook } : null)
    actions.showWelcome(false)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /Open project/ }))
    expect(useNotebook.getState()).toMatchObject({ path: null, screen: 'welcome' })

    picked = '/work/trials'
    await user.click(screen.getByRole('button', { name: /Open project/ }))
    expect(useNotebook.getState()).toMatchObject({ path: '/work/trials/survival.ipynb', screen: 'notebook' })
  })

  it('opens a project from the File menu', async () => {
    const { api, menu } = setup()
    api.openProject = async (notebook) => ({ path: '/work/menu/Untitled.ipynb', notebook })
    render(<App />)
    expect(await screen.findByRole('textbox', { name: 'Prompt' })).toBeInTheDocument()

    menu('open-project')
    await vi.waitFor(() => expect(useNotebook.getState().path).toBe('/work/menu/Untitled.ipynb'))
  })

  it('creates a project from a name, where projects go, and opens its first notebook', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const made: string[] = []
    api.createProject = async (name, notebook) => {
      made.push(name)
      return { path: `/tmp/projects/${name}/${name}.ipynb`, notebook }
    }
    actions.showWelcome(false)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /New project/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled()
    expect(await within(dialog).findByText('/tmp/projects', { exact: false })).toBeInTheDocument()

    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Churn{Enter}')
    expect(made).toEqual(['Churn'])
    expect(useNotebook.getState()).toMatchObject({ path: '/tmp/projects/Churn/Churn.ipynb', screen: 'notebook', newProject: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the dialog open with the reason when a project name is refused', async () => {
    const user = userEvent.setup()
    const { api, menu } = setup()
    api.createProject = async () => ({ error: 'There is already a folder called "Churn" there.' })
    render(<App />)
    expect(await screen.findByRole('textbox', { name: 'Prompt' })).toBeInTheDocument()

    menu('new-project')
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Churn')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already a folder called "Churn"')
    expect(useNotebook.getState().path).toBeNull()
  })

  it('creates nothing when unsaved changes are kept', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    let made = 0
    api.confirmDiscard = async () => false
    api.createProject = async (name, notebook) => {
      made++
      return { path: `/tmp/projects/${name}/${name}.ipynb`, notebook }
    }
    actions.showWelcome(false)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /New project/ }))
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Churn{Enter}')
    expect(made).toBe(0)
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument()
  })

  it('stays on the start page when a notebook could not be created', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    // The main process has shown the reason in a dialog by the time it answers null
    api.newNotebook = async () => null
    actions.showWelcome(false)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /New notebook/ }))
    expect(useNotebook.getState()).toMatchObject({ path: null, screen: 'welcome' })
  })
})
