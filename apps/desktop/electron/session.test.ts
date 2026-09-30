// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC, type KernelState } from '@dalliance/shared/ipc'
import { FakeKernel } from './kernel/fake-kernel'
import type { KernelInfo } from './kernel/kernel'
import { NotebookSession, isSecretPath } from './session'
import type { SettingsStore } from './settings'

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

function session(launchKernel: (cwd: string, onStatus: (info: KernelInfo) => void) => Promise<FolderKernel>) {
  const sent: KernelState[] = []
  const s = new NotebookSession({
    settings: {} as SettingsStore,
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

describe('the .env guard', () => {
  it.each(['.env', '.ENV', '.env.local', 'config/.env', 'config\\.env', 'C:\\work\\.Env.production', '/abs/path/.env.test'])('blocks %s', async (p) => {
    expect(isSecretPath(p)).toBe(true)
    const { s } = session(async (cwd) => new FolderKernel(cwd))
    expect(await s.bus.emit('tool_call', { cellId: 'c1', toolName: 'read_file', input: { path: p } })).toMatchObject({ blocked: true })
  })

  it.each(['env', '.envrc', 'data/.environment', 'notes.env', 'orders.csv', 'my.env/data.csv'])('allows %s', (p) => {
    expect(isSecretPath(p)).toBe(false)
  })

  it('only guards read_file', async () => {
    const { s } = session(async (cwd) => new FolderKernel(cwd))
    expect(await s.bus.emit('tool_call', { cellId: 'c1', toolName: 'list_files', input: { path: '.env' } })).toEqual({ blocked: false })
  })
})
