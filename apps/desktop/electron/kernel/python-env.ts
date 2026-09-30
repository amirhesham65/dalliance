import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Packages a Python needs before the app calls it ready. The kernel and most generated
 * code depend on them. Pip names and import names are the same for these three.
 */
export const REQUIRED_PACKAGES = ['pandas', 'numpy', 'matplotlib']

/**
 * What the app's own environment installs: the required packages plus the usual research
 * stack, so ordinary statistics work without an install step. A Python the user brings
 * only needs the required ones. The agent installs the rest on demand.
 */
export const BASE_PACKAGES = [...REQUIRED_PACKAGES, 'scipy', 'statsmodels', 'seaborn', 'scikit-learn']

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

export async function missingPackages(python: string, packages = REQUIRED_PACKAGES): Promise<string[]> {
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
  if (!python || !v) return { python: null, version: null, source: null, managedEnvExists, missingPackages: REQUIRED_PACKAGES }
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

/**
 * A package name with an optional extra and version specifier, like `scikit-learn`,
 * `pandas[excel]` or `numpy==2.1`. The first character must be a letter or digit, so pip
 * never reads one as an option (`-e.`, `-rrequirements.txt`) or a local path (`.`).
 */
const PACKAGE_SPEC = /^[A-Za-z0-9][A-Za-z0-9._\-[\]=<>~!,]*$/
/** Archive names make pip install a local file instead of looking the package up. */
const ARCHIVE = /\.(whl|zip|tar|tgz|tar\.gz|tar\.bz2)$/i

export function isPackageSpec(spec: string): boolean {
  return PACKAGE_SPEC.test(spec) && !ARCHIVE.test(spec)
}

export async function installPackages(python: string, packages: string[], onLog: (line: string) => void) {
  if (!packages.every(isPackageSpec)) throw new Error('Package names must start with a letter or number and can only contain letters, numbers and version specifiers.')
  if (!packages.length) return
  onLog(`Installing ${packages.join(', ')}`)
  // `--` ends pip's options, so nothing after it can be read as a flag.
  await stream(python, ['-m', 'pip', 'install', '--', ...packages], onLog)
}
