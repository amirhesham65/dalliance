import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Packages the agent's generated code usually relies on. */
export const BASE_PACKAGES = ['pandas', 'numpy', 'matplotlib']

export interface PythonStatus {
  /** The interpreter the kernel will use, or null if none was found. */
  python: string | null
  version: string | null
  source: 'settings' | 'managed' | 'system' | null
  managedEnvExists: boolean
  missingPackages: string[]
}

const isWindows = process.platform === 'win32'

export function managedPython(envDir: string): string {
  return isWindows ? path.join(envDir, 'Scripts', 'python.exe') : path.join(envDir, 'bin', 'python')
}

/** Apps started from the Dock get a minimal PATH, so look in the usual install locations too. */
const SYSTEM_CANDIDATES = isWindows
  ? ['python', 'py']
  : ['python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']

async function version(python: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(python, ['--version'], { timeout: 5000 })
    const match = `${stdout}${stderr}`.match(/Python (\d+\.\d+\.\d+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export async function findSystemPython(): Promise<string | null> {
  for (const candidate of SYSTEM_CANDIDATES) {
    const v = await version(candidate)
    if (v && Number(v.split('.')[0]) >= 3 && Number(v.split('.')[1]) >= 9) return candidate
  }
  return null
}

export async function missingPackages(python: string, packages = BASE_PACKAGES): Promise<string[]> {
  const probe = `import importlib.util, json; print(json.dumps([p for p in ${JSON.stringify(packages)} if importlib.util.find_spec(p) is None]))`
  try {
    const { stdout } = await run(python, ['-c', probe], { timeout: 15000 })
    return JSON.parse(stdout.trim())
  } catch {
    return packages
  }
}

export async function pythonStatus(opts: { configured: string | null; envDir: string }): Promise<PythonStatus> {
  const managedEnvExists = existsSync(managedPython(opts.envDir))
  let python: string | null = null
  let source: PythonStatus['source'] = null
  if (opts.configured) {
    python = opts.configured
    source = 'settings'
  } else if (managedEnvExists) {
    python = managedPython(opts.envDir)
    source = 'managed'
  } else {
    python = await findSystemPython()
    source = python ? 'system' : null
  }
  const v = python ? await version(python) : null
  if (!python || !v) return { python: null, version: null, source: null, managedEnvExists, missingPackages: BASE_PACKAGES }
  return { python, version: v, source, managedEnvExists, missingPackages: await missingPackages(python) }
}

function stream(cmd: string, args: string[], onLog: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' } })
    const forward = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) if (line.trim()) onLog(line)
    }
    child.stdout.on('data', forward)
    child.stderr.on('data', forward)
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with code ${code}`))))
  })
}

/** Create the app's own virtual environment and install the base packages into it. */
export async function setupManagedEnv(envDir: string, onLog: (line: string) => void): Promise<string> {
  const python = managedPython(envDir)
  if (!existsSync(python)) {
    const system = await findSystemPython()
    if (!system) throw new Error('No Python 3.9 or later was found. Install Python from python.org or Homebrew, then try again.')
    onLog(`Creating a Python environment with ${system}`)
    await stream(system, ['-m', 'venv', envDir], onLog)
  }
  await installPackages(python, BASE_PACKAGES, onLog)
  return python
}

export async function installPackages(python: string, packages: string[], onLog: (line: string) => void) {
  const safe = packages.filter((p) => /^[A-Za-z0-9._\-[\]=<>~!,]+$/.test(p))
  if (safe.length !== packages.length) throw new Error('Package names can only contain letters, numbers and version specifiers.')
  if (!safe.length) return
  onLog(`Installing ${safe.join(', ')}`)
  await stream(python, ['-m', 'pip', 'install', ...safe], onLog)
}
