import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { MenuAction, SettingsUpdate, SettingsView } from '@dalliance/shared/ipc'
import { newPromptCell } from '@dalliance/shared/notebook'
import { actions, setApi, useNotebook } from '@/store/notebook-store'
import { fakeApi, fakeSettings, result } from '@/test/fake-api'

beforeEach(() => {
  actions.load({ cells: [newPromptCell('')] }, null)
  useNotebook.setState({ settings: null })
})

function setup(settings: Partial<SettingsView> = {}) {
  const fake = fakeApi(() => result({ answer: 'Seven is the most common total.' }))
  let current = { ...fakeSettings(), ...settings }
  const updates: SettingsUpdate[] = []
  let menu: ((action: MenuAction) => void) | undefined
  fake.api.getSettings = async () => current
  fake.api.updateSettings = async ({ apiKey, ...u }) => {
    updates.push(apiKey ? { ...u, apiKey } : u)
    current = { ...current, ...u, ...(apiKey ? { keySource: 'settings' as const } : {}) }
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
    const { updates } = setup({ onboarded: false, keySource: null })
    actions.showWelcome(false)
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Write what you want to know' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(screen.getByRole('heading', { name: 'Connect a model' })).toBeInTheDocument()
    // Without a key the step can still be passed over
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Set up later' }))
    expect(updates).toContainEqual({ onboarded: true })
    expect(await screen.findByRole('heading', { name: 'Before your first run' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /review/ })).toBeInTheDocument()
  })

  it('checks a pasted key and files it under the provider it belongs to', async () => {
    const user = userEvent.setup()
    const { api, updates } = setup({ onboarded: false, keySource: null, hasKey: { gateway: false, anthropic: false } })
    api.checkKey = async (_provider, key) => (key.includes('wrong') ? { status: 'rejected', detail: 'Turned down.' } : { status: 'ok', detail: null })
    actions.showWelcome(false)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /Continue/ }))
    expect(screen.getByRole('link', { name: /Get a key from Vercel/ })).toHaveAttribute('href', expect.stringContaining('vercel.com'))

    // A rejected key stays unsaved, with the reason under the field
    await user.type(screen.getByLabelText('AI Gateway key'), 'vck_wrong')
    await user.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Turned down.')
    expect(updates.some((u) => 'apiKey' in u)).toBe(false)

    // An Anthropic key pasted with the gateway chosen switches the provider
    await user.clear(screen.getByLabelText('AI Gateway key'))
    await user.type(screen.getByLabelText('AI Gateway key'), 'sk-ant-123')
    expect(await screen.findByRole('radio', { name: /Anthropic API/, checked: true })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByText('Key saved in your system keychain.')).toBeInTheDocument()
    expect(screen.getByText('Key works.')).toBeInTheDocument()
    expect(updates).toContainEqual({ provider: 'anthropic', apiKey: { provider: 'anthropic', key: 'sk-ant-123' } })
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

  it('starts a notebook in the folder that was picked, and stays put when the dialog is cancelled', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    let picked: string | null = null
    api.openFolder = async (notebook) => (picked ? { path: `${picked}/Untitled.ipynb`, notebook } : null)
    actions.showWelcome(false)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /Open folder/ }))
    expect(useNotebook.getState()).toMatchObject({ path: null, screen: 'welcome' })

    picked = '/work/trials'
    await user.click(screen.getByRole('button', { name: /Open folder/ }))
    expect(useNotebook.getState()).toMatchObject({ path: '/work/trials/Untitled.ipynb', screen: 'notebook' })
  })

  it('opens a folder from the File menu', async () => {
    const { api, menu } = setup()
    api.openFolder = async (notebook) => ({ path: '/work/menu/Untitled.ipynb', notebook })
    render(<App />)
    expect(await screen.findByRole('textbox', { name: 'Prompt' })).toBeInTheDocument()

    menu('open-folder')
    await vi.waitFor(() => expect(useNotebook.getState().path).toBe('/work/menu/Untitled.ipynb'))
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
