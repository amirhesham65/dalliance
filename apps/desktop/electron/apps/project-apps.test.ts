// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDraft, AppPolicy } from '@dalliance/shared/apps'
import { FakeKernel } from '../kernel/fake-kernel'
import { PythonKernel } from '../kernel/python-kernel'
import { ProjectApps } from './project-apps'

const roots: string[] = [], managers: ProjectApps[] = [], kernels: PythonKernel[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.shutdown()))
  await Promise.all(kernels.splice(0).map((k) => k.shutdown()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const draft = (extra: Partial<AppDraft> = {}): AppDraft => ({ title: 'Sales explorer', description: 'Filter sales.', code: 'import streamlit as st\nst.title("Sales")', requirements: ['streamlit', 'pandas'], snapshots: [], ...extra })
const source = { cellId: 'cell-1', notebook: 'Sales.ipynb' }
const signal = () => new AbortController().signal
const fake = () => new FakeKernel(() => ({ ok: true, outputs: [] }))
const launch: ConstructorParameters<typeof ProjectApps>[0]['launch'] = (_python, args, options) => {
  const port = args.find((a) => a.startsWith('--server.port='))!.split('=')[1]
  return spawn(process.execPath, ['-e', `const fs=require('fs');const report=()=>{try{fs.writeSync(3,JSON.stringify({type:'runtime',busy:false,memoryMb:12})+'\\n')}catch{}};report();setInterval(report,50);require('http').createServer((req,res)=>res.end(req.url==='/_stcore/health'?'ok':'app')).listen(${Number(port)},'127.0.0.1')`], options)
}
async function setup(extra: Partial<ConstructorParameters<typeof ProjectApps>[0]> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'dalliance-apps-test-'))
  roots.push(root)
  const changed = vi.fn()
  const manager = new ProjectApps({ workspace: root, python: async () => process.execPath, changed, launch, verify: async () => ({ ok: true, text: 'Rendered' }), ...extra })
  managers.push(manager)
  return { root, manager, changed }
}
async function publish(manager: ProjectApps, input = draft(), origin = source, kernel = fake()) {
  const staged = await manager.save(input, origin, kernel, signal())
  const verified = await manager.verify(staged.id, signal())
  expect(verified.ok, verified.text).toBe(true)
  return manager.manifest(staged.id)
}

describe('project apps', () => {
  it('publishes only after verification and preserves the working server and files on a failed update', async () => {
    let passes = true
    const { root, manager } = await setup({ verify: async () => ({ ok: passes, text: passes ? 'Rendered' : 'Page failed' }) })
    const saved = await publish(manager)
    const running = await manager.start(saved.id)
    await writeFile(path.join(root, 'apps', saved.id, 'user-notes.txt'), 'Keep this asset')
    passes = false
    await manager.save(draft({ id: saved.id, code: 'broken' }), source, fake(), signal())
    expect(await readFile(path.join(root, 'apps', saved.id, 'app.py'), 'utf8')).toBe(draft().code)
    expect((await manager.verify(saved.id, signal())).ok).toBe(false)
    expect(manager.allows(running.url!)).toBe(true)
    expect(await manager.source(saved.id)).toBe(draft().code)
    expect((await manager.list())[0]).toMatchObject({ status: 'running', buildError: 'Page failed' })
    passes = true
    await publish(manager, draft({ id: saved.id, code: 'version = 2' }))
    expect(await readFile(path.join(root, 'apps', saved.id, 'user-notes.txt'), 'utf8')).toBe('Keep this asset')
    expect(await manager.source(saved.id)).toBe('version = 2')
    expect(manager.allows(running.url!)).toBe(false)
  })

  it('does not publish a failed new app and lets a later attempt reuse its id', async () => {
    let passes = false
    const { root, manager } = await setup({ verify: async () => ({ ok: passes, text: 'Checked' }) })
    const first = await manager.save(draft(), source, fake(), signal())
    expect((await manager.verify(first.id, signal())).ok).toBe(false)
    await expect(readFile(path.join(root, 'apps', first.id, 'app.json'))).rejects.toThrow()
    await expect(manager.start(first.id)).rejects.toThrow('verification')
    passes = true
    const retry = await publish(manager)
    expect(retry.id).toBe(first.id)
  })

  it('keeps a bounded history and can restore, clear history and delete the app', async () => {
    const policy: AppPolicy = { idleMinutes: 15, maxRunning: 3, historyLimit: 2 }
    const { root, manager } = await setup({ policy: () => policy })
    const saved = await publish(manager)
    for (let i = 1; i <= 4; i++) await publish(manager, draft({ id: saved.id, code: `version = ${i}` }))
    expect((await manager.list())[0].historyCount).toBe(2)
    await manager.restore(saved.id)
    expect(await manager.source(saved.id)).toBe('version = 3')
    await manager.clearHistory(saved.id)
    expect((await manager.list())[0].historyCount).toBe(0)
    await manager.remove(saved.id)
    expect(await manager.list()).toEqual([])
    await expect(readFile(path.join(root, 'apps', saved.id, 'app.py'))).rejects.toThrow()
  })

  it('exports real values, detects changed notebook data and refreshes without changing code', async () => {
    const { root, manager } = await setup()
    const kernel = new PythonKernel({ python: process.env.DALLIANCE_TEST_PYTHON ?? 'python3', cwd: root, scratchDir: path.join(root, '.kernel') })
    kernels.push(kernel)
    await kernel.start()
    await kernel.execute('sales = [{"month": "October", "total": 42}]', { store: true })
    const staged = await manager.save(draft({ snapshots: [{ variable: 'sales', file: 'sales.json' }] }), source, kernel, signal())
    expect((await manager.verify(staged.id, signal())).ok).toBe(true)
    await manager.checkData(kernel)
    expect((await manager.list())[0].dataState).toBe('current')
    await kernel.execute('sales = [{"month": "November", "total": 84}]', { store: true })
    await manager.checkData(kernel)
    expect((await manager.list())[0].dataState).toBe('changed')
    const code = await manager.source(staged.id)
    await manager.refresh(staged.id, kernel, signal())
    expect(await manager.source(staged.id)).toBe(code)
    expect(JSON.parse(await readFile(path.join(root, 'apps', staged.id, 'data/sales.json'), 'utf8'))).toEqual([{ month: 'November', total: 84 }])
    await manager.checkData(null)
    expect((await manager.list())[0].dataState).toBe('unavailable')
    await manager.restore(staged.id)
    expect(JSON.parse(await readFile(path.join(root, 'apps', staged.id, 'data/sales.json'), 'utf8'))[0].total).toBe(42)
  }, 20_000)

  it('leaves published files untouched when an export fails', async () => {
    const { manager } = await setup()
    const saved = await publish(manager)
    const broken = new FakeKernel(() => ({ ok: false, outputs: [{ type: 'error', ename: 'NameError', evalue: 'missing', traceback: [] }] }))
    await expect(manager.save(draft({ id: saved.id, code: 'broken', snapshots: [{ variable: 'missing', file: 'missing.csv' }] }), source, broken, signal())).rejects.toThrow('Could not export')
    expect(await manager.source(saved.id)).toBe(draft().code)
  })

  it('reuses an originating app and preserves its original source on edits from another cell', async () => {
    const { manager } = await setup()
    const first = await publish(manager)
    const second = await publish(manager, draft({ code: 'v = 2' }))
    expect(second.id).toBe(first.id)
    const edited = await publish(manager, draft({ id: first.id, title: 'Updated' }), { cellId: 'cell-2', notebook: 'Other.ipynb' })
    expect(edited.sourceCellId).toBe(source.cellId)
    expect(edited.sourceNotebook).toBe(source.notebook)
  })

  it('rejects traversal, symlinks and unsafe dependencies', async () => {
    const { root, manager } = await setup()
    await expect(manager.save(draft({ id: '../escape' }), source, fake(), signal())).rejects.toThrow()
    await expect(manager.save(draft({ requirements: ['-rfile'] }), source, fake(), signal())).rejects.toThrow()
    await expect(manager.save(draft({ snapshots: [{ variable: 'x', file: '../escape.csv' }] }), source, fake(), signal())).rejects.toThrow()
    await mkdir(path.join(root, 'outside'))
    await symlink(path.join(root, 'outside'), path.join(root, 'apps'))
    await expect(manager.save(draft(), source, fake(), signal())).rejects.toThrow('symlinks')
  })

  it('refuses symlinked source on launch and update', async () => {
    const { root, manager } = await setup()
    const saved = await publish(manager)
    await rm(path.join(root, 'apps', saved.id, 'app.py'))
    await writeFile(path.join(root, 'outside.py'), 'outside = True')
    await symlink(path.join(root, 'outside.py'), path.join(root, 'apps', saved.id, 'app.py'))
    await expect(manager.start(saved.id)).rejects.toThrow('symlinks')
    await expect(manager.save(draft({ id: saved.id }), source, fake(), signal())).rejects.toThrow('symlinks')
  })

  it('shares duplicate starts, reports memory and revokes addresses on stop', async () => {
    const { manager } = await setup()
    const saved = await publish(manager)
    const [first, second] = await Promise.all([manager.start(saved.id), manager.start(saved.id)])
    expect(first.url).toBe(second.url)
    expect(manager.allows(first.url!)).toBe(true)
    await vi.waitFor(async () => expect((await manager.list())[0].memoryMb).toBe(12))
    await manager.stop(saved.id)
    expect(manager.allows(first.url!)).toBe(false)
    await expect(fetch(first.url!)).rejects.toThrow()
  })

  it('stops only hidden idle apps, respecting visibility, Keep running and fresh busy signals', async () => {
    let now = Date.now()
    const { manager } = await setup({ now: () => now, policy: () => ({ idleMinutes: 1, maxRunning: 3, historyLimit: 5 }) })
    const saved = await publish(manager)
    await manager.start(saved.id)
    manager.visibleApp(saved.id)
    now += 120_000
    await manager.sweep()
    expect((await manager.list())[0].status).toBe('running')
    manager.visibleApp(null)
    manager.keepRunning(saved.id, true)
    now += 120_000
    await manager.sweep()
    expect((await manager.list())[0].status).toBe('running')
    manager.keepRunning(saved.id, false)
    now += 61_000
    // A stale signal protects the app until the next real status arrives.
    await manager.sweep()
    expect((await manager.list())[0].status).toBe('running')
    await new Promise((resolve) => setTimeout(resolve, 80))
    await manager.sweep()
    expect((await manager.list())[0]).toMatchObject({ status: 'stopped', stoppedReason: 'idle' })
  })

  it('never idle-stops a computing app, even after its deadline', async () => {
    let now = Date.now()
    const busyLaunch: typeof launch = (_python, args, options) => {
      const port = args.find((a) => a.startsWith('--server.port='))!.split('=')[1]
      return spawn(process.execPath, ['-e', `const fs=require('fs');setInterval(()=>fs.writeSync(3,JSON.stringify({type:'runtime',busy:true})+'\\n'),20);require('http').createServer((req,res)=>res.end('ok')).listen(${Number(port)},'127.0.0.1')`], options)
    }
    const { manager } = await setup({ launch: busyLaunch, now: () => now, policy: () => ({ idleMinutes: 1, maxRunning: 3, historyLimit: 5 }) })
    const saved = await publish(manager)
    await manager.start(saved.id)
    await vi.waitFor(async () => expect((await manager.list())[0].busy).toBe(true))
    now += 120_000
    await new Promise((resolve) => setTimeout(resolve, 50))
    await manager.sweep()
    expect((await manager.list())[0].status).toBe('running')
  })

  it('enforces capacity without evicting a visible or pinned app', async () => {
    const { manager } = await setup({ policy: () => ({ idleMinutes: 15, maxRunning: 1, historyLimit: 5 }) })
    const first = await publish(manager)
    const second = await publish(manager, draft({ title: 'Another app' }), { ...source, cellId: 'cell-2' })
    await manager.start(first.id)
    manager.keepRunning(first.id, true)
    await expect(manager.start(second.id)).rejects.toThrow('running-app limit')
    expect((await manager.list()).find((a) => a.id === first.id)?.status).toBe('running')
    await manager.stop(first.id)
    expect((await manager.start(second.id)).status).toBe('running')
  })

  it('cancels verification without stopping the working version', async () => {
    let entered!: () => void
    const ready = new Promise<void>((resolve) => { entered = resolve })
    let interrupt = false
    const { manager } = await setup({ verify: async (_url, signal) => {
      if (!interrupt) return { ok: true, text: 'Rendered' }
      entered()
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Interrupted')), { once: true }))
    } })
    const saved = await publish(manager)
    const working = await manager.start(saved.id)
    interrupt = true
    await manager.save(draft({ id: saved.id, code: 'updated' }), source, fake(), signal())
    const controller = new AbortController()
    const verifying = manager.verify(saved.id, controller.signal)
    const failed = expect(verifying).rejects.toThrow('stopped')
    await ready
    controller.abort()
    await failed
    expect(manager.allows(working.url!)).toBe(true)
    expect(await manager.source(saved.id)).toBe(draft().code)
  })

  it('cancels a start during environment lookup and launches no late server', async () => {
    let ready!: (python: string) => void
    const pending = new Promise<string>((resolve) => { ready = resolve })
    const { manager } = await setup()
    const saved = await publish(manager)
    const resolveEnvironment = vi.fn(async () => ({ python: await pending, recorded: { pythonVersion: '3.12', packages: [] } }))
    // A separate manager represents reopening a project with an environment still being prepared.
    const root = roots.at(-1)!
    await manager.shutdown()
    const reopened = new ProjectApps({ workspace: root, python: async () => process.execPath, changed: () => {}, launch, environment: { resolve: resolveEnvironment } })
    managers.push(reopened)
    const starting = reopened.start(saved.id)
    const failed = expect(starting).rejects.toThrow('stopped')
    const stopping = reopened.stop(saved.id)
    ready(process.execPath)
    await failed; await stopping
  })

  it('does not discover unrelated Python folders or leave cancelled builds behind', async () => {
    const { root, manager } = await setup()
    await mkdir(path.join(root, 'apps/plain-python'), { recursive: true })
    await writeFile(path.join(root, 'apps/plain-python/app.py'), 'print("hello")')
    expect(await manager.list()).toEqual([])
    const controller = new AbortController(); controller.abort()
    await expect(manager.save(draft(), source, fake(), controller.signal)).rejects.toThrow('stopped')
    expect(await readdir(path.join(root, 'apps'))).toEqual(['plain-python'])
  })
})
