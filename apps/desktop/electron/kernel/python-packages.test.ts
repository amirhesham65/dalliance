// @vitest-environment node
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findSystemPython } from './python-env'
import { installedPackages, listingFailure } from './python-packages'

const python = await findSystemPython()
const folder = () => mkdtempSync(path.join(tmpdir(), 'dalliance-packages-'))

describe.skipIf(!python)('installedPackages', () => {
  it('lists the libraries of a real Python, sorted, once each, with versions', async () => {
    const packages = await installedPackages(python!, { cwd: folder() })
    expect(packages.length).toBeGreaterThan(0)
    expect(packages.every((p) => p.name && typeof p.version === 'string')).toBe(true)
    const names = packages.map((p) => p.name.toLowerCase())
    expect(names).toEqual([...names].sort())
    expect(new Set(names).size).toBe(names.length)
  })

  it('runs in the folder it is given, so a json.py elsewhere cannot shadow the standard library', async () => {
    const shadowed = folder()
    writeFileSync(path.join(shadowed, 'json.py'), 'raise ImportError("the json.py in this folder ran")\n')
    // python -c puts its working directory first on sys.path, so that folder breaks the listing
    await expect(installedPackages(python!, { cwd: shadowed })).rejects.toThrow('ImportError: the json.py in this folder ran')
    const previous = process.cwd()
    process.chdir(shadowed)
    try {
      await expect(installedPackages(python!, { cwd: folder() })).resolves.not.toHaveLength(0)
    } finally {
      process.chdir(previous)
    }
  })

  it('says there is no Python rather than quoting the script', async () => {
    const err = await installedPackages('/no/such/python', { cwd: folder() }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe("There's no Python at /no/such/python.")
    expect((err as Error).message).not.toContain('import json')
  })

  it('says it timed out when the Python takes too long', async () => {
    const dir = folder()
    const slow = path.join(dir, 'slow-python')
    writeFileSync(slow, '#!/bin/sh\nexec sleep 5\n')
    chmodSync(slow, 0o755)
    await expect(installedPackages(slow, { cwd: dir, timeoutMs: 200 })).rejects.toThrow(`${slow} took longer than 0.2 seconds to list its libraries.`)
  })

  it('says so when the Python answers with something else', async () => {
    const dir = folder()
    const odd = path.join(dir, 'odd-python')
    writeFileSync(odd, '#!/bin/sh\necho hello\n')
    chmodSync(odd, 0o755)
    await expect(installedPackages(odd, { cwd: dir })).rejects.toThrow("answered with something that isn't a list of libraries")
  })
})

describe('listingFailure', () => {
  const script = 'Command failed: python3 -c import json, importlib.metadata as m\nseen = {}'

  it('gives the last line of what Python wrote to stderr, not the command', () => {
    const stderr = 'Traceback (most recent call last):\n  File "<string>", line 1, in <module>\nModuleNotFoundError: No module named \'importlib.metadata\'\n'
    expect(listingFailure({ message: script, code: 1, stderr }, 'python3', 20_000)).toBe("ModuleNotFoundError: No module named 'importlib.metadata'")
  })

  it('says it timed out when execFile stopped the process', () => {
    expect(listingFailure({ message: script, killed: true, signal: 'SIGTERM', code: null, stderr: '' }, 'python3', 20_000)).toBe(
      'python3 took longer than 20 seconds to list its libraries.',
    )
  })

  it('falls back to the exit code, never the script', () => {
    expect(listingFailure({ message: script, code: 3, stderr: '' }, 'python3', 20_000)).toBe('python3 exited with code 3.')
    expect(listingFailure({ message: script }, 'python3', 20_000)).toBe("Couldn't run python3.")
  })
})
