import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type DallianceApi, type SettingsView, isOllama } from '@dalliance/shared/ipc'
import { Group, Row, SectionHeading } from './parts'
import { saveSettings } from './save'

/** What the agent may do without asking, and how cells get their names. */
export function AgentSettings({ api, settings }: { api: DallianceApi; settings: SettingsView }) {
  const update = (u: Parameters<typeof api.updateSettings>[0]) => void saveSettings(api, u)
  const ollama = isOllama(settings.provider)
  return (
    <>
      <SectionHeading title="Agent">What the agent does on its own while it writes a cell.</SectionHeading>
      <Group>
        <Row label="Package installs" htmlFor="approval" description="When a cell needs a package the Python doesn't have.">
          <Select value={settings.approvalMode} onValueChange={(v) => update({ approvalMode: v as SettingsView['approvalMode'] })}>
            <SelectTrigger id="approval" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="interactive">Ask me first</SelectItem>
              <SelectItem value="background">Install without asking</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row
          label="Cell names in the overview"
          htmlFor="titles"
          description={
            ollama
              ? "Cells on Ollama keep their prompt as the name. A second request would wait behind the run, or hit a free plan's one-at-a-time limit."
              : 'Long prompts get a few-word name while the code is written. It costs a fraction of a cent per cell.'
          }
        >
          <Select value={settings.autoTitles && !ollama ? 'model' : 'prompt'} onValueChange={(v) => update({ autoTitles: v === 'model' })} disabled={ollama}>
            <SelectTrigger id="titles" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="model">Short titles from {settings.provider === 'gateway' ? 'GPT-6 Luna' : 'Claude Haiku 4.5'}</SelectItem>
              <SelectItem value="prompt">The prompt itself</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Group>
    </>
  )
}
