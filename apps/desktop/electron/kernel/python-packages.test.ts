// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { installedPackages } from './python-packages'

describe('installedPackages', () => {
  it('lists the libraries of a real Python, sorted, once each, with versions', async () => {
    const packages = await installedPackages('python3')
    expect(packages.length).toBeGreaterThan(0)
    expect(packages.every((p) => p.name && typeof p.version === 'string')).toBe(true)
    const names = packages.map((p) => p.name.toLowerCase())
    expect(names).toEqual([...names].sort())
    expect(new Set(names).size).toBe(names.length)
  })

  it('fails when there is no such Python', async () => {
    await expect(installedPackages('/no/such/python')).rejects.toThrow()
  })
})
