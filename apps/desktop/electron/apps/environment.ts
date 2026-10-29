import { createHash } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { AppEnvironment } from '@dalliance/shared/apps'
import type { ApprovalRequest } from '../harness/events'
import { managedPython, isPackageSpec, findSystemPython } from '../kernel/python-env'
import { writeFileAtomic } from '../atomic-write'
import { appCommand } from './process'

export type AppApprove = (request: ApprovalRequest) => Promise<boolean>
export interface ResolvedAppEnvironment { python: string; recorded: AppEnvironment }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
const INFO = `import sys,json,importlib.metadata as m
print(json.dumps({"pythonVersion":sys.version.split()[0],"packages":sorted([{"name":d.metadata['Name'],"version":d.version} for d in m.distributions() if d.metadata['Name']],key=lambda d:d['name'].lower())}))`

/** Environments are immutable after preparation and are cached within a project by interpreter and dependency set. */
export class AppEnvironments {
  private readonly root: string
  private readonly basePython: () => Promise<string>
  private readonly findPython: (exact?: string) => Promise<string | null>
  constructor(userData: string, workspace: string, basePython: () => Promise<string>, findPython = (exact?: string) => findSystemPython({}, { minimum: '3.11', exact })) {
    this.basePython = basePython
    this.findPython = findPython
    this.root = path.join(userData, 'app-environments', digest(path.resolve(workspace)))
  }

  private async cached(index: string, signal: AbortSignal, expected?: AppEnvironment): Promise<ResolvedAppEnvironment | null> {
    const cached = await readFile(index, 'utf8').then((s) => JSON.parse(s) as { folder: string; recorded: AppEnvironment }).catch(() => null)
    if (cached && /^[a-f0-9-]{36}$/.test(cached.folder) && (!expected || JSON.stringify(cached.recorded) === JSON.stringify(expected))) {
      const python = managedPython(path.join(this.root, cached.folder))
      try {
        const recorded = JSON.parse(await appCommand(python, ['-I', '-c', INFO], { cwd: this.root, signal })) as AppEnvironment
        if (JSON.stringify(recorded) === JSON.stringify(cached.recorded)) return { python, recorded }
      } catch { signal.throwIfAborted() }
    }
    return null
  }

  async resolve(requirements: string[], locked: AppEnvironment | undefined, approve: AppApprove | undefined, signal: AbortSignal): Promise<ResolvedAppEnvironment> {
    signal.throwIfAborted()
    await mkdir(this.root, { recursive: true })
    // Reuse the app's verified runtime before consulting notebook settings or system Python.
    if (locked) {
      const cached = await this.cached(path.join(this.root, `lock-${digest(locked)}.json`), signal, locked)
      if (cached) return cached
    }
    const probe = async (python: string | null) => {
      if (!python) return ''
      try { return (await appCommand(python, ['-I', '-c', 'import sys;print(sys.version.split()[0])'], { cwd: this.root, signal })).trim() }
      catch { signal.throwIfAborted(); return '' }
    }
    const accepts = (version: string) => /^3\.(\d+)\./.test(version) && Number(version.split('.')[1]) >= 11 && (!locked || version === locked.pythonVersion)
    let base = await this.basePython().catch(() => null)
    let version = await probe(base)
    if (!accepts(version)) {
      base = await this.findPython(locked?.pythonVersion)
      signal.throwIfAborted()
      version = await probe(base)
    }
    if (!base || !accepts(version)) throw new Error(locked
      ? `This app was verified with Python ${locked.pythonVersion}, and that runtime is unavailable. Install Python ${locked.pythonVersion} or regenerate the app to verify it with an installed Python. Notebook Python does not need to change.`
      : 'Apps use Streamlit 1.66, which requires Python 3.11 or newer. No compatible Python was found. Install Python 3.11 or newer, then retry. Notebook Python does not need to change.')
    const specs = locked ? locked.packages.map((p) => `${p.name}==${p.version}`) : requirements.map((p) => p.toLowerCase() === 'streamlit' ? 'streamlit>=1.66,<2' : p)
    if (!specs.length || specs.length > 1000 || !specs.every(isPackageSpec)) throw new Error('The app has invalid dependency specifications.')
    const key = digest([base, version, [...specs].sort()])
    const index = path.join(this.root, `${key}.json`)
    const cached = await this.cached(index, signal, locked)
    if (cached) {
      await writeFileAtomic(path.join(this.root, `lock-${digest(cached.recorded)}.json`), JSON.stringify({ folder: path.basename(path.dirname(path.dirname(cached.python))), recorded: cached.recorded }))
      return cached
    }
    if (!approve || !await approve({ title: 'Prepare an isolated environment for this app?', detail: `Use Python ${version} and install ${specs.slice(0, 30).join(', ')}${specs.length > 30 ? ` and ${specs.length - 30} locked dependencies` : ''}. This does not change notebook Python or other app environments.`, keys: specs })) throw new Error('App environment setup was declined.')
    signal.throwIfAborted()
    const folder = crypto.randomUUID()
    const env = path.join(this.root, folder)
    try {
      await appCommand(base, ['-I', '-m', 'venv', env], { cwd: this.root, signal, timeoutMs: 60_000 })
      const python = managedPython(env)
      await appCommand(python, ['-I', '-m', 'pip', 'install', '--disable-pip-version-check', ...specs], { cwd: this.root, signal, timeoutMs: 300_000, maxBytes: 1_000_000 })
      const recorded = JSON.parse(await appCommand(python, ['-I', '-c', INFO], { cwd: this.root, signal })) as AppEnvironment
      if (recorded.pythonVersion !== version) throw new Error('The app environment uses a different Python version than requested.')
      const streamlit = recorded.packages.find((p) => p.name.toLowerCase() === 'streamlit')?.version.split('.').map(Number)
      if (!streamlit || streamlit[0] !== 1 || streamlit[1] < 66) throw new Error('Apps require Streamlit 1.66 or newer in the 1.x series for managed themes and runtime checks.')
      if (locked && JSON.stringify(recorded.packages) !== JSON.stringify(locked.packages)) throw new Error('The installed app dependencies do not match the saved lock. Regenerate the app to verify a new environment.')
      signal.throwIfAborted()
      const data = JSON.stringify({ folder, recorded })
      await writeFileAtomic(index, data)
      const lockedKey = digest([base, version, recorded.packages.map((p) => `${p.name}==${p.version}`).sort()])
      await writeFileAtomic(path.join(this.root, `${lockedKey}.json`), data)
      await writeFileAtomic(path.join(this.root, `lock-${digest(recorded)}.json`), data)
      return { python, recorded }
    } catch (err) {
      await rm(env, { recursive: true, force: true })
      throw err
    }
  }
}
