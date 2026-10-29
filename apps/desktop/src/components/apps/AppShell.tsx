import { AppWindow, ArrowLeft, Code, FileText, Play, RotateCcw, RotateCw, Square, Trash2, Wrench } from 'lucide-react'
import { useState } from 'react'
import { IconButton } from '@/components/app/IconButton'
import { Button } from '@/components/ui/button'
import { appActions, useApps } from '@/store/apps-store'
import { getApi, useNotebook } from '@/store/notebook-store'
import { cn } from '@/lib/utils'

/** App frames stay mounted while hidden, preserving Streamlit sessions when returning to the notebook. */
export function AppShell() {
  const apps = useApps((s) => s.apps)
  const selected = useApps((s) => s.selectedId)
  const showing = useApps((s) => s.showing)
  const busy = useApps((s) => s.busy)
  const [logs, setLogs] = useState(false)
  const [details, setDetails] = useState(false)
  const notebook = useNotebook((s) => s.notebook)
  const path = useNotebook((s) => s.path)
  const runningCells = useNotebook((s) => Object.keys(s.runs).length > 0)
  const app = apps.find((a) => a.id === selected)
  const sourceHere = app && notebook.cells.some((c) => c.id === app.sourceCellId) && (!app.sourceNotebook || app.sourceNotebook === path?.split(/[\\/]/).pop())
  return (
    <section aria-label="App viewer" hidden={!showing} className={cn('min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-pane', showing ? 'flex' : 'hidden')}>
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[13px]">
        <IconButton label="Back to notebook" size="icon-xs" onClick={appActions.notebook}><ArrowLeft /></IconButton>
        <AppWindow className="size-3.5 text-muted-foreground" />
        <h2 className="max-w-60 truncate font-medium">{app?.title ?? 'Apps'}</h2>
        {app && <span role="status" className={cn('text-xs text-faint', app.status === 'error' && 'text-destructive')}>{busy[app.id] ? 'Working…' : app.status}{app.status === 'running' && app.busy ? ' · computing' : ''}{app.memoryMb != null && app.status === 'running' ? ` · ${Math.round(app.memoryMb)} MB` : ''}</span>}
        {app && <div className="ml-auto flex items-center gap-0.5">
          <button type="button" aria-pressed={app.keepRunning ?? false} disabled={busy[app.id]} className="mr-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-hover aria-pressed:bg-hover aria-pressed:text-foreground" onClick={() => void appActions.keepRunning(app.id, !app.keepRunning)}>Keep running</button>
          {app.status === 'running' ? <IconButton label="Restart app" size="icon-xs" disabled={busy[app.id]} onClick={() => void appActions.restart(app.id)}><RotateCw /></IconButton>
            : <IconButton label="Start app" size="icon-xs" disabled={busy[app.id] || app.status === 'starting'} onClick={() => void appActions.start(app.id)}><Play /></IconButton>}
          <IconButton label="Stop app" size="icon-xs" disabled={!busy[app.id] && app.status !== 'running' && app.status !== 'starting'} onClick={() => void appActions.stop(app.id)}><Square /></IconButton>
          <IconButton label="Show app logs" size="icon-xs" aria-pressed={logs} onClick={() => setLogs(!logs)}><FileText /></IconButton>
          <IconButton label="App files and snapshots" size="icon-xs" aria-pressed={details} onClick={() => setDetails(!details)}><Code /></IconButton>
          <IconButton label="Edit or fix this app" size="icon-xs" onClick={() => appActions.fix(app)}><Wrench /></IconButton>
        </div>}
      </header>
      {app?.buildError && <div role="alert" className="shrink-0 border-b px-4 py-2 text-[13px] text-warn">The update failed verification. Your published version is unchanged. <button type="button" className="underline" onClick={() => appActions.fix(app)}>Fix update</button></div>}
      {app?.dataState === 'changed' && <div role="status" className="shrink-0 border-b px-4 py-2 text-[13px] text-warn">Notebook inputs changed. This app still uses its saved snapshots. <button type="button" disabled={busy[app.id] || runningCells} className="underline disabled:opacity-50" onClick={() => void appActions.refreshData(app.id)}>Refresh data</button></div>}
      {details && app && <div className="shrink-0 border-b px-4 py-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="underline underline-offset-2" onClick={() => void getApi()?.revealFile(`apps/${app.id}/app.py`)}>apps/{app.id}/app.py</button>
          {sourceHere ? <button type="button" className="underline underline-offset-2" onClick={() => appActions.source(app)}>Go to source cell</button> : <span>Source notebook: {app.sourceNotebook ?? 'Untitled'}</span>}
          <button type="button" disabled={busy[app.id]} className="flex items-center gap-1 underline underline-offset-2 disabled:opacity-50" onClick={() => void appActions.restore(app.id)}><RotateCcw className="size-3" />Restore previous version</button>
        </div>
        {app.environment && <p className="mt-2">Verified with Python {app.environment.pythonVersion} and {app.environment.packages.length} locked packages in an isolated project environment.</p>}
        <p className="mt-2">Python dependencies: {app.requirements.join(', ')}.</p>
        {app.snapshots.length > 0 && <ul className="mt-2 space-y-1" aria-label="Saved snapshots">{app.snapshots.map((s) => <li key={s.file}>{s.file} from @{s.variable}, exported {new Date(s.exportedAt).toLocaleString()}. Use Refresh data to update.</li>)}</ul>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy[app.id] || runningCells || !app.snapshots.length} className="underline underline-offset-2 disabled:opacity-50" onClick={() => void appActions.refreshData(app.id)}>Refresh data</button>
          <span>{app.dataState === 'unavailable' && app.snapshots.length > 0 ? 'Run the source notebook to check data freshness.' : app.dataState === 'changed' ? 'Notebook inputs changed since export.' : app.snapshots.length > 0 ? 'Notebook inputs match the saved snapshots.' : 'No notebook snapshots.'}</span>
          <button type="button" disabled={busy[app.id] || !app.historyCount} className="underline underline-offset-2 disabled:opacity-50" onClick={() => void appActions.clearHistory(app.id)}>Clear history ({app.historyCount ?? 0})</button>
          <button type="button" disabled={busy[app.id]} className="flex items-center gap-1 text-destructive underline underline-offset-2 disabled:opacity-50" onClick={() => void appActions.remove(app.id)}><Trash2 className="size-3" />Delete app</button>
        </div>
      </div>}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {app?.status === 'error' && <div className="m-5 rounded-lg border border-destructive/25 p-4 text-[13px]" role="alert">
          <p className="font-medium">The app needs attention</p>
          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{app.error}</p>
          <div className="mt-3 flex gap-2"><Button size="sm" variant="secondary" onClick={() => appActions.fix(app)}>Fix this app</Button><Button size="sm" variant="ghost" onClick={() => setLogs(true)}>View logs</Button></div>
        </div>}
        {(!app || app.status === 'stopped' || app.status === 'starting') && <div className="m-auto max-w-md px-8 py-12 text-center text-[13px] text-muted-foreground">
          <AppWindow className="mx-auto mb-3 size-7 text-faint" />
          <p>{!app ? 'Choose an app from Apps in the sidebar.' : app.status === 'starting' || busy[app.id] ? 'Starting the app…' : app.stoppedReason === 'idle' ? 'Stopped after inactivity. Reopening resets temporary widget state; your files and snapshots are saved.' : 'This app is stopped. Start it to continue.'}</p>
          {app?.status === 'stopped' && !busy[app.id] && <Button size="sm" className="mt-4" onClick={() => void appActions.start(app.id)}>Start app</Button>}
        </div>}
        {apps.filter((a) => a.status === 'running' && a.url && /^http:\/\/127\.0\.0\.1:\d+$/.test(a.url)).map((a) => (
          <iframe key={`${a.id}:${a.url}`} title={a.title} src={`${a.url}/?embed=true`} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerPolicy="no-referrer" hidden={!showing || a.id !== selected} className={cn('min-h-0 w-full flex-1 border-0 bg-background', !showing || a.id !== selected ? 'hidden' : 'block')} />
        ))}
      </div>
      {logs && app && <div className="max-h-52 shrink-0 overflow-auto border-t bg-hover px-4 py-3" aria-label="App logs"><pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{app.logs || 'No server logs yet.'}</pre></div>}
    </section>
  )
}
