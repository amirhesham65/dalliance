import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PackageView } from '@dalliance/shared/ipc'

const run = promisify(execFile)

/** One line of JSON: every installed distribution, once, by name. importlib.metadata needs no pip. */
const SCRIPT = `import json, importlib.metadata as m
seen = {}
for d in m.distributions():
    name = d.metadata["Name"]
    if name and name.lower() not in seen:
        seen[name.lower()] = {"name": name, "version": d.version}
print(json.dumps(sorted(seen.values(), key=lambda p: p["name"].lower())))`

/** The libraries the given Python has, with versions, for the environment view. */
export async function installedPackages(python: string, timeoutMs = 20_000): Promise<PackageView[]> {
  const { stdout } = await run(python, ['-c', SCRIPT], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 })
  // A library that prints while it loads can put lines before ours, so take the last one
  const line = stdout.trim().split('\n').pop() ?? '[]'
  const packages = JSON.parse(line) as PackageView[]
  return packages.map(({ name, version }) => ({ name, version: version ?? '' }))
}
