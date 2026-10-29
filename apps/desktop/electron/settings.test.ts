// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsStore } from './settings'

const access = () => 'test-key'
const dir = () => mkdtempSync(path.join(tmpdir(), 'dalliance-settings-'))
const store = (folder: string) => new SettingsStore(folder, access)

describe('SettingsStore', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads what an earlier run saved', () => {
    const folder = dir()
    store(folder).addRecent('/notebooks/sales.ipynb')
    expect(store(folder).recent.map((r) => r.path)).toEqual(['/notebooks/sales.ipynb'])
  })

  it('gives a setting the file leaves out its default', () => {
    const folder = dir()
    writeFileSync(path.join(folder, 'settings.json'), JSON.stringify({ autoTitles: false }))
    const settings = store(folder)
    expect(settings.view()).toMatchObject({ suggestNext: true, showUsage: false, autoTitles: false })

    settings.update({ suggestNext: false, showUsage: true })
    expect(store(folder).view()).toMatchObject({ suggestNext: false, showUsage: true, autoTitles: false })
  })

  it('resolves the selected model and key, with a default when none is given', () => {
    const settings = store(dir())
    expect(settings.modelConfig()).toEqual({ model: 'anthropic/claude-sonnet-5-5', effort: 'medium', key: access })
    settings.update({ model: ' google/gemini-3.8-flash ' })
    expect(settings.modelConfig().model).toBe('google/gemini-3.8-flash')
    expect(settings.update({ model: '' }).model).toBe('google/gemini-3.8-flash')
  })

  it('remembers model selections by provider and never saves key material in settings', () => {
    const folder = dir()
    const settings = store(folder)
    settings.update({ model: 'anthropic/claude-opus-5.5' })
    settings.update({ model: 'google/gemini-custom' })
    const restored = store(folder)
    expect(restored.view().providerModels).toMatchObject({ anthropic: 'anthropic/claude-opus-5-5', google: 'google/gemini-custom' })
    expect(restored.view().model).toBe('google/gemini-custom')
    expect(readFileSync(path.join(folder, 'settings.json'), 'utf8')).not.toContain('test-key')
    expect(() => settings.update({ model: 'unsupported/model' })).toThrow('Choose an Anthropic')
  })

  it('offers only low, medium and high effort for now, reading a saved higher one as high', () => {
    const folder = dir()
    writeFileSync(path.join(folder, 'settings.json'), JSON.stringify({ effort: 'max' }))
    const settings = store(folder)
    expect(settings.modelConfig().effort).toBe('high')
    expect(settings.update({ effort: 'xhigh' }).effort).toBe('high')
    expect(settings.update({ effort: 'low' }).effort).toBe('low')
    writeFileSync(path.join(folder, 'settings.json'), JSON.stringify({ effort: 'turbo' }))
    expect(store(folder).modelConfig().effort).toBe('medium')
  })

  it.skipIf(process.platform === 'win32')('keeps settings.json private', () => {
    const folder = dir()
    store(folder).update({ autoTitles: false })
    expect(statSync(path.join(folder, 'settings.json')).mode & 0o777).toBe(0o600)
  })

  it.each([
    ['does not parse', '{"model": "openai/gpt-6", "recent": ['],
    ['is not an object', 'null'],
  ])('moves a settings file that %s aside before starting from the defaults', (_what, contents) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const folder = dir()
    writeFileSync(path.join(folder, 'settings.json'), contents)

    const settings = store(folder)
    expect(settings.view()).toMatchObject({ model: 'anthropic/claude-sonnet-5-5', onboarded: false })
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

it('validates app lifecycle settings and preserves older settings defaults', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-app-policy-'))
  const store = new SettingsStore(dir)
  expect(store.view()).toMatchObject({ appsIdleMinutes: 15, appsMaxRunning: 3, appsHistoryLimit: 5 })
  store.update({ appsIdleMinutes: 0, appsMaxRunning: 2, appsHistoryLimit: 3 })
  expect(new SettingsStore(dir).view()).toMatchObject({ appsIdleMinutes: 0, appsMaxRunning: 2, appsHistoryLimit: 3 })
  expect(() => store.update({ appsIdleMinutes: -1, appsMaxRunning: 4 })).toThrow('Invalid')
  expect(store.view().appsMaxRunning).toBe(2)
  expect(() => store.update({ appsHistoryLimit: 0 })).toThrow('Invalid')
})
