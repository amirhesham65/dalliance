/**
 * Reads the Python the agent wants to run and names what it touches outside the notebook: secret files,
 * shell commands and the network. A speed bump, not a sandbox. It looks at the code's text, so code that hides
 * what it does, or a library that fetches a URL on its own like pd.read_csv("https://..."), gets through.
 * The aim is few false alarms: names in comments and in ordinary strings don't count, and neither do
 * look-alikes such as os.environ, environment.csv or urllib.parse.
 */

export type ConcernKind = 'secret' | 'shell' | 'network'

export interface CodeConcern {
  kind: ConcernKind
  /** What the code does, in words that follow "the code", like "reads ~/.ssh". */
  what: string
  /** The line of code it happens on, trimmed. */
  line: string
}

interface Scanned {
  /** The source with comments and string contents blanked out, same length and line breaks. */
  code: string
  strings: { text: string; at: number }[]
}

/** Separates Python code from its comments and string literals, keeping offsets. */
export function scanPython(src: string): Scanned {
  let code = ''
  const strings: Scanned['strings'] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '#') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      code += ' '.repeat(stop - i)
      i = stop
      continue
    }
    if (c === '"' || c === "'") {
      const quote = src.startsWith(c.repeat(3), i) ? c.repeat(3) : c
      let j = i + quote.length
      let text = ''
      while (j < src.length && !src.startsWith(quote, j)) {
        if (quote.length === 1 && src[j] === '\n') break
        const step = src[j] === '\\' ? 2 : 1
        text += src.slice(j, j + step)
        j += step
      }
      const end = Math.min(src.length, src.startsWith(quote, j) ? j + quote.length : j)
      strings.push({ text, at: i })
      code += src.slice(i, end).replace(/[^\n]/g, ' ')
      i = end
      continue
    }
    code += c
    i += 1
  }
  return { code, strings }
}

/** A read_file path the agent may not open: `.env` or `.env.*`, in any case, with either kind of separator. */
export function isSecretPath(p: string): boolean {
  const base = p.split(/[\\/]/).pop() ?? ''
  return /^\.env(\..*)?$/i.test(base)
}

const KEY_FILE = /^id_(?:rsa|dsa|ecdsa|ed25519)$/i
const CREDENTIAL_FILES = new Set(['.netrc', '_netrc', '.git-credentials', '.pgpass'])

/** What a string literal points at, if it is a secret file or a keychain command. */
function secretInString(text: string): string | null {
  // macOS `security` subcommands, whole or as one argv item
  if (/\b(?:find-(?:generic|internet)-password|dump-keychain)\b|\bsecurity\s+export\b/.test(text)) return 'reads the keychain'
  for (const token of text.split(/[\s'",;:=()]+|\{[^}]*\}/)) {
    if (!token) continue
    if (isSecretPath(token)) return 'reads a .env file'
    const parts = token.toLowerCase().split(/[\\/]+/)
    const base = parts.at(-1) ?? ''
    if (parts.includes('.ssh')) return 'reads ~/.ssh'
    if (KEY_FILE.test(base)) return 'reads an SSH private key'
    if (parts.includes('.aws')) return 'reads ~/.aws credentials'
    if (CREDENTIAL_FILES.has(base)) return `reads ${base}`
    if (/\.keychain(?:-db)?$/.test(base) || parts.includes('keychains')) return 'reads the keychain'
  }
  return null
}

type Rule = [kind: ConcernKind, pattern: RegExp, what: string]

/** Patterns on the code with comments and strings blanked. `(?<![\w.])` keeps attribute look-alikes like df.socket out. */
const CODE_RULES: Rule[] = [
  ['secret', /\b(?:load_dotenv|dotenv_values)\s*\(/, 'reads a .env file'],
  ['secret', /(?<![\w.])keyring\.(?:get_password|get_credential)\s*\(/, 'reads the keychain'],
  ['secret', /(?<![\w.])netrc\.netrc\s*\(/, 'reads .netrc'],
  ['shell', /^[ \t]*!(?!=)/m, 'runs a shell command'],
  ['shell', /^[ \t]*%{1,2}(?:pip|conda|mamba|system|sx|sh|bash|script)\b/m, 'runs a shell command'],
  ['shell', /(?<![\w.])subprocess\.\w+/, 'runs a subprocess'],
  ['shell', /(?<![\w.])os\.(?:system|popen|exec[lv]p?e?|spawn[lv]p?e?|posix_spawnp?|fork|forkpty)\s*\(/, 'runs a shell command'],
  ['shell', /\bcreate_subprocess_(?:exec|shell)\s*\(/, 'runs a subprocess'],
  ['shell', /(?<![\w.])pty\.spawn\s*\(/, 'runs a subprocess'],
  ['shell', /(?<![\w.])pip\.main\s*\(/, 'runs pip'],
  ['shell', /\bget_ipython\s*\(\s*\)\s*\.\s*(?:system|getoutput)\b/, 'runs a shell command'],
  // Strings are blanked, so the magic's name can't be read: any magic called by name can run %sx or %%bash
  ['shell', /\bget_ipython\s*\(\s*\)\s*\.\s*(?:run_line_magic|run_cell_magic|magic)\s*\(/, 'runs an IPython magic'],
  ['network', /(?<![\w.])(?:requests|httpx)\.(?:get|post|put|patch|delete|request|stream|Session|Client|AsyncClient)\s*\(/, 'uses the network'],
  ['network', /(?<![\w.])(?:aiohttp|urllib3)\.\w+/, 'uses the network'],
  ['network', /(?<![\w.])urllib\.request\b/, 'uses the network'],
  ['network', /(?<![\w.])(?:urlopen|urlretrieve)\s*\(/, 'uses the network'],
  ['network', /(?<![\w.])socket\.(?:socket|create_connection|create_server|getaddrinfo|gethostbyname)\s*\(/, 'uses the network'],
]

const SHELL_MODULES = new Set(['subprocess', 'pty', 'pexpect', 'pip'])
const NETWORK_MODULES = new Set(['requests', 'httpx', 'aiohttp', 'urllib2', 'urllib3', 'socket', 'ftplib', 'smtplib', 'telnetlib', 'websocket', 'websockets', 'paramiko', 'pycurl'])

/** What importing `names` from `mod` means. `import x` has no names. */
function importConcern(mod: string, names: string[]): [ConcernKind, string] | null {
  const root = mod.split('.')[0]
  if (root === 'keyring') return ['secret', 'reads the keychain']
  if (root === 'netrc') return ['secret', 'reads .netrc']
  if (SHELL_MODULES.has(root)) return ['shell', root === 'pip' ? 'runs pip' : 'runs a subprocess']
  if (root === 'os' && names.some((n) => /^(?:system|popen|exec[lv]p?e?|spawn[lv]p?e?|posix_spawnp?)$/.test(n))) return ['shell', 'runs a shell command']
  if (root === 'asyncio' && names.some((n) => n.startsWith('create_subprocess'))) return ['shell', 'runs a subprocess']
  if (NETWORK_MODULES.has(root)) return ['network', 'uses the network']
  // urllib.parse and http.HTTPStatus are only names and parsing
  if (root === 'urllib' && (mod.startsWith('urllib.request') || names.includes('request'))) return ['network', 'uses the network']
  if (root === 'http' && (/^http\.(?:client|server)/.test(mod) || names.some((n) => n === 'client' || n === 'server'))) return ['network', 'uses the network']
  return null
}

/** Everything the code touches that the policy cares about, in source order. */
export function inspectCode(src: string): CodeConcern[] {
  const { code, strings } = scanPython(src)
  const lineAt = (at: number) => {
    const start = src.lastIndexOf('\n', at - 1) + 1
    const end = src.indexOf('\n', at)
    return src.slice(start, end === -1 ? src.length : end).trim()
  }
  const found: (CodeConcern & { at: number })[] = []
  const add = (kind: ConcernKind, what: string, at: number) => found.push({ kind, what, line: lineAt(at), at })

  for (const s of strings) {
    const what = secretInString(s.text)
    if (what) add('secret', what, s.at)
  }
  for (const [kind, pattern, what] of CODE_RULES) {
    const m = pattern.exec(code)
    if (m) add(kind, what, m.index)
  }
  // Imports, one statement at a time. Offsets stay those of the blanked code, which match the source.
  const statement = /[^\n;]+/g
  for (let m = statement.exec(code); m; m = statement.exec(code)) {
    const s = m[0]
    const from = s.match(/^\s*from\s+([\w.]+)\s+import\s+\(?([\w\s,]*)/)
    const plain = s.match(/^\s*import\s+([\w.\s,]+)/)
    const pairs: [string, string[]][] = from
      ? [[from[1], from[2].split(/[\s,]+/).filter((n) => n && n !== 'as')]]
      : plain
        ? plain[1].split(',').map((part) => [part.trim().split(/\s+/)[0], []])
        : []
    for (const [mod, names] of pairs) {
      const concern = importConcern(mod, names)
      if (concern) add(concern[0], concern[1], m.index)
    }
  }
  // __import__("requests") and importlib.import_module("subprocess") name the module in a string
  for (const m of src.matchAll(/\b(?:__import__|import_module)\s*\(\s*[rRbBuU]?['"]([\w.]+)['"]/g)) {
    const concern = importConcern(m[1], [])
    if (concern) add(concern[0], concern[1], m.index)
  }
  return found.sort((a, b) => a.at - b.at).map(({ at: _at, ...concern }) => concern)
}
