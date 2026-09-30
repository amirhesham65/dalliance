// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsStore } from './settings'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

const dir = () => mkdtempSync(path.join(tmpdir(), 'dalliance-settings-'))

describe('SettingsStore', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads what an earlier run saved', () => {
    const folder = dir()
    new SettingsStore(folder).addRecent('/notebooks/sales.ipynb')
    expect(new SettingsStore(folder).recent.map((r) => r.path)).toEqual(['/notebooks/sales.ipynb'])
  })

  it.skipIf(process.platform === 'win32')('keeps settings.json private', () => {
    const folder = dir()
    new SettingsStore(folder).update({ autoTitles: false })
    expect(statSync(path.join(folder, 'settings.json')).mode & 0o777).toBe(0o600)
  })

  it.each([
    ['does not parse', '{"provider": "anthropic", "recent": ['],
    ['is not an object', 'null'],
  ])('moves a settings file that %s aside before starting from the defaults', (_what, contents) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const folder = dir()
    writeFileSync(path.join(folder, 'settings.json'), contents)

    const settings = new SettingsStore(folder)
    expect(settings.view()).toMatchObject({ provider: 'gateway', onboarded: false })
    expect(warn).toHaveBeenCalledOnce()

    const aside = readdirSync(folder).filter((f) => f.startsWith('settings.json.corrupt-'))
    expect(aside).toHaveLength(1)
    expect(readFileSync(path.join(folder, aside[0]), 'utf-8')).toBe(contents)

    // The next save writes a fresh file and leaves the old one alone
    settings.update({ autoTitles: false })
    expect(JSON.parse(readFileSync(path.join(folder, 'settings.json'), 'utf-8'))).toMatchObject({ autoTitles: false })
    expect(readFileSync(path.join(folder, aside[0]), 'utf-8')).toBe(contents)
  })
})
