import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CloudStatus } from '@/components/cloud/CloudStatus'
import { CLOUD_RETENTION } from '@/lib/cloud'
import type { DallianceApi, Effort, SettingsView } from '@dalliance/shared/ipc'
import { Group, Row, SectionHeading } from './parts'
import { saveSettings } from './save'

const EFFORTS: { value: Effort; label: string }[] = [
  { value: 'low', label: 'Low: fastest' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max: slowest' },
]

/** The model that writes each cell's code, and the account it runs on. */
export function ModelSettings({ api, settings }: { api: DallianceApi; settings: SettingsView }) {
  // A model name being typed. Null shows the saved one, so a change from the model picker shows up here too
  const [model, setModel] = useState<string | null>(null)
  const update = (u: Parameters<typeof api.updateSettings>[0]) => void saveSettings(api, u)

  const commitModel = () => {
    if (model != null && model.trim() !== settings.model) update({ model })
    setModel(null)
  }

  const effortApplies = /^(anthropic|openai)\//.test(settings.model)

  return (
    <>
      <SectionHeading title="Models">The model that writes each cell's code, on your Dalliance plan. The model picker in the top bar changes it too.</SectionHeading>
      <Group label="Plan">
        <Row label="Dalliance account" description={CLOUD_RETENTION} wide>
          <CloudStatus api={api} />
        </Row>
      </Group>
      <Group label="Model">
        <Row label="Model" htmlFor="model" description="A gateway id like anthropic/claude-sonnet-5.5. Saved when you press Enter or leave the field." wide>
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
        <Row
          label="Show costs"
          htmlFor="costs"
          description="Each run's credits in the Activity pane, and the notebook's total. Credits show a few seconds after a run ends."
        >
          <Select value={settings.showCosts ? 'show' : 'hide'} onValueChange={(v) => update({ showCosts: v === 'show' })}>
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
