import { describe, expect, it } from 'vitest'
import type { KeyCheck, SettingsUpdate } from '@dalliance/shared/ipc'
import { fakeApi, fakeSettings, result } from '@/test/fake-api'
import { providerForKey, saveKey } from './keys'

function api(check: KeyCheck) {
  const { api } = fakeApi(() => result())
  const updates: SettingsUpdate[] = []
  const checked: [string, string][] = []
  api.checkKey = async (provider, key) => {
    checked.push([provider, key])
    return check
  }
  api.updateSettings = async (u) => {
    updates.push(u)
    return { ...fakeSettings(), provider: u.provider ?? 'gateway', keySource: 'settings' }
  }
  return { api, updates, checked }
}

describe('keys', () => {
  it('tells the provider from the prefix', () => {
    expect(providerForKey('  vck_abc ')).toBe('gateway')
    expect(providerForKey('sk-ant-api03-abc')).toBe('anthropic')
    expect(providerForKey('sk-proj-abc')).toBeNull()
  })

  it('saves a pasted Anthropic key under Anthropic, even with the gateway chosen', async () => {
    const { api: a, updates, checked } = api({ status: 'ok', detail: null })
    const saved = await saveKey(a, 'gateway', ' sk-ant-123\n')
    expect(checked).toEqual([['anthropic', 'sk-ant-123']])
    expect(updates).toEqual([{ provider: 'anthropic', apiKey: { provider: 'anthropic', key: 'sk-ant-123' } }])
    expect(saved).toMatchObject({ note: 'Key works.', error: null })
  })

  it('reports the balance, and keeps the chosen provider for a key without a known prefix', async () => {
    const { api: a, updates } = api({ status: 'ok', detail: '$4.20 in credits' })
    const saved = await saveKey(a, 'gateway', 'custom-token')
    expect(updates[0]).toMatchObject({ provider: 'gateway' })
    expect(saved.note).toBe('Key works. $4.20 in credits.')
  })

  it("doesn't save a key the provider turns down", async () => {
    const { api: a, updates } = api({ status: 'rejected', detail: 'Turned down.' })
    expect(await saveKey(a, 'gateway', 'vck_wrong')).toEqual({ view: null, note: null, error: 'Turned down.' })
    expect(updates).toEqual([])
  })

  it('saves a key it could not check, and says so', async () => {
    const { api: a, updates } = api({ status: 'unchecked', detail: 'fetch failed' })
    const saved = await saveKey(a, 'anthropic', 'sk-ant-offline')
    expect(updates).toHaveLength(1)
    expect(saved.note).toBe("Saved, but Anthropic API couldn't be reached to check it.")
  })
})
