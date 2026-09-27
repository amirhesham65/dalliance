import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import type { MenuAction, SettingsView } from '@dalliance/shared/ipc'
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
  const updates: unknown[] = []
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
