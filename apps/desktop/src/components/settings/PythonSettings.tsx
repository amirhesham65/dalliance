import { Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePythonSetup } from '@/components/welcome/use-python-setup'
import { pythonReady } from '@/components/welcome/start'
import { cn } from '@/lib/utils'
import type { DallianceApi, SettingsView } from '@dalliance/shared/ipc'
import { actions, useNotebook } from '@/store/notebook-store'
import { Group, Note, Row, SectionHeading } from './parts'
import { saveSettings } from './save'

/** Which Python runs the cells: the app's own environment, one found on the computer, or a path. */
export function PythonSettings({ api, settings }: { api: DallianceApi; settings: SettingsView }) {
  const python = useNotebook((s) => s.python)
  const { log, installing, error, setup } = usePythonSetup(api)
  // A path being typed. Null shows the saved one
  const [path, setPath] = useState<string | null>(null)
  const [pathError, setPathError] = useState<string | null>(null)
  const ready = pythonReady(python)

  const commitPath = async () => {
    const next = path?.trim() ?? null
    setPath(null)
    if (path == null || (next || null) === settings.pythonPath) return
    setPathError(null)
    try {
      // The main process restarts the kernel on the new interpreter
      await saveSettings(api, { pythonPath: next || null })
      useNotebook.setState({ python: await api.pythonState() })
      actions.environmentChanged()
    } catch (err) {
      setPathError(`Couldn't switch: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const status = !python
    ? 'Looking for Python…'
    : python.python
      ? `Python ${python.version}, ${python.source === 'managed' ? "the app's own environment" : python.source === 'settings' ? 'from the path below' : 'found on this computer'}.${python.missingPackages.length ? ` Missing ${python.missingPackages.join(', ')}.` : ''}`
      : 'No Python found.'

  return (
    <>
      <SectionHeading title="Python">Cells run in a Python process on this computer, in the notebook's folder.</SectionHeading>
      <div className="mb-6 flex items-center gap-2.5 rounded-lg bg-raised px-3.5 py-3 text-[13px]" role="status">
        {ready ? (
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-go text-background">
            <Check className="size-2.5" strokeWidth={3.5} />
          </span>
        ) : (
          <span className={cn('size-2 shrink-0 rounded-full', python ? 'bg-warn' : 'bg-faint pulse')} />
        )}
        <span className="flex-1">{status}</span>
      </div>
      <Group>
        <Row label="A private environment" description="Made in the app's data folder with pandas, NumPy and matplotlib. Takes about a minute.">
          <Button size="sm" variant={ready ? 'outline' : 'default'} disabled={installing} onClick={() => void setup()}>
            {installing && <Loader2 className="animate-spin" />}
            {installing ? 'Setting up…' : python?.managedEnvExists ? 'Update' : 'Set up'}
          </Button>
        </Row>
        <Row
          label="Python path"
          htmlFor="python-path"
          description="Use a specific interpreter or virtual environment instead. Saved when you press Enter or leave the field."
          wide
        >
          <Input
            id="python-path"
            value={path ?? settings.pythonPath ?? ''}
            onChange={(e) => setPath(e.target.value)}
            onBlur={() => void commitPath()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitPath()
            }}
            placeholder="e.g. ~/.venvs/analysis/bin/python"
            className="font-mono text-xs"
          />
        </Row>
      </Group>
      {(installing || log.length > 0) && (
        <pre className="scrollbar-thin mb-3 max-h-40 overflow-auto rounded-md bg-raised p-2 font-mono text-[11px] text-faint">{log.slice(-40).join('\n')}</pre>
      )}
      {(error || pathError) && <Note error>{error ?? pathError}</Note>}
    </>
  )
}
