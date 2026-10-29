import { useEffect, useState } from 'react'
import { appActions, useApps } from '@/store/apps-store'
import { getApi, useNotebook } from '@/store/notebook-store'
import { Button } from '@/components/ui/button'

/** Shell visibility drives idle accounting; input inside an app stays private to its iframe. */
export function AppLifecycle() {
  const apps = useApps((s) => s.apps)
  const selected = useApps((s) => s.selectedId)
  const showing = useApps((s) => s.showing)
  const screen = useNotebook((s) => s.screen)
  const settings = useNotebook((s) => s.settingsPage)
  const api = getApi()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const update = () => api?.setVisibleApp(showing && screen === 'notebook' && !settings && !document.hidden ? selected : null)
    update()
    document.addEventListener('visibilitychange', update)
    return () => { document.removeEventListener('visibilitychange', update); api?.setVisibleApp(null) }
  }, [api, showing, selected, screen, settings])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const warning = apps.find((app) => app.status === 'running' && !app.keepRunning && app.busy === false && app.idleStopAt != null && app.idleStopAt - now <= 60_000 && !(showing && selected === app.id))
  if (!warning) return null
  return <div role="status" className="fixed right-5 bottom-5 z-40 flex max-w-md items-center gap-3 rounded-lg border bg-background px-4 py-3 text-[13px] shadow-xl">
    <span>{warning.title} will stop after inactivity in {Math.max(0, Math.ceil((warning.idleStopAt! - now) / 1000))} seconds. Temporary widget state will reset.</span>
    <Button size="sm" variant="secondary" onClick={() => void appActions.keepRunning(warning.id, true)}>Keep running</Button>
  </div>
}
