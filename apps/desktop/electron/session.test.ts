// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import type { WebContents } from 'electron'
import { IPC, type KernelState } from '@dalliance/shared/ipc'
import { FakeKernel } from './kernel/fake-kernel'
import type { KernelInfo } from './kernel/kernel'
import { NotebookSession } from './session'
import type { SettingsStore } from './settings'

// Only the sessions below that don't pass launchKernel reach these: the real launcher with a fake Python
const python = vi.hoisted(() => ({
  source: 'managed' as 'managed' | 'system',
  topUp: async (_envDir: string, _onLog: (line: string) => void): Promise<string[]> => [],
  topUps: [] as string[],
}))
vi.mock('./kernel/python-env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./kernel/python-env')>()),
  pythonStatus: async () => ({ python: '/py/bin/python', version: '3.12.0', source: python.source, managedEnvExists: true, missingPackages: [] }),
  installMissingBasePackages: (envDir: string, onLog: (line: string) => void) => {
    python.topUps.push(envDir)
    return python.topUp(envDir, onLog)
  },
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
  readonly cwd: string
  constructor(cwd: string) {
    super()
    this.cwd = cwd
  }
  override info(): KernelInfo {
    return { ...super.info(), cwd: this.cwd, status: this.stopped ? 'dead' : 'idle' }
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

describe('base packages in an older managed environment', () => {
  const userData = () => mkdtempSync(path.join(tmpdir(), 'dalliance-session-'))
  const start = (s: NotebookSession) => (s as unknown as { ensureKernel(): Promise<unknown> }).ensureKernel()
  function realSession(dir: string) {
    const logs: string[] = []
    const s = new NotebookSession({
      settings: { pythonPath: null } as unknown as SettingsStore,
      userData: dir,
      defaultWorkspace: '/default',
      send: (channel, line) => {
        if (channel === IPC.pythonLog) logs.push(line as string)
      },
    })
    return { s, logs }
  }

  beforeEach(() => {
    python.source = 'managed'
    python.topUp = async () => []
    python.topUps = []
  })

  it('installs what is missing once, without holding up the kernel, and logs to python-log', async () => {
    let finish!: () => void
    python.topUp = (_envDir, onLog) => {
      onLog('Installing scipy, seaborn')
      return new Promise((resolve) => (finish = () => resolve(['scipy', 'seaborn'])))
    }
    const dir = userData()
    const { s, logs } = realSession(dir)
    // The kernel is ready while pip is still going
    await start(s)
    expect(python.topUps).toEqual([path.join(dir, 'python-env')])
    expect(logs).toEqual(['Installing scipy, seaborn'])

    await s.restart()
    await start(s)
    expect(python.topUps).toHaveLength(1)
    finish()
  })

  it('leaves a Python that is not the managed environment alone', async () => {
    python.source = 'system'
    const { s } = realSession(userData())
    await start(s)
    expect(python.topUps).toEqual([])
  })

  it('ignores a failed install', async () => {
    python.topUp = async () => {
      throw new Error('pip failed')
    }
    const { s } = realSession(userData())
    await expect(start(s)).resolves.toBeDefined()
    await tick()
    expect(python.topUps).toHaveLength(1)
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

  const run = async (showCosts: boolean) => {
    agent.model = finishing()
    const s = new NotebookSession({
      settings: {
        workspaceDir: null,
        setWorkspaceDir: () => {},
        modelConfig: () => ({ provider: 'anthropic', model: 'claude-haiku-4-5', effort: 'medium', apiKey: 'k', cloud: null }),
        showCosts,
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
    return s.runCell({ cellId: 'c1', prompt: 'Nothing', code: '', generate: true, corrections: [], previousCells: [] }, contents)
  }

  it('prices the run with Show costs on', async () => {
    const result = await run(true)
    expect(result.steps[0].usage).toMatchObject({ inputTokens: 1000, cacheReadTokens: 800, outputTokens: 100 })
    // Haiku 4.5: 200 fresh at $1, 800 cached at $0.10 and 100 out at $5 a million
    expect(result.cost).toMatchObject({ unit: 'usd', unpricedTokens: 0 })
    expect(result.cost?.unit === 'usd' && result.cost.usd).toBeCloseTo(0.0002 + 0.00008 + 0.0005, 10)
  })

  it('leaves the cost out with Show costs off', async () => {
    const result = await run(false)
    expect(result.ok).toBe(true)
    expect(result).not.toHaveProperty('cost')
  })
})
