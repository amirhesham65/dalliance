// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import type { WebContents } from 'electron'
import { IPC, type KernelState } from '@dalliance/shared/ipc'
import { type Notebook, newPromptCell } from '@dalliance/shared/notebook'
import { FakeKernel } from './kernel/fake-kernel'
import type { KernelInfo } from './kernel/kernel'
import { NotebookSession } from './session'
import { SettingsStore } from './settings'
import * as titles from './harness/title'

// Only the sessions below that don't pass launchKernel reach these: the real launcher with a fake Python
vi.mock('./kernel/python-env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./kernel/python-env')>()),
  pythonStatus: async () => ({ python: '/py/bin/python', version: '3.12.0', source: 'managed', managedEnvExists: true, missingPackages: [] }),
}))
vi.mock('./kernel/python-kernel', async () => {
  const { FakeKernel } = await import('./kernel/fake-kernel')
  return {
    PythonKernel: class extends FakeKernel {
      async start() {}
    },
  }
})

// The model a run gets, for the cost tests. Everything else in the module is real
const agent = vi.hoisted(() => ({ model: null as unknown }))
vi.mock('./harness/model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./harness/model')>()),
  resolveModel: () => ({ model: agent.model, providerOptions: undefined }),
}))

/** A kernel that remembers its folder and whether it was shut down. */
class FolderKernel extends FakeKernel {
  stopped = false
  /** Reported as running a cell. */
  busy = false
  readonly cwd: string
  constructor(cwd: string, handler?: ConstructorParameters<typeof FakeKernel>[0]) {
    super(handler)
    this.cwd = cwd
  }
  override info(): KernelInfo {
    return { ...super.info(), cwd: this.cwd, status: this.stopped ? 'dead' : this.busy ? 'busy' : 'idle' }
  }
  override async shutdown() {
    this.stopped = true
  }
}

/** Kernel starts that finish only when the test says so. */
function slowLauncher() {
  const starts: { cwd: string; kernel: FolderKernel; onStatus: (info: KernelInfo) => void; finish: () => void }[] = []
  const launchKernel = (cwd: string, onStatus: (info: KernelInfo) => void) =>
    new Promise<FolderKernel>((resolve) => {
      const kernel = new FolderKernel(cwd)
      starts.push({ cwd, kernel, onStatus, finish: () => resolve(kernel) })
    })
  return { starts, launchKernel }
}

function session(launchKernel: (cwd: string, onStatus: (info: KernelInfo) => void) => Promise<FolderKernel>, workspaceDir: string | null = null) {
  const sent: KernelState[] = []
  const s = new NotebookSession({
    // Only what the session reads and writes about the folder in use
    settings: { workspaceDir, setWorkspaceDir: () => {} } as unknown as SettingsStore,
    userData: mkdtempSync(path.join(tmpdir(), 'dalliance-session-')),
    defaultWorkspace: '/default',
    send: (channel, state) => {
      if (channel === IPC.kernelStateChanged) sent.push(state as KernelState)
    },
    launchKernel,
  })
  return { s, sent }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('NotebookSession folder in use', () => {
  it('starts in the remembered folder, but in the default one when that is Documents or another broad folder', async () => {
    const { starts, launchKernel } = slowLauncher()
    session(launchKernel, '/notebooks/sales').s.warmUp()
    session(launchKernel, path.join(homedir(), 'Documents')).s.warmUp()
    session(launchKernel, homedir()).s.warmUp()
    await tick()
    expect(starts.map((x) => x.cwd)).toEqual(['/notebooks/sales', '/default', '/default'])
  })
})

describe('NotebookSession kernel lifecycle', () => {
  it('starts the kernel in the opened notebook’s folder even while the launch warm-up is still starting', async () => {
    const { starts, launchKernel } = slowLauncher()
    const { s, sent } = session(launchKernel)

    s.warmUp()
    await tick()
    expect(starts.map((x) => x.cwd)).toEqual(['/default'])

    const opened = s.openWorkspace('/notebooks/sales')
    await opened
    await tick()
    expect(starts.map((x) => x.cwd)).toEqual(['/default', '/notebooks/sales'])

    // The stale start finishes late: it shuts itself down, and its status never reaches the window
    starts[0].onStatus(starts[0].kernel.info())
    starts[0].finish()
    await tick()
    expect(starts[0].kernel.stopped).toBe(true)
    expect(sent).toEqual([])

    starts[1].onStatus(starts[1].kernel.info())
    starts[1].finish()
    await tick()
    expect(starts[1].kernel.stopped).toBe(false)
    expect(sent.map((k) => k.cwd)).toEqual(['/notebooks/sales'])
    expect(s.kernelState().cwd).toBe('/notebooks/sales')
  })

  it('hands a caller waiting on a stale start the kernel in the current folder', async () => {
    const { starts, launchKernel } = slowLauncher()
    const { s } = session(launchKernel)
    const waiting = (s as unknown as { ensureKernel(): Promise<FolderKernel> }).ensureKernel()
    await tick()
    await s.openWorkspace('/notebooks/sales')
    await tick()
    starts[0].finish()
    starts[1].finish()
    expect((await waiting).cwd).toBe('/notebooks/sales')
    expect(starts).toHaveLength(2)
    expect(starts[0].kernel.stopped).toBe(true)
  })

  it('reuses a start already under way in the same folder', async () => {
    let launches = 0
    const { s } = session(async (cwd) => {
      launches++
      return new FolderKernel(cwd)
    })
    s.warmUp()
    s.warmUp()
    await tick()
    expect(launches).toBe(1)
  })

  it('shuts down a kernel that finishes starting after quit', async () => {
    const { starts, launchKernel } = slowLauncher()
    const { s } = session(launchKernel)
    s.warmUp()
    await tick()
    await s.shutdown()
    starts[0].finish()
    await tick()
    expect(starts).toHaveLength(1)
    expect(starts[0].kernel.stopped).toBe(true)
  })
})

describe('built-in extensions', () => {
  // The cases live in harness/extensions.test.ts. This checks the session installs them on its bus.
  it('guards .env files on the session bus', async () => {
    const { s } = session(async (cwd) => new FolderKernel(cwd))
    expect(await s.bus.emit('tool_call', { cellId: 'c1', toolName: 'read_file', input: { path: 'config\\.Env.local' } })).toMatchObject({ blocked: true })
    expect(await s.bus.emit('tool_call', { cellId: 'c1', toolName: 'read_file', input: { path: 'environment.csv' } })).toEqual({ blocked: false })
  })
})

describe('NotebookSession environment', () => {
  // The Python the mocked pythonStatus reports
  const python = '/py/bin/python'

  it('lists the libraries from its userData folder, never the process’s working directory', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'dalliance-session-'))
    const calls: { python: string; cwd: string }[] = []
    const s = new NotebookSession({
      settings: { pythonPath: python } as SettingsStore,
      userData,
      defaultWorkspace: '/default',
      send: () => {},
      listPackages: async (p, { cwd }) => {
        calls.push({ python: p, cwd })
        return [{ name: 'numpy', version: '2.1.0' }]
      },
    })
    expect(await s.environment()).toMatchObject({ python, packages: [{ name: 'numpy', version: '2.1.0' }], error: null })
    expect(calls).toEqual([{ python, cwd: userData }])
  })

  it('passes on why the listing failed', async () => {
    const s = new NotebookSession({
      settings: { pythonPath: python } as SettingsStore,
      userData: mkdtempSync(path.join(tmpdir(), 'dalliance-session-')),
      defaultWorkspace: '/default',
      send: () => {},
      listPackages: async () => {
        throw new Error(`${python} took longer than 20 seconds to list its libraries.`)
      },
    })
    expect(await s.environment()).toMatchObject({ packages: [], error: `Couldn't list the libraries: ${python} took longer than 20 seconds to list its libraries.` })
  })
})

describe('what a run cost', () => {
  // One model call that finishes the cell: 1,000 input tokens, 800 of them read from the cache, and 100 out
  const finishing = () =>
    new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'tool-call', toolCallId: 'c', toolName: 'finish', input: JSON.stringify({ interpretation: '', answer: 'Nothing to run.' }) },
            {
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: 'tool_use' },
              usage: { inputTokens: { total: 1000, noCache: 200, cacheRead: 800, cacheWrite: 0 }, outputTokens: { total: 100, text: 100, reasoning: 0 } },
            },
          ] as never[],
        }),
      }),
    })

  const run = async (showUsage: boolean) => {
    agent.model = finishing()
    const s = new NotebookSession({
      settings: {
        workspaceDir: null,
        setWorkspaceDir: () => {},
        modelConfig: () => ({ model: 'anthropic/claude-haiku-4.5', effort: 'medium', key: () => 'test-key' }),
        showUsage,
        autoTitles: false,
        suggestNext: true,
        approvalMode: 'interactive',
      } as unknown as SettingsStore,
      userData: mkdtempSync(path.join(tmpdir(), 'dalliance-session-')),
      defaultWorkspace: mkdtempSync(path.join(tmpdir(), 'dalliance-ws-')),
      send: () => {},
      launchKernel: async (cwd) => new FolderKernel(cwd),
    })
    const contents = { isDestroyed: () => false, send: () => {} } as unknown as WebContents
    return s.runCell({ cellId: 'c1', prompt: 'Nothing', code: '', generate: true, corrections: [], attachments: [], previousCells: [] }, contents)
  }

  it("names the run's calls for Show token usage", async () => {
    const result = await run(true)
    expect(result.steps[0].usage).toMatchObject({ inputTokens: 1000, cacheReadTokens: 800, outputTokens: 100 })
    expect(result.cost).toEqual({ tokens: 1100 })
  })

  it('counts the run with Show token usage off too, so turning it on later shows it', async () => {
    const result = await run(false)
    expect(result.ok).toBe(true)
    expect(result.cost).toEqual({ tokens: 1100 })
  })
})

describe("the notebook's pins", () => {
  const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`

  /** A session in a folder with a data file, and a kernel whose cells read it when their code names it. */
  function pinning() {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-ws-'))
    writeFileSync(path.join(dir, 'visits.csv'), 'id,age\n1,40\n')
    const kernel = new FolderKernel(dir, (code) => ({ ok: true, outputs: [], filesRead: code.includes('visits') ? ['visits.csv'] : [] }))
    kernel.packages = [{ name: 'pandas', version: '2.2.3' }]
    const s = new NotebookSession({
      settings: { workspaceDir: null, setWorkspaceDir: () => {}, pythonPath: '/py/bin/python', modelConfig: () => ({}), autoTitles: false } as unknown as SettingsStore,
      userData: mkdtempSync(path.join(tmpdir(), 'dalliance-session-')),
      defaultWorkspace: dir,
      send: () => {},
      launchKernel: async () => kernel,
      listPackages: async () => [{ name: 'pandas', version: '2.2.3' }],
    })
    const contents = { isDestroyed: () => false, send: () => {} } as unknown as WebContents
    const run = (cellId: string, code: string) => s.runCell({ cellId, prompt: '', code, generate: false, corrections: [], attachments: [], previousCells: [] }, contents)
    const notebook: Notebook = { cells: [{ ...newPromptCell('', 'visits = read("visits.csv")'), id: 'a' }] }
    return { s, dir, kernel, run, notebook }
  }

  it('records the Python, what the kernel imported and the files the cells read, hashed', async () => {
    const { s, run, notebook } = pinning()
    expect((await s.pin(notebook)).pins).toBeUndefined()
    await run('a', 'visits = read("visits.csv")')
    expect((await s.pin(notebook)).pins).toEqual({
      python: '3.12.0',
      packages: [{ name: 'pandas', version: '2.2.3' }],
      files: [{ path: 'visits.csv', size: 12, hash: sha('id,age\n1,40\n') }],
    })
  })

  it('forgets what ran once the kernel restarts, so the pins stay as they were', async () => {
    const { s, run, notebook } = pinning()
    await run('a', 'visits = read("visits.csv")')
    const pinned = await s.pin(notebook)
    await s.restart()
    expect((await s.pin({ ...notebook, pins: { ...pinned.pins!, python: '3.11.9' } })).pins?.python).toBe('3.11.9')
  })

  it("uses the kernel's last answer while a cell runs, rather than wait for it", async () => {
    const { s, kernel, run, notebook } = pinning()
    await run('a', 'visits = read("visits.csv")')
    await s.pin(notebook)
    kernel.packages = [{ name: 'pandas', version: '3.0.0' }]
    kernel.busy = true
    expect((await s.pin(notebook)).pins?.packages).toEqual([{ name: 'pandas', version: '2.2.3' }])
  })

  it('says what changed since the pins were recorded', async () => {
    const { s, dir, run, notebook } = pinning()
    await run('a', 'visits = read("visits.csv")')
    const { pins } = await s.pin(notebook)
    expect(await s.checkPins(pins!)).toEqual([])
    writeFileSync(path.join(dir, 'visits.csv'), 'id,age\n1,41\n')
    expect(await s.checkPins({ ...pins!, packages: [{ name: 'pandas', version: '2.1.0' }] })).toEqual([
      { kind: 'package', name: 'pandas', was: '2.1.0', now: '2.2.3' },
      { kind: 'file', path: 'visits.csv', change: 'contents' },
    ])
  })
})


describe('saved-code reruns', () => {
  it('runs without provider keys and makes no title request even with automatic titles enabled', async () => {
    const title = vi.spyOn(titles, 'titleModel')
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-offline-'))
    const settings = new SettingsStore(dir)
    const session = new NotebookSession({ settings, userData: dir, defaultWorkspace: dir, send: () => {}, launchKernel: async (cwd) => new FolderKernel(cwd) })
    try {
      const result = await session.runCell({ cellId: 'saved', prompt: 'Run the saved calculation', code: '1 + 1', generate: false, nameIt: true, corrections: [], attachments: [], previousCells: [] }, { isDestroyed: () => false, send: () => {} } as unknown as WebContents)
      expect(result.ok).toBe(true)
      expect(result.steps).toEqual([])
      expect(result.cost).toBeUndefined()
      expect(title).not.toHaveBeenCalled()
    } finally {
      title.mockRestore()
      await session.shutdown()
    }
  })
})
