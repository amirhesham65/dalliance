// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EventBus } from './events'
import { createRunLog, installExtensions, isSecretPath } from './extensions'

function setup(options: { maxLogBytes?: number } = {}) {
  const logDir = path.join(mkdtempSync(path.join(tmpdir(), 'dalliance-ext-')), 'logs')
  const bus = new EventBus()
  const { log } = installExtensions(bus, { logDir, ...options })
  const lines = () => (existsSync(path.join(logDir, 'agent.jsonl')) ? readFileSync(path.join(logDir, 'agent.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  return { bus, logDir, lines, log }
}

describe('the .env guard', () => {
  it.each(['.env', '.ENV', '.env.local', 'config/.env', 'config\\.env', 'C:\\work\\.Env.production', '/abs/path/.env.test'])('blocks %s', async (p) => {
    expect(isSecretPath(p)).toBe(true)
    const { bus } = setup()
    expect(await bus.emit('tool_call', { cellId: 'c1', toolName: 'read_file', input: { path: p } })).toEqual({ blocked: true, reason: `${p} may hold secrets, so it is off limits.` })
  })

  it.each(['env', '.envrc', 'data/.environment', 'notes.env', 'orders.csv', 'my.env/data.csv', 'environment.csv'])('allows %s', async (p) => {
    expect(isSecretPath(p)).toBe(false)
    const { bus } = setup()
    expect(await bus.emit('tool_call', { cellId: 'c1', toolName: 'read_file', input: { path: p } })).toEqual({ blocked: false })
  })

  it('only guards read_file', async () => {
    const { bus } = setup()
    expect(await bus.emit('tool_call', { cellId: 'c1', toolName: 'list_files', input: { path: '.env' } })).toEqual({ blocked: false })
  })
})

describe('the run log', () => {
  it('appends every event to agent.jsonl with long strings clipped', async () => {
    const { bus, lines, log } = setup()
    await bus.emit('run_start', { cellId: 'c1', input: 'Average order value' })
    await bus.emit('tool_call', { cellId: 'c1', toolName: 'run_cell', input: { code: 'x'.repeat(5000) }, approve: async () => true })
    await bus.emit('step', { cellId: 'c1', step: 1, modelId: 'claude-opus-5', finishReason: 'tool-calls', durationMs: 900, usage: { inputTokens: 1200, outputTokens: 40, cacheReadTokens: 1000, cacheWriteTokens: 150 } })
    await log.idle()
    const [start, call, step] = lines()
    expect(start).toMatchObject({ event: 'run_start', cellId: 'c1', input: 'Average order value' })
    expect(typeof start.at).toBe('string')
    expect(call.input.code).toHaveLength(2001)
    expect(call.input.code.endsWith('…')).toBe(true)
    expect(call).not.toHaveProperty('approve')
    expect(step).toEqual({
      at: expect.any(String),
      event: 'step',
      cellId: 'c1',
      step: 1,
      modelId: 'claude-opus-5',
      finishReason: 'tool-calls',
      durationMs: 900,
      usage: { inputTokens: 1200, outputTokens: 40, cacheReadTokens: 1000, cacheWriteTokens: 150 },
    })
  })

  it('logs a blocked call before the block stops the other handlers', async () => {
    const { bus, lines, log } = setup()
    expect(await bus.emit('tool_call', { cellId: 'c1', toolName: 'read_file', input: { path: '.env' } })).toMatchObject({ blocked: true })
    await log.idle()
    expect(lines()).toMatchObject([{ event: 'tool_call', toolName: 'read_file', input: { path: '.env' } }])
  })

  it('keeps lines in the order they were written, however fast they come', async () => {
    const { log, lines } = setup()
    for (let i = 0; i < 300; i++) void log.write('tool_call', { cellId: 'c1', i, pad: 'x'.repeat(i % 7 === 0 ? 1500 : 10) })
    await log.idle()
    expect(lines().map((l) => l.i)).toEqual(Array.from({ length: 300 }, (_, i) => i))
  })

  it('rotates at the size limit and keeps one backup', async () => {
    const { log, logDir, lines } = setup({ maxLogBytes: 2000 })
    const file = path.join(logDir, 'agent.jsonl')
    for (let i = 0; i < 60; i++) void log.write('tool_call', { cellId: 'c1', i, pad: 'x'.repeat(100) })
    await log.idle()
    expect(statSync(file).size).toBeLessThanOrEqual(2000)
    expect(existsSync(`${file}.1`)).toBe(true)
    expect(statSync(`${file}.1`).size).toBeLessThanOrEqual(2000)
    expect(readdirSync(logDir).sort()).toEqual(['agent.jsonl', 'agent.jsonl.1'])
    // The backup holds the lines just before the current file's, with none lost between them
    const backup = readFileSync(`${file}.1`, 'utf-8').trim().split('\n').map((l) => JSON.parse(l).i)
    const current = lines().map((l) => l.i)
    expect([...backup, ...current]).toEqual(Array.from({ length: backup.length + current.length }, (_, k) => 60 - backup.length - current.length + k))
    expect(current.at(-1)).toBe(59)
  })

  it('rotates a log that was already over the limit when the app started', async () => {
    const logDir = path.join(mkdtempSync(path.join(tmpdir(), 'dalliance-ext-')), 'logs')
    mkdirSync(logDir)
    writeFileSync(path.join(logDir, 'agent.jsonl'), `${'{}\n'.repeat(1000)}`)
    const log = createRunLog(logDir, { maxBytes: 1000 })
    await log.write('run_start', { cellId: 'c1' })
    expect(readFileSync(path.join(logDir, 'agent.jsonl'), 'utf-8')).toContain('"run_start"')
    expect(statSync(path.join(logDir, 'agent.jsonl.1')).size).toBe(3000)
  })

  it('carries on after a failed write', async () => {
    const logDir = path.join(mkdtempSync(path.join(tmpdir(), 'dalliance-ext-')), 'logs')
    const log = createRunLog(logDir)
    await log.write('run_start', { cellId: 'c1' })
    rmSync(logDir, { recursive: true })
    writeFileSync(logDir, 'not a folder')
    await log.write('run_start', { cellId: 'c2' })
    rmSync(logDir)
    await log.write('run_start', { cellId: 'c3' })
    expect(readFileSync(path.join(logDir, 'agent.jsonl'), 'utf-8')).toContain('"c3"')
  })
})
