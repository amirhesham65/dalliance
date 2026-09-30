// @vitest-environment node
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawned: { cmd: string; args: string[] }[] = []

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: (cmd: string, args: string[]) => {
      spawned.push({ cmd, args })
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
      queueMicrotask(() => child.emit('exit', 0))
      return child
    },
  }
})

const { BASE_PACKAGES, REQUIRED_PACKAGES, findSystemPython, installPackages, isPackageSpec, missingPackages } = await import('./python-env')

beforeEach(() => {
  spawned.length = 0
})

describe('isPackageSpec', () => {
  it.each(['pandas', 'scikit-learn', 'numpy==2.1', 'pandas[excel]', 'scipy>=1.11,<2', 'zope.interface', 'ruamel_yaml', 'torch~=2.0', 'pkg!=1.0', '3to2'])('accepts %s', (spec) => {
    expect(isPackageSpec(spec)).toBe(true)
  })

  it.each(['-e.', '-rrequirements.txt', '--index-url=http://evil', '-e', '.', '..', '_private', '[extra]', '==1.0', 'pkg.whl', 'pkg-1.0.tar.gz', 'pkg.zip', '', 'a b', 'pkg @ file:///tmp/x', 'git+https://x/y', '../x'])('rejects %s', (spec) => {
    expect(isPackageSpec(spec)).toBe(false)
  })
})

describe('installPackages', () => {
  it('passes valid names to pip after --', async () => {
    const log: string[] = []
    await installPackages('/py', ['scikit-learn', 'numpy==2.1', 'pandas[excel]'], (line) => log.push(line))
    expect(spawned).toEqual([{ cmd: '/py', args: ['-m', 'pip', 'install', '--', 'scikit-learn', 'numpy==2.1', 'pandas[excel]'] }])
    expect(log[0]).toBe('Installing scikit-learn, numpy==2.1, pandas[excel]')
  })

  it('refuses the whole list when one name looks like a pip option', async () => {
    await expect(installPackages('/py', ['seaborn', '-e.'], () => {})).rejects.toThrow(/start with a letter or number/)
    await expect(installPackages('/py', ['-rrequirements.txt'], () => {})).rejects.toThrow()
    expect(spawned).toEqual([])
  })

  it('does nothing for an empty list', async () => {
    await installPackages('/py', [], () => {})
    expect(spawned).toEqual([])
  })
})

describe('package lists', () => {
  it('installs the research stack in the managed environment but only requires the core three', () => {
    expect(REQUIRED_PACKAGES).toEqual(['pandas', 'numpy', 'matplotlib'])
    expect(BASE_PACKAGES).toEqual(expect.arrayContaining([...REQUIRED_PACKAGES, 'scipy', 'statsmodels', 'seaborn', 'scikit-learn']))
    expect(BASE_PACKAGES.every(isPackageSpec)).toBe(true)
  })
})

const python = await findSystemPython()

describe.skipIf(!python)('missingPackages (real Python)', () => {
  it('checks only the required packages by default', async () => {
    const missing = await missingPackages(python!)
    expect(missing.every((p) => REQUIRED_PACKAGES.includes(p))).toBe(true)
  })

  it('reports a package that is not installed', async () => {
    expect(await missingPackages(python!, ['json', 'surely_not_a_real_module_xyz'])).toEqual(['surely_not_a_real_module_xyz'])
  })
})
