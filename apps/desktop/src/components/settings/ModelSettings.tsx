import { ArrowUpRight, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PROVIDERS, keySourceText, providerForKey, saveKey } from '@/lib/keys'
import type { DallianceApi, Effort, Provider, SettingsView } from '@dalliance/shared/ipc'
import { useNotebook } from '@/store/notebook-store'
import { Group, Note, Row, SectionHeading } from './parts'
import { saveSettings } from './save'

const EFFORTS: { value: Effort; label: string }[] = [
  { value: 'low', label: 'Low: fastest' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max: slowest' },
]

/** The model provider, its key, and the model that writes each cell's code. */
export function ModelSettings({ api, settings }: { api: DallianceApi; settings: SettingsView }) {
  const provider = PROVIDERS[settings.provider]
  const [key, setKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keyNote, setKeyNote] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // A model name being typed. Null shows the saved one, so a change from the model picker shows up here too
  const [model, setModel] = useState<string | null>(null)
  const update = (u: Parameters<typeof api.updateSettings>[0]) => void saveSettings(api, u)

  const changeKey = (value: string) => {
    setKey(value)
    setKeyError(null)
    setKeyNote(null)
    // A pasted key says whose it is, so the provider follows it
    const detected = providerForKey(value)
    if (detected && detected !== settings.provider) update({ provider: detected })
  }

  const submitKey = async () => {
    if (!key.trim()) return
    setChecking(true)
    try {
      // A key the provider turns down isn't saved, so it can be fixed
      const saved = await saveKey(api, settings.provider, key)
      if (!saved.view) return setKeyError(saved.error)
      useNotebook.setState({ settings: saved.view })
      setKey('')
      setKeyNote(saved.note)
    } catch (err) {
      setKeyError(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setChecking(false)
    }
  }

  const commitModel = () => {
    if (model != null && model.trim() !== settings.model) update({ model })
    setModel(null)
  }

  const effortApplies = settings.provider === 'anthropic' || /^(anthropic|openai)\//.test(settings.model)

  return (
    <>
      <SectionHeading title="Models">The provider and model that write each cell's code. The model picker in the top bar changes the model too.</SectionHeading>
      <Group label="Provider">
        <Row label="Model provider" htmlFor="provider" description={provider.blurb}>
          <Select value={settings.provider} onValueChange={(v) => update({ provider: v as Provider })}>
            <SelectTrigger id="provider" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PROVIDERS[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row
          label={provider.keyLabel}
          htmlFor="api-key"
          wide
          description={
            <a href={provider.keysUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">
              Get a key from {provider.keysSite}
              <ArrowUpRight className="size-3" />
            </a>
          }
        >
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void submitKey()
            }}
          >
            <Input
              id="api-key"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => changeKey(e.target.value)}
              placeholder={settings.keySource ? 'Saved. Type a new key to replace it.' : provider.placeholder}
              aria-invalid={keyError != null}
              aria-describedby="api-key-help"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={checking || !key.trim()} className="h-9">
              {checking && <Loader2 className="animate-spin" />}
              {checking ? 'Checking…' : 'Save key'}
            </Button>
          </form>
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <Note id="api-key-help" error={keyError != null}>
              {keyError ??
                keyNote ??
                (settings.keySource === 'settings'
                  ? 'Stored encrypted with your system keychain.'
                  : settings.keySource
                    ? `${keySourceText(settings)} A key saved here takes priority.`
                    : 'Required to run prompts. Checked with the provider, then stored encrypted with your system keychain.')}
            </Note>
            {settings.keySource === 'settings' && (
              <button
                type="button"
                className="shrink-0 text-xs text-faint underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setKeyNote(null)
                  update({ apiKey: { provider: settings.provider, key: '' } })
                }}
              >
                Remove saved key
              </button>
            )}
          </div>
        </Row>
      </Group>
      <Group label="Model">
        <Row label="Model" htmlFor="model" description="The id the provider uses. Saved when you press Enter or leave the field." wide>
          <Input
            id="model"
            value={model ?? settings.model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={commitModel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitModel()
            }}
            className="font-mono text-xs"
          />
        </Row>
        <Row
          label="Effort"
          htmlFor="effort"
          description={effortApplies ? 'How hard the model thinks before it writes. Higher is slower and costs more.' : 'Applies to Anthropic and OpenAI models. This one uses its default.'}
        >
          <Select value={settings.effort} onValueChange={(v) => update({ effort: v as Effort })} disabled={!effortApplies}>
            <SelectTrigger id="effort" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EFFORTS.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Group>
    </>
  )
}
