// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppEnvironments } from './environment'
import { appCommand } from './process'
vi.mock('./process', () => ({ appCommand: vi.fn() }))
const recorded = { pythonVersion: '3.12.4', packages: [{ name: 'psutil', version: '7.2.2' }, { name: 'streamlit', version: '1.66.1' }] }
const roots: string[] = []
beforeEach(() => {
  vi.mocked(appCommand).mockReset().mockImplementation(async (_file, args) => args.includes('import sys;print(sys.version.split()[0])') ? '3.12.4\n' : args.some((arg) => arg.includes('importlib.metadata')) ? JSON.stringify(recorded) : '')
})
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function setup(project = '/project') { const root = await mkdtemp(path.join(tmpdir(), 'dalliance-app-env-')); roots.push(root); return { root, environments: new AppEnvironments(root, project, async () => '/python', async () => null) } }

it('prepares a separate environment after approval, records exact versions and reuses its lock', async () => {
  const { environments } = await setup()
  const approve = vi.fn(async () => true)
  const first = await environments.resolve(['streamlit', 'psutil'], undefined, approve, new AbortController().signal)
  expect(first.python).not.toBe('/python')
  expect(first.recorded).toEqual(recorded)
  expect(approve).toHaveBeenCalledOnce()
  const install = vi.mocked(appCommand).mock.calls.find(([, args]) => args.includes('pip'))!
  expect(install[1]).toContain('streamlit>=1.66,<2')
  const second = await environments.resolve(['streamlit', 'psutil'], recorded, approve, new AbortController().signal)
  expect(second.python).toBe(first.python)
  expect(approve).toHaveBeenCalledOnce()
  expect(vi.mocked(appCommand).mock.calls.filter(([, args]) => args.includes('pip'))).toHaveLength(1)
})

it('does not install when approval is declined or the interpreter differs from the lock', async () => {
  const { environments } = await setup()
  await expect(environments.resolve(['streamlit'], undefined, async () => false, new AbortController().signal)).rejects.toThrow('declined')
  await expect(environments.resolve(['streamlit'], { ...recorded, pythonVersion: '3.11.0' }, async () => true, new AbortController().signal)).rejects.toThrow('verified with Python')
  expect(vi.mocked(appCommand).mock.calls.some(([, args]) => args.includes('pip'))).toBe(false)
})

it.each(['3.9.6', '3.10.16'])('explains the missing app runtime without changing notebook Python %s', async (version) => {
  const { environments } = await setup()
  vi.mocked(appCommand).mockResolvedValue(`${version}\n`)
  const approve = vi.fn(async () => true)
  await expect(environments.resolve(['streamlit'], undefined, approve, new AbortController().signal)).rejects.toThrow('No compatible Python was found.')
  expect(approve).not.toHaveBeenCalled()
  expect(vi.mocked(appCommand).mock.calls.some(([, args]) => args.includes('pip') || args.includes('venv'))).toBe(false)
})

it('uses a compatible installed Python when notebook Python is too old, and reuses the lock without consulting notebook Python', async () => {
  const { root } = await setup()
  const notebookPython = vi.fn(async () => '/old-notebook-python')
  const discover = vi.fn(async (): Promise<string | null> => '/new-system-python')
  vi.mocked(appCommand).mockImplementation(async (file, args) => args.includes('import sys;print(sys.version.split()[0])') ? file === '/old-notebook-python' ? '3.9.6\n' : '3.12.4\n' : args.some((arg) => arg.includes('importlib.metadata')) ? JSON.stringify(recorded) : '')
  const environments = new AppEnvironments(root, '/project', notebookPython, discover)
  const approve = vi.fn(async () => true)
  const first = await environments.resolve(['streamlit'], undefined, approve, new AbortController().signal)
  expect(discover).toHaveBeenCalledOnce()
  const create = vi.mocked(appCommand).mock.calls.find(([, args]) => args.includes('venv'))!
  expect(create[0]).toBe('/new-system-python')
  expect(vi.mocked(appCommand).mock.calls.some(([file, args]) => file === '/old-notebook-python' && (args.includes('venv') || args.includes('pip')))).toBe(false)
  notebookPython.mockRejectedValue(new Error('Notebook interpreter removed'))
  discover.mockResolvedValue(null)
  const reused = await environments.resolve(['streamlit'], recorded, approve, new AbortController().signal)
  expect(reused.python).toBe(first.python)
  expect(notebookPython).toHaveBeenCalledOnce()
  expect(discover).toHaveBeenCalledOnce()
  expect(approve).toHaveBeenCalledOnce()
})

it('finds the exact Python needed to recreate a locked app instead of changing notebook Python', async () => {
  const { root } = await setup()
  const discover = vi.fn(async () => '/locked-python')
  const environments = new AppEnvironments(root, '/project', async () => '/newer-notebook-python', discover)
  vi.mocked(appCommand).mockImplementation(async (file, args) => args.includes('import sys;print(sys.version.split()[0])') ? file === '/newer-notebook-python' ? '3.14.2\n' : '3.12.4\n' : args.some((arg) => arg.includes('importlib.metadata')) ? JSON.stringify(recorded) : '')
  await environments.resolve(['streamlit'], recorded, async () => true, new AbortController().signal)
  expect(discover).toHaveBeenCalledWith('3.12.4')
  expect(vi.mocked(appCommand).mock.calls.find(([, args]) => args.includes('venv'))?.[0]).toBe('/locked-python')
})

it('isolates projects and validates dependency specifications before installing', async () => {
  const { environments, root } = await setup()
  const first = await environments.resolve(['streamlit'], undefined, async () => true, new AbortController().signal)
  const other = new AppEnvironments(root, '/other-project', async () => '/python', async () => null)
  const second = await other.resolve(['streamlit'], undefined, async () => true, new AbortController().signal)
  expect(first.python).not.toBe(second.python)
  await expect(other.resolve(['-rsecrets'], undefined, async () => true, new AbortController().signal)).rejects.toThrow('invalid dependency')
})
