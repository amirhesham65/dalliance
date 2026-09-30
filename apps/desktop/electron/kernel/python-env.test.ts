// @vitest-environment node
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryDeps, Exec } from './python-env'

const spawned: { cmd: string; args: string[] }[] = []
/** How the next spawned process ends: its exit code and what it prints on stderr. */
let nextExit = { code: 0, stderr: '' }

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: (cmd: string, args: string[]) => {
      spawned.push({ cmd, args })
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
      const { code, stderr } = nextExit
      queueMicrotask(() => {
        if (stderr) child.stderr.emit('data', Buffer.from(stderr))
        child.emit('exit', code)
      })
      return child
    },
  }
})

const { BASE_PACKAGES, EXTERNALLY_MANAGED_MESSAGE, REQUIRED_PACKAGES, findSystemPython, installMissingBasePackages, installPackages, isPackageSpec, managedPython, missingBasePackages, missingPackages } =
  await import('./python-env')

beforeEach(() => {
  spawned.length = 0
  nextExit = { code: 0, stderr: '' }
})

describe('isPackageSpec', () => {
  it.each(['pandas', 'scikit-learn', 'numpy==2.1', 'pandas[excel]', 'scipy>=1.11,<2', 'zope.interface', 'ruamel_yaml', 'torch~=2.0', 'pkg!=1.0', '3to2'])('accepts %s', (spec) => {
    expect(isPackageSpec(spec)).toBe(true)
  })

  it.each(['-e.', '-rrequirements.txt', '--index-url=http://evil', '-e', '.', '..', '_private', '[extra]', '==1.0', 'pkg.whl', 'pkg-1.0.tar.gz', 'pkg.zip', 'pkg.tar', 'pkg.tgz', 'pkg.tar.bz2', 'pkg.tbz', 'pkg.tar.xz', 'pkg.txz', 'pkg.tlz', 'pkg.tar.lz', 'pkg.tar.lzma', 'PKG.TAR.XZ', '', 'a b', 'pkg @ file:///tmp/x', 'git+https://x/y', '../x'])('rejects %s', (spec) => {
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

  it('explains a Python that PEP 668 marks as externally managed', async () => {
    nextExit = {
      code: 1,
      stderr: 'error: externally-managed-environment\n\n× This environment is externally managed\n╰─> To install Python packages system-wide, try brew install xyz\n',
    }
    const log: string[] = []
    await expect(installPackages('/opt/homebrew/bin/python3', ['seaborn'], (line) => log.push(line))).rejects.toThrow(EXTERNALLY_MANAGED_MESSAGE)
    expect(EXTERNALLY_MANAGED_MESSAGE).toMatch(/Settings > Python/)
    // pip's own lines still reach the log, and the flag that overrides the marker is never passed
    expect(log).toContain('error: externally-managed-environment')
    expect(spawned[0].args).not.toContain('--break-system-packages')
  })

  it('passes other pip failures through', async () => {
    nextExit = { code: 1, stderr: 'ERROR: No matching distribution found for nosuchpkg\n' }
    await expect(installPackages('/py', ['nosuchpkg'], () => {})).rejects.toThrow('py exited with code 1')
  })
})

/** A fake computer: which files exist, what each Python reports, and whether the Command Line Tools are in. */
function machine(opts: { versions: Record<string, string>; files?: string[]; dirs?: Record<string, string[]>; clt?: boolean; path?: string }) {
  const ran: string[] = []
  const exec: Exec = async (file, args) => {
    ran.push([file, ...args].join(' '))
    if (file === '/usr/bin/xcode-select') {
      if (opts.clt) return { stdout: '/Library/Developer/CommandLineTools\n', stderr: '' }
      throw new Error('xcode-select: error: unable to get active developer directory')
    }
    const v = opts.versions[file]
    if (!v) throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' })
    return { stdout: `Python ${v}\n`, stderr: '' }
  }
  const files = new Set([...(opts.files ?? []), ...Object.keys(opts.versions).filter((f) => f.startsWith('/'))])
  const deps: Partial<DiscoveryDeps> = {
    platform: 'darwin',
    exec,
    exists: (file) => files.has(file),
    list: (dir) => opts.dirs?.[dir] ?? [],
    path: opts.path ?? '/usr/bin:/bin:/usr/sbin:/sbin',
  }
  return { deps, ran }
}

describe('findSystemPython on macOS', () => {
  it("prefers Homebrew's Python over Apple's on the Dock's minimal PATH", async () => {
    const { deps, ran } = machine({ versions: { '/usr/bin/python3': '3.9.6', '/opt/homebrew/bin/python3': '3.13.1' }, clt: true })
    expect(await findSystemPython(deps)).toBe('/opt/homebrew/bin/python3')
    expect(ran).not.toContain('/usr/bin/python3 --version')
  })

  it('picks the newest supported version among the candidates', async () => {
    const { deps } = machine({
      versions: {
        '/opt/homebrew/bin/python3': '3.12.8',
        '/opt/homebrew/bin/python3.13': '3.13.2',
        '/opt/homebrew/bin/python3.12': '3.12.8',
        '/usr/local/bin/python3': '3.11.4',
        '/Users/me/.pyenv/shims/python3': '3.10.0',
      },
      dirs: { '/opt/homebrew/bin': ['pip3', 'python3', 'python3.12', 'python3.13', 'python3.13-config'] },
      path: '/Users/me/.pyenv/shims:/usr/bin:/bin',
    })
    expect(await findSystemPython(deps)).toBe('/opt/homebrew/bin/python3.13')
  })

  it('keeps the earlier candidate on a tie, so python3 wins over its versioned twin', async () => {
    const { deps } = machine({
      versions: { '/opt/homebrew/bin/python3': '3.13.2', '/opt/homebrew/bin/python3.13': '3.13.2' },
      dirs: { '/opt/homebrew/bin': ['python3.13'] },
    })
    expect(await findSystemPython(deps)).toBe('/opt/homebrew/bin/python3')
  })

  it("uses a Python on the user's PATH", async () => {
    const { deps } = machine({ versions: { '/Users/me/.pyenv/shims/python3': '3.12.1' }, path: '/Users/me/.pyenv/shims:/usr/bin' })
    expect(await findSystemPython(deps)).toBe('/Users/me/.pyenv/shims/python3')
  })

  it('skips Pythons older than 3.9 and Python 2', async () => {
    const { deps } = machine({ versions: { '/usr/local/bin/python3': '3.8.18', '/opt/homebrew/bin/python3': '2.7.18' } })
    expect(await findSystemPython(deps)).toBeNull()
  })

  it("falls back to Apple's Python only when the Command Line Tools are installed", async () => {
    const withTools = machine({ versions: { '/usr/bin/python3': '3.9.6' }, clt: true })
    expect(await findSystemPython(withTools.deps)).toBe('/usr/bin/python3')

    const without = machine({ versions: { '/usr/bin/python3': '3.9.6' }, clt: false })
    expect(await findSystemPython(without.deps)).toBeNull()
    // Running the stub without the tools opens an install prompt, so it must not run at all
    expect(without.ran).toEqual(['/usr/bin/xcode-select -p'])
  })
})

describe('findSystemPython elsewhere', () => {
  it('tries python3 first on Linux and takes the newest', async () => {
    const exec: Exec = async (file) => {
      const v = { python3: '3.10.12', '/usr/local/bin/python3': '3.12.3' }[file]
      if (!v) throw new Error('ENOENT')
      return { stdout: `Python ${v}`, stderr: '' }
    }
    expect(await findSystemPython({ platform: 'linux', exec })).toBe('/usr/local/bin/python3')
  })
})

describe('missing base packages in the managed environment', () => {
  /** An environment folder whose python exists on disk. The probe itself goes through `exec`. */
  function envWith(missing: string[]) {
    const envDir = mkdtempSync(path.join(tmpdir(), 'dalliance-env-'))
    mkdirSync(path.dirname(managedPython(envDir)), { recursive: true })
    writeFileSync(managedPython(envDir), '')
    const probes: string[][] = []
    const exec: Exec = async (file, args) => {
      probes.push([file, ...args])
      const asked: string[] = JSON.parse(args[1].match(/for p in (\[.*?\])/)![1])
      return { stdout: JSON.stringify(asked.filter((name) => missing.includes(name))), stderr: '' }
    }
    return { envDir, exec, probes }
  }

  it('reports pip names, mapping sklearn back to scikit-learn', async () => {
    const { envDir, exec, probes } = envWith(['scipy', 'sklearn', 'seaborn', 'statsmodels'])
    expect(await missingBasePackages(envDir, exec)).toEqual(['scipy', 'statsmodels', 'seaborn', 'scikit-learn'])
    expect(probes[0][0]).toBe(managedPython(envDir))
    expect(probes[0][2]).toContain('"sklearn"')
  })

  it('installs only what is missing into the managed environment', async () => {
    const { envDir, exec } = envWith(['sklearn', 'seaborn'])
    const log: string[] = []
    expect(await installMissingBasePackages(envDir, (line) => log.push(line), exec)).toEqual(['seaborn', 'scikit-learn'])
    expect(spawned).toEqual([{ cmd: managedPython(envDir), args: ['-m', 'pip', 'install', '--', 'seaborn', 'scikit-learn'] }])
    expect(log[0]).toBe('Installing seaborn, scikit-learn')
  })

  it('does nothing when the environment is complete', async () => {
    const { envDir, exec } = envWith([])
    expect(await installMissingBasePackages(envDir, () => {}, exec)).toEqual([])
    expect(spawned).toEqual([])
  })

  it('does nothing when there is no managed environment', async () => {
    const exec = vi.fn<Exec>()
    const envDir = path.join(tmpdir(), 'dalliance-no-env-here')
    expect(await missingBasePackages(envDir, exec)).toEqual([])
    expect(await installMissingBasePackages(envDir, () => {}, exec)).toEqual([])
    expect(exec).not.toHaveBeenCalled()
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
