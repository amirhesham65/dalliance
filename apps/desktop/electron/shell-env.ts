import { execFile } from 'node:child_process'

const MARKER = '__DALLIANCE_ENV__'

/**
 * Read variables from the user's login shell. An app opened from Finder or the Dock doesn't inherit what
 * `~/.zshrc` exports, so someone with `ANTHROPIC_API_KEY` set in their terminal would still be asked for it.
 * Resolves to the names that have a value. Any failure, or a shell slower than the timeout, resolves empty.
 */
export function readShellEnv(names: string[], timeoutMs = 5000): Promise<Record<string, string>> {
  if (process.platform === 'win32' || names.length === 0) return Promise.resolve({})
  const shell = process.env.SHELL || '/bin/zsh'
  // The marker skips anything the profile prints first. /usr/bin/env works the same in bash, zsh and fish.
  const command = `echo ${MARKER}; /usr/bin/env`
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', command],
      // Keeps oh-my-zsh from stopping to ask about updates
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      (err, stdout) => {
        if (err) return resolve({})
        resolve(parseEnv(stdout, names))
      },
    )
  })
}

export function parseEnv(stdout: string, names: string[]): Record<string, string> {
  // The marker counts only as a whole line. sh and bash set `_` to the last command's argument,
  // so env itself prints `_=__DALLIANCE_ENV__`, and a substring search would start after the variables.
  const lines = stdout.split('\n')
  const start = lines.lastIndexOf(MARKER)
  if (start < 0) return {}
  const found: Record<string, string> = {}
  for (const line of lines.slice(start + 1)) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const name = line.slice(0, eq)
    const value = line.slice(eq + 1).trim()
    if (names.includes(name) && value) found[name] = value
  }
  return found
}
