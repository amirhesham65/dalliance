import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { MODELS, providerOf } from '@dalliance/shared/models'
import { NO_KEYS, fakeApi, fakeSettings, result } from '@/test/fake-api'
import { setApi, useNotebook } from '@/store/notebook-store'
import { ModelSettings } from './ModelSettings'

beforeEach(() => useNotebook.setState({ providerKeys: NO_KEYS, models: null, settings: fakeSettings() }))

describe('ModelSettings', () => {
  it('keeps Anthropic and OpenAI connected together and removes only the requested key', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    setApi(api)
    let keys = structuredClone(NO_KEYS)
    api.setProviderKey = async (provider, key) => {
      keys = { ...keys, configured: { ...keys.configured, [provider]: Boolean(key) } }
      return keys
    }
    api.listModels = async () => ({ models: MODELS.filter((model) => keys.configured[providerOf(model.id)!]), error: null })
    render(<ModelSettings api={api} settings={fakeSettings()} />)
    const anthropic = within(screen.getByRole('form', { name: 'Anthropic connection' }))
    const openai = within(screen.getByRole('form', { name: 'OpenAI connection' }))
    await user.type(screen.getByLabelText('Anthropic API key'), 'test-anthropic-key')
    await user.click(anthropic.getByRole('button', { name: 'Save key' }))
    await user.type(screen.getByLabelText('OpenAI API key'), 'test-openai-key')
    await user.click(openai.getByRole('button', { name: 'Save key' }))
    expect(screen.getByText('Anthropic key added')).toBeInTheDocument()
    expect(screen.getByText('OpenAI key added')).toBeInTheDocument()
    expect(screen.getByText('Google not connected')).toBeInTheDocument()
    expect(useNotebook.getState().models?.models.map((m) => providerOf(m.id))).toEqual(expect.arrayContaining(['anthropic', 'openai']))
    expect(useNotebook.getState().settings?.model).toBe(fakeSettings().model)
    screen.getByRole('combobox', { name: 'Suggested model' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(MODELS.filter((model) => providerOf(model.id) !== 'google').map((model) => model.name))
    await user.keyboard('{Escape}')
    await user.click(anthropic.getByRole('button', { name: 'Remove key' }))
    expect(screen.getByText('Anthropic not connected')).toBeInTheDocument()
    expect(screen.getByText('OpenAI key added')).toBeInTheDocument()
    expect(useNotebook.getState().models?.models.every((m) => providerOf(m.id) === 'openai')).toBe(true)
    expect(openai.getByRole('button', { name: 'Remove key' })).toBeInTheDocument()
  })

  it('offers models from the only connected provider and chooses one without a provider selector', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    setApi(api)
    const initial = fakeSettings()
    api.updateSettings = async (update) => ({ ...initial, ...update })
    useNotebook.setState({ providerKeys: { ...NO_KEYS, configured: { ...NO_KEYS.configured, openai: true } } })
    function Settings() {
      const settings = useNotebook((s) => s.settings)!
      return <ModelSettings api={api} settings={settings} />
    }
    render(<Settings />)
    expect(screen.queryByRole('combobox', { name: 'Active provider' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Anthropic API key'), 'unfinished-anthropic-key')
    screen.getByRole('combobox', { name: 'Suggested model' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(MODELS.filter((model) => providerOf(model.id) === 'openai').map((model) => model.name))
    await user.keyboard('{Enter}')
    expect(useNotebook.getState().settings?.model).toBe(MODELS.find((model) => providerOf(model.id) === 'openai')!.id)
    expect(screen.getByLabelText('Anthropic API key')).toHaveValue('unfinished-anthropic-key')
    expect(screen.getByLabelText('OpenAI API key')).toHaveValue('')
  })

  it('adds, replaces and removes keys without displaying their saved values', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    setApi(api)
    const writes: [string, string][] = []
    api.setProviderKey = async (provider, key) => {
      writes.push([provider, key])
      return { ...NO_KEYS, configured: { ...NO_KEYS.configured, [provider]: Boolean(key) } }
    }
    render(<ModelSettings api={api} settings={fakeSettings()} />)
    expect(screen.queryByRole('combobox', { name: 'Active provider' })).not.toBeInTheDocument()
    const field = screen.getByLabelText('Anthropic API key')
    expect(field).toHaveAttribute('type', 'password')
    await user.type(field, 'first-test-key')
    await user.click(within(screen.getByRole('form', { name: 'Anthropic connection' })).getByRole('button', { name: 'Save key' }))
    expect(await screen.findByText('Anthropic key added')).toBeInTheDocument()
    expect(field).toHaveValue('')
    await user.type(field, 'replacement-test-key')
    await user.click(within(screen.getByRole('form', { name: 'Anthropic connection' })).getByRole('button', { name: 'Save key' }))
    await user.click(await screen.findByRole('button', { name: 'Remove key' }))
    expect(writes).toEqual([['anthropic', 'first-test-key'], ['anthropic', 'replacement-test-key'], ['anthropic', '']])
    expect(screen.queryByRole('button', { name: 'Remove key' })).not.toBeInTheDocument()
  })

  it('explains session-only storage and key-save failures without echoing keys', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    setApi(api)
    api.setProviderKey = async () => { throw new Error('a response containing the key') }
    act(() => useNotebook.setState({ providerKeys: { ...NO_KEYS, persistent: false } }))
    render(<ModelSettings api={api} settings={fakeSettings()} />)
    expect(screen.getByText(/Keys will last only until you quit/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Anthropic API key'), 'dummy-test-key')
    await user.click(within(screen.getByRole('form', { name: 'Anthropic connection' })).getByRole('button', { name: 'Save key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save the API key")
    expect(screen.getByRole('alert')).not.toHaveTextContent('a response containing the key')
  })
})
