import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WebContents } from 'electron'
import { type Brief, type CellRunResult, type FileEntry, IPC, type KernelState, type PythonState, type RunCellRequest, type RunEvent } from '@ilios/shared/ipc'
import { createApproval, normalize } from './harness/approval'
import { EventBus } from './harness/events'
import { MissingKeyError, resolveModel } from './harness/model'
import { friendlyError, runCell } from './harness/run-cell'
import { generateTitle, titleModel } from './harness/title'
import type { KernelInfo } from './kernel/kernel'
import { installPackages, pythonStatus, setupManagedEnv } from './kernel/python-env'
import { PythonKernel } from './kernel/python-kernel'
import { isBroadFolder, listFiles } from './harness/workspace'
import type { SettingsStore } from './settings'

interface SessionOptions {
  settings: SettingsStore
  userData: string
  defaultWorkspace: string
  send: (channel: string, ...args: unknown[]) => void
}

/**
 * Owns the kernel and the harness for the open notebook.
 * One cell runs at a time; the renderer queues Run all.
 */
export class NotebookSession {
  private kernel: PythonKernel | null = null
  private kernelStarting: Promise<PythonKernel> | null = null
  private workspace: string
  private controller: AbortController | null = null
  private pending = new Map<string, (answer: string | boolean | null) => void>()
  private trust = new Set<string>()
  private nextRequest = 0
  private lastKernelState: KernelState
  readonly bus = new EventBus()
  private readonly options: SessionOptions

  constructor(options: SessionOptions) {
    this.options = options
    this.workspace = options.defaultWorkspace
    this.lastKernelState = { status: 'dead', python: null, cwd: this.workspace, error: null }
    this.installExtensions()
  }

  /** Built-in extensions on the event bus: keep .env files private, and log every run to JSONL. */
  private installExtensions() {
    this.bus.on('tool_call', ({ toolName, input }) => {
      const p = String((input as { path?: string } | undefined)?.path ?? '')
      if (toolName === 'read_file' && /(^|\/)\.env(\..*)?$/.test(p)) return { block: true, reason: `${p} may hold secrets, so it is off limits.` }
    })
    const logDir = path.join(this.options.userData, 'logs')
    const log = async (event: string, data: object) => {
      await mkdir(logDir, { recursive: true })
      const line = JSON.stringify({ at: new Date().toISOString(), event, ...data }, (_k, v) => (typeof v === 'string' && v.length > 2000 ? `${v.slice(0, 2000)}…` : v))
      await appendFile(path.join(logDir, 'agent.jsonl'), `${line}\n`)
    }
    for (const event of ['run_start', 'tool_call', 'tool_result', 'run_end'] as const) {
      this.bus.on(event, (data) => {
        void log(event, data).catch(() => {})
      })
    }
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

  /** Files in the notebook's folder, as the agent sees them. None for a broad folder like Documents. */
  async files(): Promise<FileEntry[]> {
    if (isBroadFolder(this.workspace)) return []
    return (await listFiles(this.workspace))
      .map((line) => line.match(/^(.*) \(([^)]+)\)$/))
      .filter((m): m is RegExpMatchArray => m != null)
      .map((m) => ({ path: m[1], size: m[2] }))
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

  async pythonState(): Promise<PythonState> {
    return pythonStatus({ configured: this.options.settings.pythonPath, envDir: this.envDir })
  }

  private get envDir() {
    return path.join(this.options.userData, 'python-env')
  }

  async setupPython(): Promise<PythonState> {
    await setupManagedEnv(this.envDir, (line) => this.options.send(IPC.pythonLog, line))
    await this.restart()
    return this.pythonState()
  }

  private async ensureKernel(): Promise<PythonKernel> {
    if (this.kernel && this.kernel.info().status !== 'dead') return this.kernel
    if (this.kernelStarting) return this.kernelStarting
    this.kernelStarting = (async () => {
      const status = await this.pythonState()
      if (!status.python) {
        const error = 'No Python found. Open Settings to set up a Python environment.'
        this.lastKernelState = { status: 'dead', python: null, cwd: this.workspace, error }
        this.options.send(IPC.kernelStateChanged, this.lastKernelState)
        throw new Error(error)
      }
      const kernel = new PythonKernel({
        python: status.python,
        cwd: this.workspace,
        scratchDir: path.join(this.options.userData, 'kernel'),
        onStatus: (info) => this.publishKernel(info),
      })
      await kernel.start()
      this.kernel = kernel
      return kernel
    })().finally(() => {
      this.kernelStarting = null
    })
    return this.kernelStarting
  }

  /** Start the kernel in the background so the first run doesn't wait for it. */
  warmUp() {
    void this.ensureKernel().catch(() => {})
  }

  /** A new or opened notebook gets a fresh kernel in its own folder. */
  async openWorkspace(dir: string | null) {
    this.workspace = dir ?? this.options.defaultWorkspace
    await this.restart()
  }

  /** After Save As into another folder, move the running kernel there without losing its state. */
  async moveWorkspace(dir: string) {
    if (dir === this.workspace) return
    this.workspace = dir
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
      error,
    })

    let model
    let providerOptions
    if (request.generate) {
      try {
        ;({ model, providerOptions } = resolveModel(this.options.settings.modelConfig()))
      } catch (err) {
        return fail(err instanceof MissingKeyError ? err.message : friendlyError(err))
      }
    }

    let kernel: PythonKernel
    try {
      emit({ type: 'status', text: 'Starting Python' })
      kernel = await this.ensureKernel()
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }

    // Name the cell with the small model while the cell runs. It never holds up the run.
    if (request.nameIt && this.options.settings.autoTitles) {
      const small = titleModel(this.options.settings.modelConfig())
      if (small) {
        void generateTitle(request.prompt, small).then((title) => {
          if (title) emit({ type: 'title', title, prompt: request.prompt })
        })
      }
    }

    const controller = new AbortController()
    this.controller = controller
    const ask = (event: (requestId: string) => RunEvent) =>
      new Promise<string | boolean | null>((resolve) => {
        const requestId = `r${++this.nextRequest}`
        this.pending.set(requestId, resolve)
        emit(event(requestId))
      })

    try {
      const pythonVersion = kernel.info().python
      return await runCell(request, {
        model: model!,
        providerOptions,
        kernel,
        workspaceDir: this.workspace,
        bus: this.bus,
        pythonVersion,
        projectInstructions: (await this.readBrief()).text,
        modelId: this.options.settings.modelConfig().model,
        emit,
        askUser: async (question, options) => {
          const answer = await ask((requestId) => ({ type: 'question', requestId, question, options }))
          return typeof answer === 'string' ? answer : null
        },
        requestApproval: async (title, detail) => {
          const approved = (await ask((requestId) => ({ type: 'approval', requestId, title, detail }))) === true
          if (approved) {
            // Trust these packages for the rest of the session, so the same install isn't asked twice
            const names = detail.replace(/^pip install /, '').split(' ')
            for (const n of names) this.trust.add(normalize(n))
          }
          return approved
        },
        needsApproval: createApproval({ mode: this.options.settings.approvalMode }, this.trust),
        installPackages: async (packages) => {
          const lines: string[] = []
          await installPackages(kernel.info().executable ?? 'python3', packages, (line) => lines.push(line))
          return lines.slice(-10).join('\n')
        },
        signal: controller.signal,
      })
    } catch (err) {
      return fail(controller.signal.aborted ? 'Stopped.' : friendlyError(err))
    } finally {
      if (this.controller === controller) this.controller = null
      this.resolvePending(null)
    }
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

  async restart() {
    this.interrupt()
    const old = this.kernel
    this.kernel = null
    await old?.shutdown()
    this.warmUp()
  }

  async shutdown() {
    this.interrupt()
    await this.kernel?.shutdown()
  }
}
