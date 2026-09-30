import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SettingsView } from '@dalliance/shared/ipc'
import { fakeApi, fakeSettings, result } from '@/test/fake-api'
import { ModelSettings } from './ModelSettings'

const show = (settings: Partial<SettingsView>) => render(<ModelSettings api={fakeApi(() => result()).api} settings={{ ...fakeSettings(), ...settings }} />)

describe('ModelSettings key note', () => {
  it('asks for the key again when the saved one cannot be read', () => {
    show({ keySource: null, hasKey: { gateway: false, anthropic: false }, unreadableKeys: ['gateway'] })
    expect(screen.getByRole('alert')).toHaveTextContent("The saved key couldn't be read, probably after an update. Paste it again.")
    expect(screen.getByRole('button', { name: 'Remove saved key' })).toBeInTheDocument()
  })

  it('warns when the key is stored without a keychain', () => {
    show({ keySource: 'settings', keyStorage: { gateway: 'plain', anthropic: 'plain' } })
    expect(screen.getByText(/Stored unencrypted in the settings file/)).toBeInTheDocument()
  })

  it('says the key is in the keychain otherwise', () => {
    show({ keySource: 'settings', keyStorage: { gateway: 'keychain', anthropic: 'keychain' }, unreadableKeys: [] })
    expect(screen.getByText('Stored encrypted with your system keychain.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
