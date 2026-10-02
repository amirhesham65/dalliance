// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsStore } from './settings'

const access = { baseURL: 'https://cloud.example/api/ai', signedIn: () => true, token: async () => 'jwt' }
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
    expect(settings.view()).toMatchObject({ suggestNext: true, showCosts: false, autoTitles: false })

    settings.update({ suggestNext: false, showCosts: true })
    expect(store(folder).view()).toMatchObject({ suggestNext: false, showCosts: true, autoTitles: false })
  })

  it('runs models on Dalliance Cloud, with the default model when none is given', () => {
    const settings = store(dir())
    expect(settings.modelConfig()).toEqual({ model: 'anthropic/claude-sonnet-5.5', effort: 'medium', cloud: access })
    settings.update({ model: ' google/gemini-3.8-flash ' })
    expect(settings.modelConfig().model).toBe('google/gemini-3.8-flash')
    expect(settings.update({ model: '' }).model).toBe('anthropic/claude-sonnet-5.5')
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
    expect(settings.view()).toMatchObject({ model: 'anthropic/claude-sonnet-5.5', onboarded: false })
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
