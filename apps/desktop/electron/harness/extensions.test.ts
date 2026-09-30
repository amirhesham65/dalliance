// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EventBus } from './events'
import { installExtensions, isSecretPath } from './extensions'

function setup() {
  const logDir = path.join(mkdtempSync(path.join(tmpdir(), 'dalliance-ext-')), 'logs')
  const bus = new EventBus()
  installExtensions(bus, { logDir })
  const lines = () => (existsSync(path.join(logDir, 'agent.jsonl')) ? readFileSync(path.join(logDir, 'agent.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  return { bus, logDir, lines }
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
    const { bus, lines } = setup()
    await bus.emit('run_start', { cellId: 'c1', input: 'Average order value' })
    await bus.emit('tool_call', { cellId: 'c1', toolName: 'run_cell', input: { code: 'x'.repeat(5000) } })
    await vi.waitFor(() => expect(lines()).toHaveLength(2))
    const [start, call] = lines()
    expect(start).toMatchObject({ event: 'run_start', cellId: 'c1', input: 'Average order value' })
    expect(typeof start.at).toBe('string')
    expect(call.input.code).toHaveLength(2001)
    expect(call.input.code.endsWith('…')).toBe(true)
  })
})
