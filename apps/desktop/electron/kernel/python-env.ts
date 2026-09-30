import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
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
 * stack, so ordinary statistics work without an install step, and IPython, which the kernel
 * runs cells through when it's there. A Python the user brings only needs the required ones.
 * The agent installs the rest on demand.
 */
export const BASE_PACKAGES = [...REQUIRED_PACKAGES, 'scipy', 'statsmodels', 'seaborn', 'scikit-learn', 'ipython']

/** Import names for the base packages whose pip name differs. */
const IMPORT_NAMES: Record<string, string> = { 'scikit-learn': 'sklearn', ipython: 'IPython' }

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

/** Runs a program and resolves with its output. Rejects when it can't start or exits non-zero. */
export type Exec = (file: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string; stderr: string }>

const realExec: Exec = (file, args, options) => run(file, args, options)

/** What Python discovery reads from the machine. Tests pass fakes. */
export interface DiscoveryDeps {
  platform: NodeJS.Platform
  exec: Exec
  exists: (file: string) => boolean
  /** The file names in a folder, or an empty list when it can't be read. */
  list: (dir: string) => string[]
  /** The PATH searched for `python3`. */
  path: string
}

const realDeps = (): DiscoveryDeps => ({
  platform: process.platform,
  exec: realExec,
  exists: existsSync,
  list: (dir) => {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  },
  path: process.env.PATH ?? '',
})

/** The oldest Python the kernel supports. */
const MIN_VERSION = [3, 9]

/** Homebrew on Apple Silicon, Homebrew on Intel and the python.org installer's links, then the framework itself. */
const MAC_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/Library/Frameworks/Python.framework/Versions/Current/bin']

/**
 * Apple's Python. Without the Command Line Tools, running it opens an install prompt instead
 * of Python, and with them it's an old 3.9. It's only tried when nothing else was found.
 */
const APPLE_PYTHON = '/usr/bin/python3'

async function version(python: string, exec: Exec = realExec): Promise<string | null> {
  try {
    const { stdout, stderr } = await exec(python, ['--version'], { timeout: 5000 })
    const match = `${stdout}${stderr}`.match(/Python (\d+\.\d+\.\d+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

const parts = (v: string) => v.split('.').map(Number)

/** Negative when `a` is older than `b`, zero when they're equal. */
function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

const supported = (v: string) => parts(v)[0] === 3 && compareVersions(parts(v), MIN_VERSION) >= 0

/** The first `name` in a folder on the PATH, as an absolute path. */
function onPath(name: string, deps: DiscoveryDeps): string | null {
  for (const dir of deps.path.split(':')) {
    if (!dir) continue
    const file = path.posix.join(dir, name)
    if (deps.exists(file)) return file
  }
  return null
}

/**
 * Where to look on a Mac. An app opened from the Dock gets a PATH like `/usr/bin:/bin`, where
 * `python3` is Apple's, so the usual install folders are searched as well. Each is searched for
 * `python3` and for versioned names like `python3.12`, since Homebrew only links `python3`
 * for its default version.
 */
function macCandidates(deps: DiscoveryDeps): string[] {
  const found: string[] = []
  const fromPath = onPath('python3', deps)
  if (fromPath && fromPath !== APPLE_PYTHON) found.push(fromPath)
  for (const dir of MAC_DIRS) {
    const file = path.posix.join(dir, 'python3')
    if (deps.exists(file)) found.push(file)
    const versioned = deps.list(dir).filter((name) => /^python3\.\d+$/.test(name)).sort()
    found.push(...versioned.map((name) => path.posix.join(dir, name)))
  }
  return [...new Set(found)]
}

/** The newest supported Python among `candidates`. A tie goes to the earlier one. */
async function newest(candidates: string[], exec: Exec): Promise<string | null> {
  const versions = await Promise.all(candidates.map((candidate) => version(candidate, exec)))
  let best: string | null = null
  let bestVersion: number[] = []
  for (const [i, python] of candidates.entries()) {
    const v = versions[i]
    if (!v || !supported(v)) continue
    if (best === null || compareVersions(parts(v), bestVersion) > 0) {
      best = python
      bestVersion = parts(v)
    }
  }
  return best
}

/** Whether Apple's Command Line Tools are installed, which makes `/usr/bin/python3` a real Python. */
async function hasCommandLineTools(exec: Exec): Promise<boolean> {
  try {
    await exec('/usr/bin/xcode-select', ['-p'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/** The newest Python 3.9 or later on this computer, or null. */
export async function findSystemPython(overrides: Partial<DiscoveryDeps> = {}): Promise<string | null> {
  const deps = { ...realDeps(), ...overrides }
  if (deps.platform === 'win32') return newest(['python', 'py'], deps.exec)
  if (deps.platform !== 'darwin') return newest(['python3', '/usr/local/bin/python3', '/usr/bin/python3'], deps.exec)
  const found = await newest(macCandidates(deps), deps.exec)
  if (found) return found
  // Checked first, because running Apple's Python without the tools opens an install prompt
  if (!(await hasCommandLineTools(deps.exec))) return null
  return newest([APPLE_PYTHON], deps.exec)
}

/** Which of `packages` (import names) `python` can't import. Reports all of them when the check fails. */
export async function missingPackages(python: string, packages = REQUIRED_PACKAGES, exec: Exec = realExec): Promise<string[]> {
  const probe = `import importlib.util, json; print(json.dumps([p for p in ${JSON.stringify(packages)} if importlib.util.find_spec(p) is None]))`
  try {
    const { stdout } = await exec(python, ['-c', probe], { timeout: 15000 })
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

/** A command that exited non-zero, with the end of what it printed. */
class CommandError extends Error {
  readonly output: string
  constructor(message: string, output: string) {
    super(message)
    this.output = output
  }
}

function stream(cmd: string, args: string[], onLog: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' } })
    // Kept for the error, so a caller can tell why it failed
    const tail: string[] = []
    const forward = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue
        onLog(line)
        tail.push(line)
        if (tail.length > 50) tail.shift()
      }
    }
    child.stdout.on('data', forward)
    child.stderr.on('data', forward)
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new CommandError(`${path.basename(cmd)} exited with code ${code}`, tail.join('\n')))))
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
 * Which of `BASE_PACKAGES` the managed environment lacks, as pip names. Environments made
 * before the list grew only have the required three. Empty when there's no environment.
 */
export async function missingBasePackages(envDir: string, exec: Exec = realExec): Promise<string[]> {
  const python = managedPython(envDir)
  if (!existsSync(python)) return []
  const missing = await missingPackages(python, BASE_PACKAGES.map((name) => IMPORT_NAMES[name] ?? name), exec)
  return BASE_PACKAGES.filter((name) => missing.includes(IMPORT_NAMES[name] ?? name))
}

/**
 * Install whatever `BASE_PACKAGES` the managed environment lacks, and resolve with their pip
 * names. Does nothing, and resolves empty, when there's no environment or nothing is missing.
 */
export async function installMissingBasePackages(envDir: string, onLog: (line: string) => void, exec: Exec = realExec): Promise<string[]> {
  const missing = await missingBasePackages(envDir, exec)
  if (missing.length) await installPackages(managedPython(envDir), missing, onLog)
  return missing
}

/**
 * A package name with an optional extra and version specifier, like `scikit-learn`,
 * `pandas[excel]` or `numpy==2.1`. The first character must be a letter or digit, so pip
 * never reads one as an option (`-e.`, `-rrequirements.txt`) or a local path (`.`).
 */
const PACKAGE_SPEC = /^[A-Za-z0-9][A-Za-z0-9._\-[\]=<>~!,]*$/
/** Archive names make pip install a local file instead of looking the package up. The list is pip's own. */
const ARCHIVE = /\.(whl|zip|tgz|tbz|txz|tlz|tar(\.(gz|bz2|xz|lz|lzma))?)$/i

export function isPackageSpec(spec: string): boolean {
  return PACKAGE_SPEC.test(spec) && !ARCHIVE.test(spec)
}

/** What pip prints when a Python is marked as managed by Homebrew or the OS (PEP 668). */
const EXTERNALLY_MANAGED = /externally-managed-environment/

export const EXTERNALLY_MANAGED_MESSAGE =
  "This Python is managed by Homebrew or the system, so pip won't install packages into it. Set up the managed environment in Settings > Python, then try again."

export async function installPackages(python: string, packages: string[], onLog: (line: string) => void) {
  if (!packages.every(isPackageSpec)) throw new Error('Package names must start with a letter or number and can only contain letters, numbers and version specifiers.')
  if (!packages.length) return
  onLog(`Installing ${packages.join(', ')}`)
  try {
    // `--` ends pip's options, so nothing after it can be read as a flag.
    await stream(python, ['-m', 'pip', 'install', '--', ...packages], onLog)
  } catch (err) {
    // Not retried with --break-system-packages: that can break the tools Homebrew or the OS runs
    if (err instanceof CommandError && EXTERNALLY_MANAGED.test(err.output)) throw new Error(EXTERNALLY_MANAGED_MESSAGE)
    throw err
  }
}
