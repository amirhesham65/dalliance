import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DallianceApi } from '@dalliance/shared/ipc'
import { PROVIDERS, PROVIDER_NAMES, type ProviderId } from '@dalliance/shared/models'
import { actions, useNotebook } from '@/store/notebook-store'
import { Group, Note, Row } from './parts'

const KEY_LINKS: Record<ProviderId, string> = {
  anthropic: 'https://platform.claude.com/settings/keys',
  google: 'https://aistudio.google.com/api-keys',
  openai: 'https://platform.openai.com/api-keys',
}

/** Provider connections are independent of the model selected for generation. */
export function ProviderSetup({ api }: { api: DallianceApi }) {
  const keys = useNotebook((s) => s.providerKeys)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<ProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)

  const saveKey = async (target: ProviderId, value: string) => {
    setBusy(true)
    setSaving(target)
    setError(null)
    try {
      const providerKeys = await api.setProviderKey(target, value)
      useNotebook.setState({ providerKeys, models: null })
      void actions.loadModels(true)
      return true
    } catch {
      setError("Couldn't save the API key. Check the key and access to the app's settings folder.")
      return false
    } finally {
      setBusy(false)
      setSaving(null)
    }
  }

  return (
    <>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Add keys for any providers you use. The model picker shows models from every connected provider. You pay each provider directly for API usage.</p>
      <Group label="Provider connections">
        {PROVIDERS.map((id) => (
          <ProviderKeyField key={id} provider={id} configured={keys?.configured[id] === true} disabled={busy} saving={saving === id} onSave={saveKey} />
        ))}
      </Group>
      <div className="-mt-3 mb-6 flex flex-col gap-2">
        <Note>{!keys ? 'Checking secure storage…' : keys.persistent ? 'Keys are encrypted on this device. Saved keys are never shown again.' : 'Secure storage is unavailable. Keys will last only until you quit the app.'}</Note>
        {(error || keys?.error) && <Note error>{error || keys?.error}</Note>}
      </div>
    </>
  )
}

function ProviderKeyField({ provider, configured, disabled, saving, onSave }: {
  provider: ProviderId
  configured: boolean
  disabled: boolean
  saving: boolean
  onSave: (provider: ProviderId, key: string) => Promise<boolean>
}) {
  const keyId = useId()
  const [key, setKey] = useState('')
  const save = async (value: string) => {
    if (await onSave(provider, value)) setKey('')
  }

  return (
    <Row label={`${PROVIDER_NAMES[provider]} API key`} htmlFor={keyId} wide>
      <form className="flex flex-wrap items-center gap-2" aria-label={`${PROVIDER_NAMES[provider]} connection`} onSubmit={(event) => { event.preventDefault(); if (key.trim()) void save(key) }}>
        <Input id={keyId} type="password" autoComplete="new-password" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} disabled={disabled} placeholder={configured ? 'Enter a replacement key' : 'Paste your API key'} className="min-w-40 flex-1 font-mono text-xs" />
        <Button type="submit" size="sm" disabled={disabled || !key.trim()}>{saving ? 'Saving…' : 'Save key'}</Button>
        {configured && <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void save('')}>Remove key</Button>}
      </form>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <a href={KEY_LINKS[provider]} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline underline-offset-2">Get an API key from {PROVIDER_NAMES[provider]}</a>
        <p className={configured ? 'text-xs text-ink' : 'text-xs text-faint'} role="status">{PROVIDER_NAMES[provider]} {configured ? 'key added' : 'not connected'}</p>
      </div>
    </Row>
  )
}
