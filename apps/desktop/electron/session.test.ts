// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
