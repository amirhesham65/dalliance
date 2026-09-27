import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePythonSetup } from '@/components/welcome/use-python-setup'
import type { Effort, DallianceApi, Provider, SettingsView } from '@dalliance/shared/ipc'
import { getApi, useNotebook } from '@/store/notebook-store'

const PROVIDERS: Record<Provider, { label: string; keyLabel: string; placeholder: string }> = {
  gateway: { label: 'Vercel AI Gateway', keyLabel: 'AI Gateway key', placeholder: 'vck_…' },
  anthropic: { label: 'Anthropic API', keyLabel: 'Anthropic API key', placeholder: 'sk-ant-…' },
}

const EFFORTS: { value: Effort; label: string }[] = [
  { value: 'low', label: 'Low: fastest' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max: slowest' },
]

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const settings = useNotebook((s) => s.settings)
  const api = getApi()
  if (!settings || !api) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <SettingsForm settings={settings} api={api} onClose={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function SettingsForm({ settings, api, onClose }: { settings: SettingsView; api: DallianceApi; onClose: () => void }) {
  const python = useNotebook((s) => s.python)
  const [key, setKey] = useState('')
  const [model, setModel] = useState(settings.model)
  const [pythonPath, setPythonPath] = useState(settings.pythonPath ?? '')
  const { log, installing, error, setup } = usePythonSetup(api)

  const provider = PROVIDERS[settings.provider]

  const update = async (u: Parameters<typeof api.updateSettings>[0]) => {
    useNotebook.setState({ settings: await api.updateSettings(u) })
  }

  const save = async () => {
    await update({
      model,
      pythonPath: pythonPath || null,
      ...(key.trim() ? { apiKey: { provider: settings.provider, key } } : {}),
    })
    useNotebook.setState({ python: await api.pythonState() })
    onClose()
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>The model that writes each cell's code, and the Python that runs it.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-5 py-1">
        <section className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="provider">Model provider</Label>
            <Select value={settings.provider} onValueChange={(v) => void update({ provider: v as Provider })}>
              <SelectTrigger id="provider" className="w-full">
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
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="api-key">{provider.keyLabel}</Label>
            <Input
              id="api-key"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={settings.keySource ? 'Saved. Type a new key to replace it.' : provider.placeholder}
            />
            <p className="text-xs text-faint">
              {settings.keySource === 'environment'
                ? 'Using the key from the environment (.env). A key typed here takes priority.'
                : settings.keySource === 'settings'
                  ? 'Stored encrypted with your system keychain.'
                  : 'Required to run prompts. Stored encrypted with your system keychain.'}
            </p>
            {settings.keySource === 'settings' && (
              <button
                type="button"
                className="w-fit text-xs text-faint underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => void update({ apiKey: { provider: settings.provider, key: '' } })}
              >
                Remove saved key
              </button>
            )}
          </div>
          <div className="grid grid-cols-[1fr_10rem] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="model">Model</Label>
              <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="effort">Effort</Label>
              <Select value={settings.effort} onValueChange={(v) => void update({ effort: v as Effort })}>
                <SelectTrigger id="effort" className="w-full">
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
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="approval">Package installs</Label>
            <Select value={settings.approvalMode} onValueChange={(v) => void update({ approvalMode: v as 'interactive' | 'background' })}>
              <SelectTrigger id="approval" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="interactive">Ask me before installing</SelectItem>
                <SelectItem value="background">Install without asking</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="titles">Cell names in the overview</Label>
            <Select value={settings.autoTitles ? 'model' : 'prompt'} onValueChange={(v) => void update({ autoTitles: v === 'model' })}>
              <SelectTrigger id="titles" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="model">Short titles from {settings.provider === 'gateway' ? 'GPT-6 Luna' : 'Claude Haiku 4.5'}</SelectItem>
                <SelectItem value="prompt">The prompt itself</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-faint">Long prompts get a few-word name while the code is written. It costs a fraction of a cent per cell.</p>
          </div>
        </section>

        <section className="grid gap-3 border-t pt-4">
          <div className="grid gap-1">
            <Label>Python</Label>
            <p className="text-[13px] text-muted-foreground">
              {python?.python
                ? `Python ${python.version} (${python.source === 'managed' ? "the app's own environment" : python.source === 'settings' ? 'the path below' : 'found on this computer'})`
                : 'No Python found.'}
              {python?.python && python.missingPackages.length > 0 && ` Missing: ${python.missingPackages.join(', ')}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={installing} onClick={() => void setup()}>
              {installing && <Loader2 className="animate-spin" />}
              {python?.managedEnvExists ? 'Update the environment' : 'Set up a Python environment'}
            </Button>
            <span className="text-xs text-faint">Creates a private environment with pandas, NumPy and matplotlib.</span>
          </div>
          {(installing || log.length > 0) && (
            <pre className="scrollbar-thin max-h-32 overflow-auto rounded-md bg-raised p-2 font-mono text-[11px] text-faint">{log.slice(-40).join('\n')}</pre>
          )}
          {error && <p className="text-[13px] text-destructive">{error}</p>}
          <div className="grid gap-1.5">
            <Label htmlFor="python-path">Python path (optional)</Label>
            <Input
              id="python-path"
              value={pythonPath}
              onChange={(e) => setPythonPath(e.target.value)}
              placeholder="Use a specific interpreter, e.g. ~/.venvs/analysis/bin/python"
              className="font-mono text-xs"
            />
          </div>
        </section>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()}>Save</Button>
      </DialogFooter>
    </DialogContent>
  )
}
