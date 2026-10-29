import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { DEFAULT_APP_POLICY, type AppDraft, type AppPolicy, type AppVerification, type AppView, type ProjectApp } from '@dalliance/shared/apps'
import type { Kernel } from '../kernel/kernel'
import { isBroadFolder } from '../harness/workspace'
import { outputsToText } from '../harness/format'
import { pythonEnv, redactSecrets } from '../secrets'
import { writeFileAtomic } from '../atomic-write'
import { appIdSchema, appDraftSchema, manifestSchema } from './schema'
import { safeAppPath, readAppText, copyAppFolder, appHash } from './files'
import type { AppApprove, ResolvedAppEnvironment } from './environment'
import { appCommand, killGroup } from './process'
import { dallianceAppTheme } from './theme'
import supervisorSource from './supervisor.py?raw'
import checkSource from './check-app.py?raw'

export { appDraftSchema } from './schema'
interface Runtime {
  child: ChildProcess
  controller: AbortController
  exited: Promise<void>
  ended: boolean
  folder: string
  manifest: ProjectApp
  view: Pick<AppView, 'status' | 'url' | 'error' | 'logs' | 'busy' | 'memoryMb'>
  lastSignal: number
  backgroundAt: number
  stopping: boolean
  runtimeFolder: string
}
interface Candidate { folder: string; manifest: ProjectApp; error: string | null }
interface Options {
  workspace: string
  python: () => Promise<string>
  changed: () => void
  verify?: (url: string, signal: AbortSignal) => Promise<AppVerification>
  environment?: { resolve: (requirements: string[], locked: ProjectApp['environment'], approve: AppApprove | undefined, signal: AbortSignal) => Promise<ResolvedAppEnvironment> }
  /** Tests may launch an HTTP fixture. Production always uses the supervised Streamlit runner. */
  launch?: (python: string, args: string[], options: Parameters<typeof spawn>[2]) => ChildProcess
  checkInteractions?: boolean
  policy?: () => AppPolicy
  now?: () => number
  startupTimeoutMs?: number
}
async function freePort(): Promise<number> {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((err) => err ? reject(err) : resolve(port))
    })
  })
}

/** Owns project apps, candidate verification, process supervision and the idle lifecycle. */
export class ProjectApps {
  private readonly options: Options
  private runtimes = new Map<string, Runtime>()
  private candidates = new Map<string, Candidate>()
  private starts = new Map<string, Set<AbortController>>()
  private builds = new Map<string, AbortController>()
  private buildTasks = new Set<Promise<unknown>>()
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private visible: string | null = null
  private keep = new Set<string>()
  private stopped = new Map<string, AppView['stoppedReason']>()
  private freshness = new Map<string, AppView['dataState']>()
  private ticker: ReturnType<typeof setInterval>

  constructor(options: Options) {
    this.options = options
    this.ticker = setInterval(() => { void this.sweep().catch(() => {}) }, 5000)
    this.ticker.unref?.()
  }
  private now() { return (this.options.now ?? Date.now)() }
  private policy() { return this.options.policy?.() ?? DEFAULT_APP_POLICY }
  private check(signal?: AbortSignal) {
    if (this.closed || signal?.aborted) throw new Error('App operation stopped.')
    if (isBroadFolder(this.options.workspace)) throw new Error('Open a project folder before creating or running apps.')
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const task = this.queue.then(action)
    this.queue = task.catch(() => {})
    return task
  }
  private file(relative: string) { return safeAppPath(this.options.workspace, `apps/${relative}`) }
  private async readManifest(folder: string): Promise<ProjectApp> { return manifestSchema.parse(JSON.parse(await readAppText(path.join(folder, 'app.json'), 250_000))) }
  private async published(id: string): Promise<ProjectApp | null> {
    appIdSchema.parse(id)
    const file = await this.file(`${id}/app.json`)
    try {
      const manifest = manifestSchema.parse(JSON.parse(await readAppText(file, 250_000)))
      if (manifest.id !== id) throw new Error('App id does not match its folder.')
      return manifest
    } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err }
  }
  async manifest(id: string): Promise<ProjectApp> {
    const manifest = await this.published(id) ?? this.candidates.get(id)?.manifest
    if (!manifest) throw new Error('App not found.')
    return manifest
  }
  async source(id: string) {
    appIdSchema.parse(id)
    const published = await this.published(id)
    return readAppText(published ? await this.file(`${id}/app.py`) : path.join(this.candidates.get(id)?.folder ?? await this.file(id), 'app.py'))
  }
  private async histories(id: string) {
    const folder = await this.file(`.history/${id}`)
    const entries = await readdir(folder).catch((err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return []; throw err })
    return entries.filter((name) => /^\d+-[a-f0-9]{8}$/.test(name)).sort().reverse()
  }
  async list(): Promise<AppView[]> {
    if (this.closed || isBroadFolder(this.options.workspace)) return []
    const entries = await readdir(await this.file(''), { withFileTypes: true }).catch(() => [])
    const ids = new Set(entries.filter((e) => e.isDirectory() && appIdSchema.safeParse(e.name).success).slice(0, 300).map((e) => e.name))
    for (const id of this.candidates.keys()) ids.add(id)
    const apps: AppView[] = []
    for (const id of ids) {
      try {
        const manifest = await this.manifest(id)
        const runtime = this.runtimes.get(id)
        const candidate = this.candidates.get(id)
        const deadline = runtime && !this.keep.has(id) && this.visible !== id && this.policy().idleMinutes > 0 ? runtime.backgroundAt + this.policy().idleMinutes * 60_000 : null
        apps.push({ ...manifest, ...(runtime?.view ?? { status: candidate ? candidate.error ? 'error' : 'starting' : 'stopped', url: null, error: candidate?.error ?? null, logs: '' }), keepRunning: this.keep.has(id), idleStopAt: deadline, stoppedReason: this.stopped.get(id) ?? null, dataState: this.freshness.get(id) ?? (manifest.snapshots.length ? 'unavailable' : 'current'), historyCount: (await this.histories(id)).length, buildError: candidate?.error ?? null })
      } catch { /* A malformed or unrelated folder is never an executable app. */ }
    }
    return apps.sort((a, b) => a.title.localeCompare(b.title))
  }

  /** Save a candidate. Published files and the working server remain untouched until verify succeeds. */
  save(draft: AppDraft, source: { cellId: string; notebook: string | null }, kernel: Kernel, signal: AbortSignal): Promise<ProjectApp> {
    return this.serial(async () => {
      this.check(signal)
      const input = appDraftSchema.parse(draft)
      const existing = await this.list()
      const owned = existing.find((a) => a.sourceCellId === source.cellId && a.sourceNotebook === source.notebook)
      const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'app'
      const id = input.id ?? owned?.id ?? `${slug}-${randomUUID().slice(0, 8)}`
      const previous = await this.published(id)
      const oldCandidate = this.candidates.get(id)
      if (input.id && !previous && !oldCandidate) throw new Error('App not found.')
      const base = oldCandidate?.manifest ?? previous
      const folder = await this.file(`.build-${randomUUID()}`)
      await mkdir(folder, { recursive: true })
      try {
        if (oldCandidate) await copyAppFolder(this.options.workspace, path.relative(this.options.workspace, oldCandidate.folder), folder)
        else if (previous) await copyAppFolder(this.options.workspace, `apps/${id}`, folder)
        await mkdir(path.join(folder, 'data'), { recursive: true })
        const snapshots = await this.exportData(input.snapshots, base?.snapshots ?? [], folder, kernel, signal)
        const requirements = [...new Set(input.requirements.some((p) => /^streamlit(?:[<>=!~[]|$)/i.test(p)) ? input.requirements : ['streamlit', ...input.requirements])]
        if (!requirements.some((p) => /^psutil(?:[<>=!~[]|$)/i.test(p))) requirements.push('psutil')
        const sameRequirements = previous && JSON.stringify(previous.requirements) === JSON.stringify(requirements)
        const manifest: ProjectApp = {
          version: 1, id, title: input.title, description: input.description, entry: 'app.py',
          sourceCellId: base?.sourceCellId ?? source.cellId, sourceNotebook: base ? base.sourceNotebook : source.notebook,
          requirements, snapshots, updatedAt: new Date().toISOString(),
          checks: input.checks ?? base?.checks ?? [], design: input.design ?? base?.design ?? 'dalliance',
          ...(sameRequirements && previous.environment ? { environment: previous.environment } : {}),
        }
        manifestSchema.parse(manifest)
        await writeFile(path.join(folder, 'app.py'), input.code)
        await writeFile(path.join(folder, 'requirements.txt'), `${requirements.join('\n')}\n`)
        await writeFile(path.join(folder, 'app.json'), `${JSON.stringify(manifest, null, 2)}\n`)
        this.check(signal)
        if (oldCandidate) await rm(oldCandidate.folder, { recursive: true, force: true })
        this.candidates.set(id, { folder, manifest, error: null })
        this.options.changed()
        return manifest
      } catch (err) { await rm(folder, { recursive: true, force: true }); throw err }
    })
  }

  private async exportData(exports: AppDraft['snapshots'], previous: ProjectApp['snapshots'], folder: string, kernel: Kernel, signal: AbortSignal) {
    const refreshed = new Set(exports.map((s) => `data/${s.file}`))
    const kept = previous.filter((s) => !refreshed.has(s.file))
    if (kept.length + exports.length > 20) throw new Error('An app can keep at most 20 snapshots.')
    for (const s of kept) await stat(await safeAppPath(folder, s.file))
    if (exports.length) {
      const jobs = exports.map((s) => ({ ...s, target: path.join(folder, 'data', s.file) }))
      const code = `def _dalliance_export_app():\n    import json\n    from pathlib import Path\n    for item in json.loads(${JSON.stringify(JSON.stringify(jobs))}):\n        value = globals()[item['variable']]\n        target = Path(item['target'])\n        if target.suffix == '.csv':\n            value.to_csv(target, index=False)\n        else:\n            target.write_text(json.dumps(value, allow_nan=False), encoding='utf-8')\n        if target.stat().st_size > 100_000_000:\n            raise ValueError('An app snapshot must be under 100 MB')\ntry:\n    _dalliance_export_app()\nfinally:\n    del _dalliance_export_app\n`
      const timer = setTimeout(() => kernel.interrupt(), 20_000)
      const result = await kernel.execute(code, { store: false }).finally(() => clearTimeout(timer))
      if (!result.ok) throw new Error(`Could not export app data: ${outputsToText(result.outputs, 2000)}`)
    }
    this.check(signal)
    const at = new Date().toISOString()
    const snapshots = [...kept]
    for (const s of exports) {
      const hash = appHash(await readFile(path.join(folder, 'data', s.file)))
      snapshots.push({ variable: s.variable, file: `data/${s.file}`, exportedAt: at, hash, sourceHash: hash })
    }
    return snapshots
  }

  private async resolved(manifest: ProjectApp, approve: AppApprove | undefined, signal: AbortSignal): Promise<ResolvedAppEnvironment> {
    const requirements = manifest.environment || manifest.requirements.some((p) => /^psutil(?:[<>=!~[]|$)/i.test(p)) ? manifest.requirements : [...manifest.requirements, 'psutil']
    if (this.options.environment) return this.options.environment.resolve(requirements, manifest.environment, approve, signal)
    return { python: await this.options.python(), recorded: manifest.environment ?? { pythonVersion: 'unknown', packages: [] } }
  }

  /** Test interactions and render the candidate at a separate address before publishing it. */
  verify(id: string, signal: AbortSignal, approve?: AppApprove): Promise<AppVerification> {
    const task = this.verifyCandidate(id, signal, approve)
    this.buildTasks.add(task)
    const done = () => this.buildTasks.delete(task)
    task.then(done, done)
    return task
  }

  private async verifyCandidate(id: string, signal: AbortSignal, approve?: AppApprove): Promise<AppVerification> {
    appIdSchema.parse(id)
    const controller = new AbortController()
    this.builds.get(id)?.abort()
    this.builds.set(id, controller)
    const combined = AbortSignal.any([signal, controller.signal])
    let runtime: Runtime | null = null
    const key = `build:${id}`
    const candidate = this.candidates.get(id)
    const manifest = candidate?.manifest ?? await this.manifest(id)
    const folder = candidate?.folder ?? await this.file(id)
    const wasRunning = this.runtimes.get(id)?.view.status === 'running'
    try {
      this.check(combined)
      const environment = await this.resolved(manifest, approve, combined)
      this.check(combined)
      let checks = 'Interaction checks were not configured.'
      if (this.options.checkInteractions !== false && !this.options.launch) checks = await this.testInteractions(folder, manifest, environment.python, combined)
      runtime = await this.serial(async () => {
        this.check(combined)
        return this.launch(key, folder, manifest, environment.python, combined)
      })
      if (!this.options.verify) throw new Error('App page verification is unavailable.')
      const result = await this.options.verify(runtime.view.url!, AbortSignal.any([combined, runtime.controller.signal]))
      if (!result.ok) throw new Error(result.text)
      const verified: ProjectApp = { ...manifest, verifiedAt: new Date().toISOString(), ...(this.options.environment ? { environment: environment.recorded } : {}) }
      manifestSchema.parse(verified)
      await this.serial(async () => {
        this.check(combined)
        if (runtime!.controller.signal.aborted || this.candidates.get(id) !== candidate) throw new Error('App changed during verification.')
        await this.stopRuntime(key)
        if (candidate) {
          candidate.manifest = verified
          await writeFileAtomic(path.join(candidate.folder, 'app.json'), `${JSON.stringify(verified, null, 2)}\n`)
          if (verified.environment) await writeFileAtomic(path.join(candidate.folder, 'requirements.lock.txt'), `${verified.environment.packages.map((p) => `${p.name}==${p.version}`).join('\n')}\n`)
          await this.publish(id, candidate.folder, combined)
          this.candidates.delete(id)
          this.freshness.set(id, 'current')
        } else await writeFileAtomic(await this.file(`${id}/app.json`), `${JSON.stringify(verified, null, 2)}\n`)
        this.options.changed()
      })
      // Resume an app that was open; new apps still start on demand.
      if (wasRunning && candidate) {
        try { await this.start(id, combined, approve) } catch (err) {
          return { ...result, text: `${checks}\nApp verified and saved. Automatic restart failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}` }
        }
      }
      return { ...result, text: `${checks}\n${result.text}` }
    } catch (err) {
      await this.serial(async () => {
        await this.stopRuntime(key)
        if (candidate && this.candidates.get(id) === candidate) candidate.error = redactSecrets(err instanceof Error ? err.message : String(err))
        this.options.changed()
      })
      if (combined.aborted) throw new Error('App operation stopped.')
      return { ok: false, text: redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 4000) }
    } finally { if (this.builds.get(id) === controller) this.builds.delete(id) }
  }

  private async testInteractions(folder: string, manifest: ProjectApp, python: string, signal: AbortSignal) {
    const test = await this.file(`.checks-${randomUUID()}`)
    await copyAppFolder(this.options.workspace, path.relative(this.options.workspace, folder), test)
    try {
      await writeFile(path.join(test, '.dalliance-check.py'), checkSource)
      await writeFile(path.join(test, '.dalliance-check.json'), JSON.stringify(manifest.checks ?? []))
      const stdout = await appCommand(python, ['-I', path.join(test, '.dalliance-check.py'), path.join(test, 'app.py'), path.join(test, '.dalliance-check.json')], { cwd: test, signal, timeoutMs: 90_000, maxBytes: 128_000 })
      const result = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as AppVerification
      if (result.ok !== true) throw new Error(`Interaction check failed: ${result.text ?? 'No result.'}`)
      return String(result.text).slice(0, 4000)
    } finally { await rm(test, { recursive: true, force: true }) }
  }

  private async publish(id: string, candidate: string, signal: AbortSignal) {
    const target = await this.file(id)
    const previous = await this.published(id)
    await this.stopRuntime(id)
    this.check(signal)
    const backup = previous ? await this.historyPath(id) : null
    if (backup) await rename(target, backup)
    try { await rename(candidate, target) } catch (err) { if (backup) await rename(backup, target); throw err }
    await this.prune(id)
  }
  private async historyPath(id: string) {
    const folder = await this.file(`.history/${id}`)
    await mkdir(folder, { recursive: true })
    return path.join(folder, `${Date.now()}-${randomUUID().slice(0, 8)}`)
  }
  private async prune(id: string) {
    const versions = await this.histories(id)
    const protectedVersion = await this.lastVerified(id, versions)
    const keep = new Set(versions.slice(0, Math.max(1, this.policy().historyLimit)))
    if (protectedVersion && !keep.has(protectedVersion)) { keep.delete([...keep].at(-1)!); keep.add(protectedVersion) }
    for (const version of versions) if (!keep.has(version)) await rm(await this.file(`.history/${id}/${version}`), { recursive: true, force: true })
  }
  private async lastVerified(id: string, versions: string[]) {
    for (const version of versions) {
      const file = await this.file(`.history/${id}/${version}/app.json`)
      const parsed = manifestSchema.safeParse(await readAppText(file, 250_000).then(JSON.parse).catch(() => null))
      if (parsed.success && parsed.data.id === id && parsed.data.verifiedAt) return version
    }
    return null
  }
  restore(id: string): Promise<void> {
    this.builds.get(id)?.abort()
    return this.serial(async () => {
      this.check()
      await this.manifest(id)
      const versions = await this.histories(id)
      const version = await this.lastVerified(id, versions) ?? versions[0]
      if (!version) throw new Error('This app has no previous version yet.')
      const previous = await this.file(`.history/${id}/${version}`)
      const manifest = await this.readManifest(previous)
      if (manifest.id !== id) throw new Error('Invalid previous version.')
      await this.publish(id, previous, new AbortController().signal)
      const candidate = this.candidates.get(id)
      if (candidate) await rm(candidate.folder, { recursive: true, force: true })
      this.candidates.delete(id)
      this.freshness.delete(id)
      this.options.changed()
    })
  }
  async refresh(id: string, kernel: Kernel, signal: AbortSignal, approve?: AppApprove) {
    const manifest = await this.manifest(id)
    if (!manifest.snapshots.length) throw new Error('This app has no notebook snapshots to refresh.')
    await this.save({ id, title: manifest.title, description: manifest.description, code: await this.source(id), requirements: manifest.requirements, snapshots: manifest.snapshots.map((s) => ({ variable: s.variable, file: path.basename(s.file) })), checks: manifest.checks, design: manifest.design }, { cellId: manifest.sourceCellId, notebook: manifest.sourceNotebook }, kernel, signal)
    const result = await this.verify(id, signal, approve)
    if (!result.ok) throw new Error(result.text)
  }
  async remove(id: string) {
    appIdSchema.parse(id)
    this.builds.get(id)?.abort()
    for (const start of this.starts.get(id) ?? []) start.abort()
    return this.serial(async () => {
      this.check()
      await this.stopRuntime(id)
      await this.stopRuntime(`build:${id}`)
      const candidate = this.candidates.get(id)
      if (candidate) await rm(candidate.folder, { recursive: true, force: true })
      this.candidates.delete(id)
      await rm(await this.file(id), { recursive: true, force: true })
      await rm(await this.file(`.history/${id}`), { recursive: true, force: true })
      this.freshness.delete(id)
      this.keep.delete(id)
      this.options.changed()
    })
  }
  async clearHistory(id: string) { return this.serial(async () => { this.check(); await this.manifest(id); await rm(await this.file(`.history/${id}`), { recursive: true, force: true }); this.options.changed() }) }

  start(id: string, signal?: AbortSignal, approve?: AppApprove): Promise<AppView> {
    appIdSchema.parse(id)
    const pending = new AbortController()
    const starts = this.starts.get(id) ?? new Set<AbortController>()
    starts.add(pending); this.starts.set(id, starts)
    const combined = signal ? AbortSignal.any([signal, pending.signal]) : pending.signal
    return this.serial(async () => {
      this.check(combined)
      const manifest = await this.published(id)
      if (!manifest) throw new Error('The app must pass verification before it can be opened.')
      const current = this.runtimes.get(id)
      if (current?.view.status === 'running') return { ...manifest, ...current.view }
      await this.stopRuntime(id)
      await this.capacity()
      const environment = await this.resolved(manifest, approve, combined)
      this.check(combined)
      const runtime = await this.launch(id, await this.file(id), manifest, environment.python, combined)
      this.stopped.delete(id)
      return { ...manifest, ...runtime.view }
    }).finally(() => { starts.delete(pending); if (!starts.size) this.starts.delete(id) })
  }
  private async capacity() {
    const active = [...this.runtimes.entries()].filter(([key, r]) => !key.startsWith('build:') && !r.ended)
    if (active.length < this.policy().maxRunning) return
    // Reclaim only apps whose actual idle timeout has elapsed. Never kill a busy or pinned app to make room.
    const idle = active.filter(([id, r]) => this.canIdleStop(id, r)).sort((a, b) => a[1].backgroundAt - b[1].backgroundAt)[0]
    if (!idle) throw new Error(`The running-app limit is ${this.policy().maxRunning}. Stop an app or change the limit in Settings > Apps.`)
    await this.stopRuntime(idle[0]); this.stopped.set(idle[0], 'capacity')
  }

  private async launch(key: string, folder: string, manifest: ProjectApp, python: string, signal: AbortSignal): Promise<Runtime> {
    const port = await freePort()
    const runtimeFolder = await this.file(`.runtime-${randomUUID()}`)
    await mkdir(runtimeFolder)
    const flags: Record<string, unknown> = {
      'server.address': '127.0.0.1', 'server.port': port, 'server.headless': true, 'server.fileWatcherType': 'none',
      'server.runOnSave': false, 'server.enableStaticServing': false, 'browser.gatherUsageStats': false, 'client.toolbarMode': 'minimal',
      ...(manifest.design !== 'custom' ? dallianceAppTheme() : {}),
    }
    await writeFile(path.join(runtimeFolder, 'supervisor.py'), supervisorSource)
    await writeFile(path.join(runtimeFolder, 'entry.py'), 'from _dalliance_runtime import run_app\nrun_app()\n')
    await writeFile(path.join(runtimeFolder, 'options.json'), JSON.stringify(flags))
    const entry = await safeAppPath(folder, 'app.py')
    this.check(signal)
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    const env = pythonEnv(process.env)
    for (const name of Object.keys(env)) if (/^STREAMLIT_|^PYTHON(?:PATH|HOME)$/.test(name)) delete env[name]
    const args = this.options.launch ? ['-I', '-m', 'streamlit', 'run', entry, `--server.port=${port}`] : ['-I', path.join(runtimeFolder, 'supervisor.py'), entry, path.join(runtimeFolder, 'entry.py'), path.join(runtimeFolder, 'options.json')]
    const child = (this.options.launch ?? spawn)(python, args, { cwd: folder, env: { ...env, PYTHONUNBUFFERED: '1' }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
    const runtime: Runtime = { child, controller, folder, manifest, runtimeFolder, exited: Promise.resolve(), ended: false, lastSignal: 0, backgroundAt: this.now(), stopping: false, view: { status: 'starting', url: null, error: null, logs: '', busy: null, memoryMb: null } }
    runtime.exited = new Promise((resolve) => {
      const exit = (error: string) => {
        runtime.ended = true; controller.abort()
        if (!runtime.stopping) runtime.view = { ...runtime.view, status: 'error', url: null, error: redactSecrets(error) }
        this.options.changed(); resolve()
      }
      child.once('error', (err) => exit(err.message))
      child.once('exit', (code, exitSignal) => exit(`App exited (${exitSignal ?? code}). ${runtime.view.logs.slice(-1000)}`))
    })
    child.stdin?.on('error', () => {})
    const log = (data: Buffer) => { runtime.view.logs = redactSecrets(runtime.view.logs + data.toString()).slice(-24_000); this.options.changed() }
    child.stdout?.on('data', log); child.stderr?.on('data', log)
    if (child.stdio[3]) {
      const lines = createInterface({ input: child.stdio[3] as Readable })
      lines.on('line', (line) => {
        if (line.length > 1000) return
        try {
          const info = JSON.parse(line) as { type?: string; busy?: boolean; memoryMb?: number }
          if (info.type === 'unknown' || info.type === 'runtime' && info.busy == null) { runtime.view.busy = null; runtime.lastSignal = 0; this.options.changed(); return }
          if (info.type !== 'runtime' || typeof info.busy !== 'boolean') return
          const now = this.now()
          const idleMs = this.policy().idleMinutes * 60_000
          if (info.busy === false && runtime.view.busy !== false && idleMs > 0 && now >= runtime.backgroundAt + idleMs) runtime.backgroundAt = now - idleMs + 60_000
          runtime.lastSignal = now; runtime.view.busy = info.busy
          if (typeof info.memoryMb === 'number' && Number.isFinite(info.memoryMb) && info.memoryMb >= 0) runtime.view.memoryMb = info.memoryMb
          this.options.changed()
        } catch { /* Protocol messages only, stdout is separate. */ }
      })
    }
    this.runtimes.set(key, runtime); this.options.changed()
    const url = `http://127.0.0.1:${port}`
    try {
      const started = Date.now()
      while (Date.now() - started < (this.options.startupTimeoutMs ?? 30_000)) {
        this.check(controller.signal)
        const response = await fetch(`${url}/_stcore/health`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]), redirect: 'error' }).catch(() => null)
        if (response?.ok && await response.text() === 'ok') {
          runtime.view = { ...runtime.view, status: 'running', url, error: null }; this.options.changed(); return runtime
        }
        await delay(150, undefined, { signal: controller.signal })
      }
      throw new Error(`App did not start in time. ${runtime.view.logs.slice(-2000)}`)
    } catch (err) {
      await this.stopRuntime(key)
      if (!signal.aborted && !this.closed && !key.startsWith('build:')) {
        runtime.view = { ...runtime.view, status: 'error', url: null, error: redactSecrets(err instanceof Error ? err.message : String(err)) }
        this.runtimes.set(key, runtime); this.options.changed()
      }
      throw err
    } finally { signal.removeEventListener('abort', abort) }
  }

  visibleApp(id: string | null) {
    if (id !== null) appIdSchema.parse(id)
    if (id === this.visible) return
    if (this.visible) { const previous = this.runtimes.get(this.visible); if (previous) previous.backgroundAt = this.now() }
    this.visible = id
    this.options.changed()
  }
  keepRunning(id: string, keep: boolean) {
    appIdSchema.parse(id)
    if (typeof keep !== 'boolean') throw new Error('Invalid Keep running setting.')
    if (keep) this.keep.add(id)
    else { this.keep.delete(id); const runtime = this.runtimes.get(id); if (runtime) runtime.backgroundAt = this.now() }
    this.options.changed()
  }
  private canIdleStop(id: string, runtime: Runtime) {
    return this.policy().idleMinutes > 0 && this.visible !== id && !this.keep.has(id) && runtime.view.busy === false && this.now() - runtime.lastSignal < 10_000 && this.now() - runtime.backgroundAt >= this.policy().idleMinutes * 60_000
  }
  applyPolicy() {
    return this.serial(async () => {
      if (this.closed) return
      for (const runtime of this.runtimes.values()) runtime.backgroundAt = this.now()
      for (const app of await this.list()) if (await this.published(app.id)) await this.prune(app.id)
      this.options.changed()
    })
  }
  sweep() {
    return this.serial(async () => {
      if (this.closed) return
      for (const [id, runtime] of this.runtimes) if (!id.startsWith('build:') && this.canIdleStop(id, runtime)) {
        await this.stopRuntime(id); this.stopped.set(id, 'idle'); this.options.changed()
      }
    })
  }
  stop(id: string) {
    appIdSchema.parse(id)
    this.builds.get(id)?.abort()
    for (const start of this.starts.get(id) ?? []) start.abort()
    this.runtimes.get(id)?.controller.abort()
    return this.serial(async () => { await this.stopRuntime(id); await this.stopRuntime(`build:${id}`); this.stopped.set(id, 'manual'); this.options.changed() })
  }
  private async stopRuntime(key: string) {
    const runtime = this.runtimes.get(key)
    if (!runtime) return
    runtime.stopping = true; runtime.controller.abort()
    runtime.view = { ...runtime.view, status: 'stopped', url: null, error: null }
    killGroup(runtime.child, 'SIGTERM')
    const timer = setTimeout(() => killGroup(runtime.child, 'SIGKILL'), 1500)
    try { await runtime.exited } finally { clearTimeout(timer) }
    if (this.runtimes.get(key) === runtime) this.runtimes.delete(key)
    await rm(runtime.runtimeFolder, { recursive: true, force: true })
    this.options.changed()
  }
  async shutdown() {
    this.closed = true; clearInterval(this.ticker)
    for (const build of this.builds.values()) build.abort()
    for (const starts of this.starts.values()) for (const start of starts) start.abort()
    for (const runtime of this.runtimes.values()) runtime.controller.abort()
    await Promise.all([...this.runtimes.keys()].map((id) => this.stopRuntime(id)))
    await this.queue
    await Promise.allSettled([...this.buildTasks])
    for (const candidate of this.candidates.values()) await rm(candidate.folder, { recursive: true, force: true })
    this.candidates.clear()
  }
  followsAppearance(url: string): boolean {
    try { const origin = new URL(url).origin; return [...this.runtimes.values()].some((r) => r.view.url === origin && r.manifest.design !== 'custom') } catch { return false }
  }
  allows(url: string): boolean {
    try { const origin = new URL(url).origin; return [...this.runtimes.values()].some((r) => r.view.url === origin && r.view.status === 'running') } catch { return false }
  }

  async checkData(kernel: Kernel | null) {
    const apps = await this.list()
    const jobs = apps.flatMap((app) => app.snapshots.map((s) => ({ id: app.id, variable: s.variable, csv: s.file.endsWith('.csv') })))
    if (!kernel || kernel.info().status !== 'idle') { for (const app of apps) this.freshness.set(app.id, app.snapshots.length ? 'unavailable' : 'current'); return }
    if (!jobs.length) return
    const code = `def _dalliance_app_hashes():\n    import json,hashlib\n    answer=[]\n    for item in json.loads(${JSON.stringify(JSON.stringify(jobs))}):\n        try:\n            value=globals()[item['variable']]\n            raw=value.to_csv(index=False) if item['csv'] else json.dumps(value,allow_nan=False)\n            answer.append('sha256:'+hashlib.sha256(raw.encode('utf-8')).hexdigest())\n        except Exception:\n            answer.append(None)\n    print('DALLIANCE_APP_HASHES='+json.dumps(answer))\ntry:\n    _dalliance_app_hashes()\nfinally:\n    del _dalliance_app_hashes\n`
    const timer = setTimeout(() => kernel.interrupt(), 10_000)
    const result = await kernel.execute(code, { store: false }).finally(() => clearTimeout(timer))
    const text = outputsToText(result.outputs, 20_000)
    const match = /DALLIANCE_APP_HASHES=(\[[^\n]+\])/.exec(text)
    const hashes: (string | null)[] = match ? JSON.parse(match[1]) : jobs.map(() => null)
    let index = 0
    for (const app of apps) {
      let state: AppView['dataState'] = 'current'
      for (const snapshot of app.snapshots) { const hash = hashes[index++]; if (hash == null || !snapshot.sourceHash) { if (state !== 'changed') state = 'unavailable' } else if (hash !== snapshot.sourceHash) state = 'changed' }
      this.freshness.set(app.id, state)
    }
    this.options.changed()
  }
}
