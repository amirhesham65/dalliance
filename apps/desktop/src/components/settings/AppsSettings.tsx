import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { DallianceApi, SettingsView } from '@dalliance/shared/ipc'
import { Group, Row, SectionHeading } from './parts'
import { saveSettings } from './save'

export function AppsSettings({ api, settings }: { api: DallianceApi; settings: SettingsView }) {
  const update = (name: 'appsIdleMinutes' | 'appsMaxRunning' | 'appsHistoryLimit', value: string) => void saveSettings(api, { [name]: Number(value) })
  return <>
    <SectionHeading title="Apps">Apps use separate environments with a compatible installed Python 3.11 or newer, independently of notebook Python. They follow Dalliance's appearance by default.</SectionHeading>
    <Group>
      <Row label="Stop background apps after" htmlFor="apps-idle" description="Only hidden, idle apps stop. Running computations wait. Keep running overrides this per app. Temporary widget state resets after stopping.">
        <Select value={String(settings.appsIdleMinutes)} onValueChange={(v) => update('appsIdleMinutes', v)}><SelectTrigger id="apps-idle" className="w-40"><SelectValue /></SelectTrigger><SelectContent>{[5, 15, 30, 60, 0].map((v) => <SelectItem key={v} value={String(v)}>{v ? `${v} minutes` : 'Never'}</SelectItem>)}</SelectContent></Select>
      </Row>
      <Row label="Running app limit" htmlFor="apps-limit" description="A new app asks you to stop another when this limit is reached. Busy and pinned apps are never evicted automatically.">
        <Select value={String(settings.appsMaxRunning)} onValueChange={(v) => update('appsMaxRunning', v)}><SelectTrigger id="apps-limit" className="w-40"><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3, 5, 10].map((v) => <SelectItem key={v} value={String(v)}>{v} {v === 1 ? 'app' : 'apps'}</SelectItem>)}</SelectContent></Select>
      </Row>
      <Row label="Previous versions to keep" htmlFor="apps-history" description="History includes snapshot data. The most recent verified version is preserved within this limit. Clear history and Delete app are available in each app's details.">
        <Select value={String(settings.appsHistoryLimit)} onValueChange={(v) => update('appsHistoryLimit', v)}><SelectTrigger id="apps-history" className="w-40"><SelectValue /></SelectTrigger><SelectContent>{[1, 3, 5, 10, 20].map((v) => <SelectItem key={v} value={String(v)}>{v} {v === 1 ? 'version' : 'versions'}</SelectItem>)}</SelectContent></Select>
      </Row>
    </Group>
  </>
}
