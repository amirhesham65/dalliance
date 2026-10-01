// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { type ApprovalConfig, approver, createApproval, normalize } from './approval'
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
    expect(await bus.emit('tool_call', { cellId: 'c1', toolName: 'read_file', input: { path: p } })).toEqual({ blocked: true, reason: `${p} may hold secrets, so it is off limits.`, secret: p })
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

  it("keeps a step's reasoning summary whole, however long", async () => {
    const { bus, lines, log } = setup()
    const reasoning = 'Check the stages first. '.repeat(300)
    await bus.emit('step', { cellId: 'c1', step: 1, reasoning })
    await bus.emit('step', { cellId: 'c1', step: 2, reasoning: null })
    await log.idle()
    expect(lines().map((l) => l.reasoning)).toEqual([reasoning, null])
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

  it('tags each line with its tab when tabs share one log, keeping every line whole and in order', async () => {
    const { bus, lines, log } = setup()
    const other = new EventBus()
    installExtensions(other, { logDir: 'unused', log, fields: { tab: 'tab-2' } })
    const first = new EventBus()
    installExtensions(first, { logDir: 'unused', log, fields: { tab: 'tab-1' } })
    await first.emit('run_start', { cellId: 'a', input: 'x'.repeat(3000) })
    await other.emit('run_start', { cellId: 'b', input: 'Total' })
    await first.emit('run_end', { cellId: 'a' })
    await bus.emit('run_end', { cellId: 'c' })
    await log.idle()
    expect(lines().map((l) => [l.event, l.tab, l.cellId])).toEqual([
      ['run_start', 'tab-1', 'a'],
      ['run_start', 'tab-2', 'b'],
      ['run_end', 'tab-1', 'a'],
      ['run_end', undefined, 'c'],
    ])
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

describe('the code policy', () => {
  /** A bus with the built-in extensions and the real approval flow, trusting what a person approves as the session does. */
  function policy(config: ApprovalConfig, answer: boolean) {
    const { bus } = setup()
    const trust = new Set<string>()
    const asked: { title: string; detail: string; keys: string[] }[] = []
    const approve = approver(createApproval(config, trust), async (title, detail, keys) => {
      asked.push({ title, detail, keys })
      if (answer) for (const key of keys) trust.add(normalize(key))
      return answer
    })
    const call = (code: string, toolName = 'run_cell') => bus.emit('tool_call', { cellId: 'c1', toolName, input: { code }, approve })
    return { call, asked }
  }

  it('blocks secret files in every mode, without asking, and tells the model why', async () => {
    for (const config of [{ mode: 'interactive' }, { mode: 'background' }, { mode: 'delegated', trust: ['code:shell', 'code:network'] }] as ApprovalConfig[]) {
      const { call, asked } = policy(config, true)
      const gate = await call('import pandas as pd\nkeys = open(os.path.expanduser("~/.ssh/id_rsa")).read()')
      expect(gate.blocked).toBe(true)
      expect(gate.reason).toBe(
        'the code reads ~/.ssh (`keys = open(os.path.expanduser("~/.ssh/id_rsa")).read()`), which may hold secrets, so it is off limits. Do the task without it. If the user needs that step, say in finish that they can write it into the cell themselves.',
      )
      expect(await call('pd.read_csv("CONFIG\\\\.Env")', 'explore')).toMatchObject({ blocked: true })
      expect(asked).toEqual([])
    }
  })

  it('asks in interactive mode, showing the line, and trusts the answer for the rest of the session', async () => {
    const { call, asked } = policy({ mode: 'interactive' }, true)
    expect(await call('import requests\nrequests.get(url).json()')).toEqual({ blocked: false })
    expect(await call('r = requests.get(other)', 'explore')).toEqual({ blocked: false })
    expect(asked).toEqual([{ title: 'Let the agent use the network?', detail: 'import requests', keys: ['code:network'] }])
    // Shell commands are a separate question
    expect(await call('os.system("ls")')).toEqual({ blocked: false })
    expect(asked.map((a) => a.title)).toEqual(['Let the agent use the network?', 'Let the agent run shell commands?'])
  })

  it('blocks with a reason when the user declines, and asks again next time', async () => {
    const { call, asked } = policy({ mode: 'interactive' }, false)
    const gate = await call('subprocess.run(["pip", "install", "seaborn"])')
    expect(gate).toEqual({ blocked: true, reason: expect.stringContaining('the user declined letting the code run shell commands') })
    expect(gate.reason).toContain('install_packages')
    await call('subprocess.run(["ls"])')
    expect(asked).toHaveLength(2)
  })

  it('never asks in background mode, as with installs', async () => {
    const { call, asked } = policy({ mode: 'background' }, false)
    expect(await call('import socket\nimport subprocess')).toEqual({ blocked: false })
    expect(asked).toEqual([])
  })

  it('asks in delegated mode only for what is not trusted', async () => {
    const { call, asked } = policy({ mode: 'delegated', trust: ['code:network'] }, true)
    expect(await call('import httpx')).toEqual({ blocked: false })
    expect(asked).toEqual([])
    await call('!ls')
    expect(asked.map((a) => a.keys)).toEqual([['code:shell']])
  })

  it('leaves plain analysis alone and only reads explore and run_cell', async () => {
    const { call, asked } = policy({ mode: 'interactive' }, false)
    expect(await call('env = pd.read_csv("environment.csv")\nenv.requests.sum()')).toEqual({ blocked: false })
    expect(await call('import requests', 'read_file')).toEqual({ blocked: false })
    expect(asked).toEqual([])
  })

  it('says no when there is nobody to ask', async () => {
    const { bus } = setup()
    expect(await bus.emit('tool_call', { cellId: 'c1', toolName: 'run_cell', input: { code: 'import requests' } })).toMatchObject({ blocked: true })
  })
})
