// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { parseEnv, readShellEnv } from './shell-env'

describe('readShellEnv', () => {
  const shell = process.env.SHELL
  afterEach(() => {
    process.env.SHELL = shell
    delete process.env.DALLIANCE_TEST_KEY
  })

  it('skips what the profile prints before the marker, and names with no value', () => {
    const stdout = 'Welcome back!\nANTHROPIC_API_KEY=from-the-motd\n__DALLIANCE_ENV__\nPATH=/usr/bin\nANTHROPIC_API_KEY=sk-ant-123\nAI_GATEWAY_API_KEY=\n'
    expect(parseEnv(stdout, ['ANTHROPIC_API_KEY', 'AI_GATEWAY_API_KEY'])).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-123' })
    expect(parseEnv('no marker at all', ['ANTHROPIC_API_KEY'])).toEqual({})
  })

  it.skipIf(process.platform === 'win32')('reads a variable through a real login shell', async () => {
    process.env.SHELL = '/bin/sh'
    process.env.DALLIANCE_TEST_KEY = 'vck_abc'
    expect(await readShellEnv(['DALLIANCE_TEST_KEY', 'DALLIANCE_UNSET'])).toEqual({ DALLIANCE_TEST_KEY: 'vck_abc' })
  })

  it('gives up quietly when the shell is missing', async () => {
    process.env.SHELL = '/nonexistent/shell'
    expect(await readShellEnv(['DALLIANCE_TEST_KEY'])).toEqual({})
  })
})
