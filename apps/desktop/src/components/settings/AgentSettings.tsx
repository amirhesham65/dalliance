import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { DallianceApi, SettingsView } from '@dalliance/shared/ipc'
import { Group, Row, SectionHeading } from './parts'
import { saveSettings } from './save'

/** What the agent may do without asking, how cells get their names, and whether it suggests what to ask next. */
export function AgentSettings({ api, settings }: { api: DallianceApi; settings: SettingsView }) {
  const update = (u: Parameters<typeof api.updateSettings>[0]) => void saveSettings(api, u)
  return (
    <>
      <SectionHeading title="Agent">What the agent does on its own while it writes a cell.</SectionHeading>
      <Group>
        <Row
          label="Approvals"
          htmlFor="approval"
          description="When a cell needs a package the Python doesn't have, or its code runs shell commands or uses the network."
        >
          <Select value={settings.approvalMode} onValueChange={(v) => update({ approvalMode: v as SettingsView['approvalMode'] })}>
            <SelectTrigger id="approval" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="interactive">Ask me first</SelectItem>
              <SelectItem value="background">Allow without asking</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row
          label="Cell names in the overview"
          htmlFor="titles"
          description="Long prompts get a short name from your selected model. This makes an extra request using the same provider key."
        >
          <Select value={settings.autoTitles ? 'model' : 'prompt'} onValueChange={(v) => update({ autoTitles: v === 'model' })}>
            <SelectTrigger id="titles" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="model">Short titles from the selected model</SelectItem>
              <SelectItem value="prompt">The prompt itself</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row
          label="Suggested next prompts"
          htmlFor="suggest"
          description="Up to three follow-ups under the cell you just ran. Off, the agent doesn't write them."
        >
          <Select value={settings.suggestNext ? 'show' : 'hide'} onValueChange={(v) => update({ suggestNext: v === 'show' })}>
            <SelectTrigger id="suggest" className="w-52">
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
