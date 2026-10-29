import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WebContents } from 'electron'
import { appIdFromCode, type AppVerification, type AppView } from '@dalliance/shared/apps'
import { ProjectApps } from './apps/project-apps'
import { AppEnvironments } from './apps/environment'
import type { ChartThemeName } from '@dalliance/shared/chart-theme'
import {
  type Brief,
  type CellRunResult,
  type EnvironmentView,
  type FileEntry,
  IPC,
  type KernelState,
  type PinChange,
  type PythonState,
  type RunCellRequest,
  type RunEvent,
} from '@dalliance/shared/ipc'
import type { Notebook, Pins } from '@dalliance/shared/notebook'
import { FileHasher } from './file-hash'
import { approver, createApproval, normalize } from './harness/approval'
import { EventBus } from './harness/events'
import { installExtensions } from './harness/extensions'
import { type ModelCall, costOf } from './harness/cost'
import { ModelSetupError, resolveModel } from './harness/model'
import type { PrepareImage } from './harness/images'
import { friendlyError, runCell } from './harness/run-cell'
import { generateTitle, titleModel } from './harness/title'
import type { Kernel, KernelEnvironment, KernelInfo } from './kernel/kernel'
import { installPackages, pythonStatus, setupManagedEnv } from './kernel/python-env'
import { installedPackages } from './kernel/python-packages'
import { PythonKernel } from './kernel/python-kernel'
import { listDirectory } from './workspace-files'
import { folderForNewNotebook } from './notebook-files'
import { comparePins, pinNotebook, pinnedPath } from './pins'
import type { SettingsStore } from './settings'

interface SessionOptions {
  verifyApp?: (url: string, signal: AbortSignal) => Promise<AppVerification>
  approveApp?: (title: string, detail: string) => Promise<boolean>
  settings: SettingsStore
  userData: string
  defaultWorkspace: string
  send: (channel: string, ...args: unknown[]) => void
  /** Starts a kernel in `cwd`. Defaults to the Python kernel; tests pass a fake. */
  launchKernel?: (cwd: string, onStatus: (info: KernelInfo) => void) => Promise<Kernel>
  /** Lists a Python's libraries. Defaults to `installedPackages`; tests pass a fake. */
  listPackages?: typeof installedPackages
  /** Hashes data files for the pins. Tests pass one with a small size limit. */
  hasher?: FileHasher
  /** Shrinks an image before the agent sees it. main.ts passes one on Electron's nativeImage; tests leave it out. */
  prepareImage?: PrepareImage
  chartTheme?: () => ChartThemeName
}

/** How long a save waits for the kernel to say what it imported before it keeps the pins it has. */
const ENVIRONMENT_TIMEOUT_MS = 5000

/**
 * Owns the kernel and the harness for the open notebook.
 * One cell runs at a time; the renderer queues Run all.
 */
export class NotebookSession {
  private kernel: Kernel | null = null
  private kernelStarting: { generation: number; promise: Promise<Kernel> } | null = null
  /** Bumped by every restart. A kernel start from an earlier generation is stale and shuts itself down. */
  private generation = 0
  /** Set on quit, so a start still in flight doesn't leave a kernel behind. */
  private closed = false
  private workspace: string
  private controller: AbortController | null = null
  private pending = new Map<string, (answer: string | boolean | null) => void>()
  private trust = new Set<string>()
  private nextRequest = 0
  private lastKernelState: KernelState
  /** The files each cell's last run in the current kernel read, by cell id. Cleared with every new kernel. */
  private ran = new Map<string, string[]>()
  /** The current kernel's last answer about what it imported, for a save while a cell runs. */
  private lastEnvironment: KernelEnvironment | null = null
  private readonly hasher: FileHasher
  readonly bus = new EventBus()
  private readonly options: SessionOptions
  private projectApps: ProjectApps
  private retiringApps = new Set<Promise<void>>()

  constructor(options: SessionOptions) {
    this.options = options
    // A remembered Documents or home folder came from a notebook kept there. Without that notebook, start in the default.
    this.workspace = folderForNewNotebook(options.settings.workspaceDir ?? options.defaultWorkspace, options.defaultWorkspace)
    this.lastKernelState = { status: 'dead', python: null, cwd: this.workspace, error: null }
    this.projectApps = this.createApps()
    this.hasher = options.hasher ?? new FileHasher()

    // Keep .env files private, and log every run to logs/agent.jsonl
    installExtensions(this.bus, { logDir: path.join(options.userData, 'logs') })
  }

  private createApps() {
    const python = async () => {
        const status = await this.pythonState()
        if (!status.python) throw new Error('Set up Python in Settings before running an app.')
        return status.python
    }
    return new ProjectApps({
      workspace: this.workspace, python,
      environment: new AppEnvironments(this.options.userData, this.workspace, python),
      policy: () => this.options.settings.appPolicy,
      changed: () => this.options.send(IPC.appsChanged),
      verify: this.options.verifyApp,
    })
  }

  applyAppPolicy() { return this.projectApps.applyPolicy() }

  listApps(): Promise<AppView[]> { return this.projectApps.list() }

  async startApp(id: string) {
    const apps = this.projectApps
    // Manually edited or imported apps pass the same policy as generated code before execution.
    const code = await apps.source(id)
    const approve = this.appApprover()
    const gate = await this.bus.emit('tool_call', { cellId: 'apps', toolName: 'save_app', input: { code }, approve })
    if (gate.blocked) throw new Error(gate.reason)
    return apps.start(id, undefined, approve)
  }

  private appApprover() {
    return approver(createApproval({ mode: this.options.settings.approvalMode }, this.trust), async (title, detail, keys) => {
      const allowed = await this.options.approveApp?.(title, detail) ?? false
      if (allowed) for (const key of keys) this.trust.add(normalize(key))
      return allowed
    })
  }

  stopApp(id: string) { return this.projectApps.stop(id) }
  restoreApp(id: string) { return this.projectApps.restore(id) }
  deleteApp(id: string) { return this.projectApps.remove(id) }
  clearAppHistory(id: string) { return this.projectApps.clearHistory(id) }
  keepAppRunning(id: string, keep: boolean) { this.projectApps.keepRunning(id, keep) }
  setVisibleApp(id: string | null) { this.projectApps.visibleApp(id) }
  async refreshAppData(id: string) {
    if (this.controller || this.kernel?.info().status === 'busy') throw new Error('Wait for the running notebook cell before refreshing app data.')
    const apps = this.projectApps
    const kernel = await this.ensureKernel()
    const controller = new AbortController()
    this.controller = controller
    try {
      const code = await apps.source(id)
      const approve = this.appApprover()
      const gate = await this.bus.emit('tool_call', { cellId: 'apps', toolName: 'save_app', input: { code }, approve })
      if (gate.blocked) throw new Error(gate.reason)
      await apps.refresh(id, kernel, controller.signal, approve)
      await apps.checkData(kernel)
    } finally { if (this.controller === controller) this.controller = null }
  }
  appFollowsAppearance(url: string) { return this.projectApps.followsAppearance(url) }
  allowsAppUrl(url: string) { return this.projectApps.allows(url) }

  /** Changing projects or Python invalidates starts in flight before awaiting their shutdown. */
  async resetApps() {
    const old = this.projectApps
    this.projectApps = this.createApps()
    const shuttingDown = old.shutdown()
    this.retiringApps.add(shuttingDown)
    try { await shuttingDown } finally { this.retiringApps.delete(shuttingDown) }
    this.options.send(IPC.appsChanged)
  }

  private get briefPath() {
    return path.join(this.workspace, 'AGENTS.md')
  }

  /** The brief is the notebook folder's AGENTS.md. The agent reads it before every cell. */
  async readBrief(): Promise<Brief> {
    return { path: this.briefPath, text: await readFile(this.briefPath, 'utf-8').catch(() => null) }
  }

  async writeBrief(text: string): Promise<Brief> {
    await writeFile(this.briefPath, text.endsWith('\n') || !text ? text : `${text}\n`)
    return this.readBrief()
  }

  /** Immediate entries for the Files pane, loaded on expansion without a file or depth limit. */
  async files(directory?: unknown): Promise<FileEntry[]> {
    return listDirectory(this.workspace, directory)
  }

  /** Variables for the sidebar. Empty until the kernel is running. */
  async variables() {
    if (!this.kernel || this.kernel.info().status === 'dead') return []
    return this.kernel.variables().catch(() => [])
  }

  kernelState(): KernelState {
    return this.lastKernelState
  }

  private publishKernel(info: KernelInfo) {
    this.lastKernelState = { status: info.status, python: info.python, cwd: info.cwd, error: info.error }
    this.options.send(IPC.kernelStateChanged, this.lastKernelState)
  }

  /** The Python in use and its libraries, read from the interpreter itself so a running cell doesn't hold it up. */
  async environment(): Promise<EnvironmentView> {
    const status = await this.pythonState()
    if (!status.python) return { python: null, version: null, packages: [], error: 'No Python found. Open Settings to set up a Python environment.' }
    try {
      // Run in userData, not the process's working directory, so no stray json.py can shadow the standard library
      const packages = await (this.options.listPackages ?? installedPackages)(status.python, { cwd: this.options.userData })
      return { python: status.python, version: status.version, packages, error: null }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return { python: status.python, version: status.version, packages: [], error: `Couldn't list the libraries: ${reason}` }
    }
  }

  async pythonState(): Promise<PythonState> {
    return pythonStatus({ configured: this.options.settings.pythonPath, envDir: this.envDir })
  }

  private get envDir() {
    return path.join(this.options.userData, 'python-env')
  }

  private logPython = (line: string) => this.options.send(IPC.pythonLog, line)

  async setupPython(): Promise<PythonState> {
    await setupManagedEnv(this.envDir, this.logPython)
    await this.restart()
    return this.pythonState()
  }

  private async ensureKernel(): Promise<Kernel> {
    if (this.closed) throw new Error('Dalliance is quitting.')
    if (this.kernel && this.kernel.info().status !== 'dead') return this.kernel
    if (this.kernelStarting?.generation === this.generation) return this.kernelStarting.promise
    const generation = this.generation
    const cwd = this.workspace
    const current = () => generation === this.generation
    const promise = (async (): Promise<Kernel> => {
      let kernel: Kernel
      try {
        kernel = await (this.options.launchKernel ?? this.launchPython)(cwd, (info) => {
          // A stale kernel's status would overwrite the current one's in the renderer
          if (current()) this.publishKernel(info)
        })
      } catch (err) {
        if (current()) throw err
        return this.ensureKernel()
      }
      if (!current()) {
        // A restart or a new folder came while this one was starting, so it may be in the wrong folder.
        // Shut it down and hand anyone waiting on it the current kernel instead.
        await kernel.shutdown().catch(() => {})
        return this.ensureKernel()
      }
      this.kernel = kernel
      this.forgetRuns()
      return kernel
    })().finally(() => {
      if (this.kernelStarting?.promise === promise) this.kernelStarting = null
    })
    this.kernelStarting = { generation, promise }
    return promise
  }

  private launchPython = async (cwd: string, onStatus: (info: KernelInfo) => void): Promise<Kernel> => {
    const status = await this.pythonState()
    if (!status.python) {
      const error = 'No Python found. Open Settings to set up a Python environment.'
      onStatus({ status: 'dead', python: null, executable: null, cwd, error })
      throw new Error(error)
    }
    const kernel = new PythonKernel({
      python: status.python,
      cwd,
      scratchDir: path.join(this.options.userData, 'kernel'),
      onStatus,
      chartTheme: this.options.chartTheme,
    })
    await kernel.start()
    return kernel
  }

  /** Start the kernel in the background so the first run doesn't wait for it. */
  warmUp() {
    void this.ensureKernel().catch(() => {})
  }

  /** The folder in use: the kernel's working directory, where the agent reads, and where new notebooks go. */
  get dir() {
    return this.workspace
  }

  /** A new or opened notebook gets a fresh kernel in its own folder. The folder is remembered for the next launch. */
  async openWorkspace(dir: string | null) {
    const next = dir ?? this.options.defaultWorkspace
    const moved = next !== this.workspace
    this.workspace = next
    if (moved) { this.interrupt(); await this.resetApps() }
    this.options.settings.setWorkspaceDir(this.workspace)
    await this.restart()
  }

  /** After Save As into another folder, move the running kernel there without losing its state. */
  async moveWorkspace(dir: string) {
    if (dir === this.workspace) return
    this.workspace = dir
    await this.resetApps()
    this.options.settings.setWorkspaceDir(dir)
    if (this.kernel && this.kernel.info().status !== 'dead') {
      await this.kernel.execute(`import os as _os\n_os.chdir(${JSON.stringify(dir)})\ndel _os`, { store: false })
    }
  }

  async runCell(request: RunCellRequest, contents: WebContents): Promise<CellRunResult> {
    const emit = (event: RunEvent) => {
      if (!contents.isDestroyed()) contents.send(IPC.runEvent, request.cellId, event)
    }
    const fail = (error: string): CellRunResult => ({
      ok: false,
      code: request.code,
      outputs: [],
      executionCount: null,
      durationMs: 0,
      generated: request.generate,
      interpretation: null,
      answer: null,
      suggestions: [],
      variables: [],
      activity: [],
      steps: [],
      error,
    })

    // The run's model, read once, so the title and the run use the same settings
    const config = this.options.settings.modelConfig()
    let model
    let providerOptions
    if (request.generate) {
      try {
        ;({ model, providerOptions } = resolveModel(config))
      } catch (err) {
        return fail(err instanceof ModelSetupError ? err.message : friendlyError(err))
      }
    }

    let kernel: Kernel
    try {
      emit({ type: 'status', text: 'Starting Python' })
      kernel = await this.ensureKernel()
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }

    const controller = new AbortController()
    this.controller = controller
    const apps = this.projectApps

    // Name generated cells with the selected provider. Saved-code runs make no model requests.
    if (request.generate && request.nameIt && this.options.settings.autoTitles) {
      const small = titleModel(config)
      if (small) {
        let call: ModelCall | null = null
        void generateTitle(request.prompt, small, controller.signal, (c) => (call = c)).then(async (title) => {
          if (!title || controller.signal.aborted) return
          const cost = call ? costOf([call]) : undefined
          emit({ type: 'title', title, prompt: request.prompt, ...(cost ? { cost } : {}) })
        })
      }
    }

    // What the cell's runs read goes into the notebook's pins on save. Hash it now, so the save finds it ready
    const tracked = this.tracking(kernel, request.cellId)

    const ask = (event: (requestId: string) => RunEvent) =>
      new Promise<string | boolean | null>((resolve) => {
        const requestId = `r${++this.nextRequest}`
        this.pending.set(requestId, resolve)
        emit(event(requestId))
      })

    try {
      const pythonVersion = kernel.info().python
      const result = await runCell(request, {
        apps: {
          list: () => apps.list(),
          save: async (draft, approve) => {
            const saved = await apps.save({ ...draft, id: draft.id ?? appIdFromCode(request.code) ?? undefined }, { cellId: request.cellId, notebook: request.notebookName ? path.basename(request.notebookName) : null }, tracked, controller.signal)
            return { id: saved.id, verification: await apps.verify(saved.id, controller.signal, approve) }
          },
        },
        model: model!,
        providerOptions,
        kernel: tracked,
        workspaceDir: this.workspace,
        bus: this.bus,
        pythonVersion,
        projectInstructions: (await this.readBrief()).text,
        modelId: config.model,
        effort: config.effort,
        suggestNext: this.options.settings.suggestNext,
        emit,
        askUser: async (question, options) => {
          const answer = await ask((requestId) => ({ type: 'question', requestId, question, options }))
          return typeof answer === 'string' ? answer : null
        },
        requestApproval: async (title, detail, keys) => {
          const approved = (await ask((requestId) => ({ type: 'approval', requestId, title, detail }))) === true
          // Trust these packages, or this kind of code, for the rest of the session, so it isn't asked twice
          if (approved) for (const key of keys) this.trust.add(normalize(key))
          return approved
        },
        needsApproval: createApproval({ mode: this.options.settings.approvalMode }, this.trust),
        installPackages: async (packages) => {
          const lines: string[] = []
          await installPackages(kernel.info().executable ?? 'python3', packages, (line) => lines.push(line))
          return lines.slice(-10).join('\n')
        },
        prepareImage: this.options.prepareImage,
        signal: controller.signal,
      })
      if (!controller.signal.aborted) await apps.checkData(kernel).catch(() => {})
      // Counted whether or not Show token usage is on, so turning it on shows the runs made while it was off
      const cost = costOf(result.steps.map((s) => ({ model: s.modelId ?? config.model, usage: s.usage })))
      return cost ? { ...result, cost } : result
    } catch (err) {
      return fail(controller.signal.aborted ? 'Stopped.' : friendlyError(err))
    } finally {
      if (this.controller === controller) this.controller = null
      this.resolvePending(null)
    }
  }

  /**
   * The kernel as a run sees it, noting what each cell run (not an explore) read. The last one wins, which for a
   * generation is the final attempt. Those files are hashed in the background.
   */
  private tracking(kernel: Kernel, cellId: string): Kernel {
    return {
      info: () => kernel.info(),
      execute: async (code, options) => {
        const result = await kernel.execute(code, options)
        if (options.store && this.kernel === kernel) {
          const paths = result.filesRead?.paths ?? []
          this.ran.set(cellId, paths)
          this.hasher.warm(paths.map((p) => pinnedPath(this.workspace, p)).filter((p): p is string => p != null))
        }
        return result
      },
      variables: () => kernel.variables(),
      environment: () => kernel.environment(),
      interrupt: () => kernel.interrupt(),
      restart: () => kernel.restart(),
      shutdown: () => kernel.shutdown(),
    }
  }

  private forgetRuns() {
    this.ran = new Map()
    this.lastEnvironment = null
  }

  /**
   * What the kernel imported, for the pins. A kernel running a cell would only answer once the cell ends, so a
   * save then uses its last answer. Null when there is no kernel, or it never answered.
   */
  private async kernelEnvironment(): Promise<KernelEnvironment | null> {
    const kernel = this.kernel
    if (!kernel || kernel.info().status === 'dead') return null
    if (kernel.info().status === 'busy') return this.lastEnvironment
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ENVIRONMENT_TIMEOUT_MS)))
    const answer = await Promise.race([kernel.environment().catch(() => null), timeout]).finally(() => clearTimeout(timer))
    if (answer && this.kernel === kernel) this.lastEnvironment = answer
    return answer ?? this.lastEnvironment
  }

  /**
   * The notebook with its pins recorded: the Python, the packages its cells imported and the data files they read.
   * See docs/notebook-model.md#pins. Recording never stops a save: if it fails, the notebook keeps the pins it had.
   */
  async pin(notebook: Notebook): Promise<Notebook> {
    try {
      const pins = await pinNotebook({
        notebook,
        dir: this.workspace,
        environment: await this.kernelEnvironment(),
        ran: this.ran,
        fingerprint: (file) => this.hasher.fingerprint(file),
      })
      const next: Notebook = { ...notebook }
      if (pins) next.pins = pins
      else delete next.pins
      return next
    } catch (err) {
      console.warn(`Couldn't record the notebook's environment: ${err instanceof Error ? err.message : String(err)}`)
      return notebook
    }
  }

  /** What changed since the pins were recorded, in the folder in use and the Python the kernel runs on. */
  async checkPins(pins: Pins): Promise<PinChange[]> {
    return comparePins(pins, { dir: this.workspace, environment: await this.environment(), fingerprint: (file) => this.hasher.fingerprint(file) })
  }

  respond(requestId: string, answer: string | boolean | null) {
    const resolve = this.pending.get(requestId)
    this.pending.delete(requestId)
    resolve?.(answer)
  }

  private resolvePending(answer: null) {
    for (const [id, resolve] of this.pending) {
      this.pending.delete(id)
      resolve(answer)
    }
  }

  interrupt() {
    this.controller?.abort()
    this.resolvePending(null)
    this.kernel?.interrupt()
  }

  /** A fresh kernel in the current workspace. A start still in flight is discarded, since it may be in the old folder. */
  async restart() {
    this.interrupt()
    this.generation++
    const old = this.kernel
    this.kernel = null
    this.forgetRuns()
    await this.projectApps.checkData(null).catch(() => {})
    await old?.shutdown()
    this.warmUp()
  }

  async shutdown() {
    this.interrupt()
    this.closed = true
    this.generation++
    const kernel = this.kernel
    this.kernel = null
    await Promise.all([kernel?.shutdown(), this.projectApps.shutdown(), ...this.retiringApps])
  }
}
