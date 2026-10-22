import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProviderSetup } from './ProviderSetup'
import { ModelSelect } from './ModelSelect'
import { providerOf } from '@dalliance/shared/models'
import type { DallianceApi, Effort, SettingsView } from '@dalliance/shared/ipc'
import { Group, Row, SectionHeading } from './parts'
import { saveSettings } from './save'

// Only these three for now, OFFERED_EFFORTS in the shared package
const EFFORTS: { value: Effort; label: string }[] = [
  { value: 'low', label: 'Low: fastest' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High: slowest' },
]

/** The model that writes each cell's code, and the provider it runs on. */
export function ModelSettings({ api, settings }: { api: DallianceApi; settings: SettingsView }) {
  // A model name being typed. Null shows the saved one, so a change from the model picker shows up here too
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const update = (u: Parameters<typeof api.updateSettings>[0]) => {
    setError(null)
    void saveSettings(api, u).catch(() => setError("Couldn't save the model settings. Check the model ID and try again."))
  }

  const commitModel = () => {
    if (model != null && model.trim()) update({ model: model.trim().includes('/') ? model.trim() : `${providerOf(settings.model) ?? 'anthropic'}/${model.trim()}` })
    setModel(null)
  }

  const effortApplies = /^(anthropic|openai)\//.test(settings.model)

  return (
    <>
      <SectionHeading title="Models">The model that writes each cell's code, using your own API key. The model picker in the top bar changes it too.</SectionHeading>
      {error && <p role="alert" className="mb-4 text-xs text-destructive">{error}</p>}
      <ProviderSetup api={api} />
      <Group label="Model">
        <Row label="Model" htmlFor="model" description="Choose from all connected providers, or enter provider/model-id. Custom models must support tools and image input." wide>
          <ModelSelect value={settings.model} onValueChange={(value) => { setModel(null); update({ model: value }) }} />
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
          description={effortApplies ? 'How hard the model thinks before it writes. Higher is slower and uses more tokens.' : 'Applies to Anthropic and OpenAI models. This one uses its default.'}
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
        <Row
          label="Show token usage"
          htmlFor="costs"
          description="Tokens used by each run and cell title, with a total in the Activity pane. Your provider reports actual charges."
        >
          <Select value={settings.showUsage ? 'show' : 'hide'} onValueChange={(v) => update({ showUsage: v === 'show' })}>
            <SelectTrigger id="costs" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="show">Show them</SelectItem>
              <SelectItem value="hide">Don't show them</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Group>
    </>
  )
}
