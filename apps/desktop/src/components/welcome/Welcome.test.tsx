import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
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
})
