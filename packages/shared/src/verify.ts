/**
 * What Verify needs besides running the cells: comparing a rerun's outputs with the saved ones, reading the
 * code for random calls with no fixed seed, and working out why a cell failed on a name nothing defines.
 * All of it is pure, so the renderer can use it without the main process. See docs/notebook-model.md.
 */
import { canonicalOutputs } from './normalize'
import type { Output } from './notebook'
import { scanPython } from './python'

/**
 * How a rerun's outputs compare with the saved ones, after `normalizeOutputs()`.
 * - `same`: everything matches, figures byte for byte.
 * - `figure`: text and tables match, and the same number of figures came back, but at least one isn't the same
 *   image. Plotting libraries don't always draw the same bytes twice, so this is not a failure.
 * - `changed`: text, a table, an error or the number of figures differs.
 */
export type OutputComparison = 'same' | 'figure' | 'changed'

export function compareOutputs(saved: Output[], fresh: Output[]): OutputComparison {
  const images = (outputs: Output[]) => outputs.flatMap((o) => (o.type === 'image' ? [o.data] : []))
  const rest = (outputs: Output[]) => outputs.filter((o) => o.type !== 'image')
  if (canonicalOutputs(rest(saved)) !== canonicalOutputs(rest(fresh))) return 'changed'
  const [a, b] = [images(saved), images(fresh)]
  if (a.length !== b.length) return 'changed'
  return a.every((data, i) => data === b[i]) ? 'same' : 'figure'
}

/** A random call that may give a different result on each run, with what to do about it in plain words. */
export interface SeedWarning {
  /** The call as written, like `np.random.choice` or `RandomForestClassifier`. */
  call: string
  /** One sentence, with `code` in backticks. */
  text: string
}

// NumPy's legacy functions, which draw from the global generator that np.random.seed() fixes
const NUMPY_LEGACY = new Set(
  (
    'rand randn randint random random_sample random_integers ranf sample choice shuffle permutation bytes normal uniform binomial ' +
    'poisson exponential beta gamma multinomial multivariate_normal lognormal standard_normal standard_exponential standard_gamma ' +
    'standard_cauchy standard_t chisquare dirichlet geometric gumbel hypergeometric laplace logistic logseries negative_binomial ' +
    'noncentral_chisquare noncentral_f pareto power rayleigh triangular vonmises wald weibull zipf f'
  ).split(' '),
)

// The random module's functions, which draw from the generator that random.seed() fixes
const RANDOM_FUNCTIONS = new Set(
  (
    'random randint randrange choice choices shuffle sample uniform gauss normalvariate triangular betavariate expovariate ' +
    'gammavariate lognormvariate vonmisesvariate paretovariate weibullvariate getrandbits randbytes binomialvariate'
  ).split(' '),
)

// scikit-learn estimators, splitters and helpers whose result depends on random_state
const SKLEARN_RANDOM = new Set(
  (
    'RandomForestClassifier RandomForestRegressor ExtraTreesClassifier ExtraTreesRegressor GradientBoostingClassifier ' +
    'GradientBoostingRegressor HistGradientBoostingClassifier HistGradientBoostingRegressor BaggingClassifier BaggingRegressor ' +
    'AdaBoostClassifier AdaBoostRegressor IsolationForest RandomTreesEmbedding DecisionTreeClassifier DecisionTreeRegressor ' +
    'ExtraTreeClassifier ExtraTreeRegressor KMeans MiniBatchKMeans BisectingKMeans SpectralClustering GaussianMixture ' +
    'BayesianGaussianMixture MLPClassifier MLPRegressor SGDClassifier SGDRegressor TSNE TruncatedSVD ShuffleSplit ' +
    'StratifiedShuffleSplit GroupShuffleSplit RepeatedKFold RepeatedStratifiedKFold RandomizedSearchCV train_test_split ' +
    'permutation_importance make_classification make_regression make_blobs'
  ).split(' '),
)
// Splitters that only shuffle when asked to
const SKLEARN_SHUFFLE_ONLY = new Set(['KFold', 'StratifiedKFold', 'StratifiedGroupKFold'])

/**
 * Random calls in a cell's code that no seed fixes, read from the text. `above` is the code of the cells
 * before it, where a seed or an import may be. It errs on the quiet side: a seed set anywhere above or in the
 * cell counts, a generator made with a seed and used later is fine, and a call it can't read, such as one
 * passing `**kwargs`, is left alone. Comments and strings don't count.
 */
export function seedWarnings(code: string, above: string[] = []): SeedWarning[] {
  const here = scanPython(code).code
  const context = [...above.map((c) => scanPython(c).code), here].join('\n')
  const found = new Map<string, string>()
  const warn = (call: string, text: string) => {
    if (!found.has(call)) found.set(call, text)
  }

  // NumPy, as np, numpy or whatever it was imported as
  const numpy = new Set(['np', 'numpy', ...importAliases(context, 'numpy')])
  for (const alias of numpy) {
    const seeded = new RegExp(`(?<![\\w.])${alias}\\.random\\.seed\\s*\\(`).test(context)
    for (const m of here.matchAll(new RegExp(`(?<![\\w.])${alias}\\.random\\.(\\w+)\\s*\\(`, 'g'))) {
      const fn = m[1]
      const call = `${alias}.random.${fn}`
      if (NUMPY_LEGACY.has(fn) && !seeded)
        warn(call, `\`${call}\` runs with no seed set, so it can give different numbers each run. Call \`${alias}.random.seed(0)\` first, or draw from \`${alias}.random.default_rng(0)\`.`)
      if ((fn === 'default_rng' || fn === 'RandomState') && unseeded(callArgs(here, m.index + m[0].length)))
        warn(`${call}()`, `\`${call}()\` has no seed, so it can give different numbers each run. Pass one, like \`${fn}(0)\`.`)
    }
  }
  if (/^\s*from\s+numpy\.random\s+import\b[^\n]*\bdefault_rng\b/m.test(context)) {
    for (const m of here.matchAll(/(?<![\w.])default_rng\s*\(/g))
      if (unseeded(callArgs(here, m.index + m[0].length)))
        warn('default_rng()', '`default_rng()` has no seed, so it can give different numbers each run. Pass one, like `default_rng(0)`.')
  }

  // The random module, only once it's imported, so np.random and the like don't count
  for (const alias of importAliases(context, 'random')) {
    const seeded = new RegExp(`(?<![\\w.])${alias}\\.seed\\s*\\(`).test(context)
    for (const m of here.matchAll(new RegExp(`(?<![\\w.])${alias}\\.(\\w+)\\s*\\(`, 'g'))) {
      const fn = m[1]
      const call = `${alias}.${fn}`
      if (RANDOM_FUNCTIONS.has(fn) && !seeded)
        warn(call, `\`${call}\` runs without \`${alias}.seed()\`, so it can give a different result each run. Call \`${alias}.seed(0)\` first.`)
      if (fn === 'Random' && unseeded(callArgs(here, m.index + m[0].length)))
        warn(`${call}()`, `\`${call}()\` has no seed, so it can give a different result each run. Pass one, like \`Random(0)\`.`)
    }
  }

  // scikit-learn, only in a notebook that uses it
  if (/\bsklearn\b/.test(context)) {
    for (const m of here.matchAll(/(?<![\w])([A-Za-z_]\w*)\s*\(/g)) {
      const name = m[1]
      if (!SKLEARN_RANDOM.has(name) && !SKLEARN_SHUFFLE_ONLY.has(name)) continue
      // A definition of the same name isn't a call
      if (/\b(?:def|class)\s+$/.test(here.slice(Math.max(0, m.index - 8), m.index))) continue
      const args = callArgs(here, m.index + m[0].length)
      if (args == null || args.includes('**') || /\brandom_state\s*=\s*(?!None\b)\S/.test(args)) continue
      if (SKLEARN_SHUFFLE_ONLY.has(name) && !/\bshuffle\s*=\s*True\b/.test(args)) continue
      if (name === 'train_test_split' && /\bshuffle\s*=\s*False\b/.test(args)) continue
      const does = SKLEARN_SHUFFLE_ONLY.has(name) ? 'shuffles with no `random_state`' : 'has no `random_state`'
      warn(name, `\`${name}\` ${does}, so it can give a different result each run. Pass \`random_state=0\`.`)
    }
  }
  return [...found].map(([call, text]) => ({ call, text }))
}

/** The names a module is imported as: `import random` gives `random`, `import numpy as np` gives `np`. */
function importAliases(code: string, module: string): string[] {
  const aliases: string[] = []
  for (const m of code.matchAll(/^[ \t]*import[ \t]+([^\n;]+)/gm)) {
    for (const part of m[1].split(',')) {
      const words = part.trim().split(/\s+/)
      if (words[0] !== module) continue
      const alias = words[1] === 'as' ? words[2] : module
      // Only a real identifier: the alias goes into a RegExp, and a malformed cell must not break Verify
      if (alias && /^[A-Za-z_]\w*$/.test(alias)) aliases.push(alias)
    }
  }
  return aliases
}

/** The text between a call's parentheses, from just after the opening one. Null when they don't close. */
function callArgs(code: string, from: number): string | null {
  let depth = 1
  for (let i = from; i < code.length; i++) {
    const c = code[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) return code.slice(from, i)
    }
  }
  return null
}

/** A generator made with no seed: `default_rng()`, or `default_rng(None)`. */
const unseeded = (args: string | null) => args != null && /^\s*(?:None\s*)?$/.test(args)

/** The name a cell's NameError is about, like `df` from "name 'df' is not defined". Null for any other outcome. */
export function missingName(outputs: Output[]): string | null {
  for (const o of outputs) {
    if (o.type !== 'error' || o.ename !== 'NameError') continue
    const m = /name '([A-Za-z_]\w*)' is not defined/.exec(o.evalue)
    if (m) return m[1]
  }
  return null
}

/** A prompt cell as the missing-name check sees it. */
export interface VerifiedCode {
  /** The cell's number, counting prompt cells from 1. */
  number: number
  code: string
  /** Whether this cell failed in the rerun. */
  failed: boolean
  /** Names the rerun assigned, from the kernel. Modules, functions and classes aren't among them. */
  assigned: string[]
  /** Code the agent ran while making the cell that isn't the cell's code: its explore calls and earlier attempts. */
  agentCode: string[]
}

/**
 * Why a cell failed on a name. `failed-above`: an earlier cell that failed defines it. `below`: only a later cell
 * defines it. `agent`: only code the agent ran outside the cells defined it, most often while exploring the data,
 * so the cell only worked in the session that made it. `nowhere`: no cell or known agent code defines it, so it
 * came from outside the notebook.
 */
export type MissingNameCause =
  | { kind: 'failed-above'; cell: number }
  | { kind: 'below'; cell: number }
  | { kind: 'agent'; cell: number }
  | { kind: 'nowhere' }

/**
 * Why the cell at `index` failed on `name`, or null when an earlier cell that ran does define it, since then
 * something else is going on (a `del`, or an `if` that didn't run).
 */
export function missingNameCause(name: string, index: number, cells: VerifiedCode[]): MissingNameCause | null {
  let failedAbove: number | null = null
  for (const c of cells.slice(0, index)) {
    const defined = definedNames(c.code)
    if (c.failed) {
      if (defined.names.has(name)) failedAbove = c.number
      continue
    }
    if (defined.star || defined.names.has(name) || c.assigned.includes(name)) return null
  }
  if (failedAbove != null) return { kind: 'failed-above', cell: failedAbove }
  const below = cells.slice(index + 1).find((c) => definedNames(c.code).names.has(name))
  if (below) return { kind: 'below', cell: below.number }
  const agent = cells.find((c) => c.agentCode.some((code) => definedNames(code).names.has(name)))
  if (agent) return { kind: 'agent', cell: agent.number }
  return { kind: 'nowhere' }
}

/**
 * The global names a piece of Python defines, read from its text: assignments, `for` and `with` targets,
 * `def`, `class`, imports and `:=`. Names inside a function or class body are left out, since they aren't
 * globals. `star` is true when a `from x import *` may define anything.
 */
export function definedNames(src: string): { names: Set<string>; star: boolean } {
  const names = new Set<string>()
  let star = false
  // Indents of the def and class statements whose bodies are being skipped
  let body: number | null = null
  for (const { text, indent } of statements(scanPython(src).code)) {
    if (body != null) {
      if (indent > body) continue
      body = null
    }
    for (const m of text.matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*:=/g)) names.add(m[1])
    let rest = text
    // A compound statement: its header, then the body on the same line, if any
    while (rest) {
      const header = /^(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(rest)
      if (header) {
        names.add(header[2])
        // A one-line body, `def f(): return 1`, has no indented lines to skip
        if (!oneLineBody(rest)) body = indent
        break
      }
      const from = /^from\s+[\w.]+\s+import\s+(.+)$/.exec(rest)
      if (from) {
        const list = from[1].replace(/[()]/g, ' ')
        if (list.trim() === '*') star = true
        for (const part of list.split(',')) {
          const words = part.trim().split(/\s+/)
          const name = words[1] === 'as' ? words[2] : words[0]
          if (name && /^[A-Za-z_]\w*$/.test(name)) names.add(name)
        }
        break
      }
      const plain = /^import\s+(.+)$/.exec(rest)
      if (plain) {
        for (const part of plain[1].split(',')) {
          const words = part.trim().split(/\s+/)
          const name = words[1] === 'as' ? words[2] : words[0]?.split('.')[0]
          if (name && /^[A-Za-z_]\w*$/.test(name)) names.add(name)
        }
        break
      }
      const loop = /^(?:async\s+)?for\s+(.+?)\s+in\b/.exec(rest)
      if (loop) targetNames(loop[1], names)
      if (/^(?:async\s+)?with\b|^except\b/.test(rest)) for (const m of topLevel(headerOf(rest)).matchAll(/\bas\s+([A-Za-z_]\w*)/g)) names.add(m[1])
      if (/^(?:if|elif|else|while|for|async\s+for|with|async\s+with|try|except|finally)\b/.test(rest)) {
        rest = afterHeader(rest)
        continue
      }
      const parts = splitAssignment(rest)
      for (const target of parts.slice(0, -1)) targetNames(target, names)
      break
    }
  }
  return { names, star }
}

/** Logical statements of blanked code: lines joined inside brackets and after a backslash, and split at `;`. */
function statements(code: string): { text: string; indent: number }[] {
  const out: { text: string; indent: number }[] = []
  let depth = 0
  let current = ''
  const push = () => {
    const indent = current.length - current.trimStart().length
    const text = current.trim()
    if (text) out.push({ text, indent })
    current = ''
  }
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (c === '\\' && code[i + 1] === '\n') {
      current += ' '
      i++
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1)
    if (depth === 0 && c === '\n') {
      push()
      continue
    }
    if (depth === 0 && c === ';') {
      // The next statement on the line keeps this one's indent
      const indent = current.length - current.trimStart().length
      push()
      current = ' '.repeat(indent)
      continue
    }
    current += c === '\n' ? ' ' : c
  }
  push()
  return out
}

/** The index of a compound statement's header colon, outside brackets, or -1. A lambda's colon isn't one. */
function headerColon(text: string): number {
  let depth = 0
  let lambdas = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && /\blambda\b/.test(text.slice(i, i + 7)) && !/\w/.test(text[i - 1] ?? '')) lambdas++
    else if (depth === 0 && c === ':' && text[i + 1] !== '=') {
      if (lambdas) lambdas--
      else return i
    }
  }
  return -1
}

const headerOf = (text: string) => {
  const colon = headerColon(text)
  return colon < 0 ? text : text.slice(0, colon)
}
const afterHeader = (text: string) => {
  const colon = headerColon(text)
  return colon < 0 ? '' : text.slice(colon + 1).trim()
}
const oneLineBody = (text: string) => afterHeader(text) !== ''

/** The text with everything inside brackets taken out, so a keyword argument's `=` or `as` isn't read. */
function topLevel(text: string): string {
  let depth = 0
  let out = ''
  for (const c of text) {
    if (c === '(' || c === '[' || c === '{') depth++
    if (depth === 0) out += c
    if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1)
  }
  return out
}

/**
 * A statement split at its assignment `=` signs, outside brackets. One part means it isn't an assignment.
 * `f = lambda x=1: x` splits at the lambda's default too, but `lambda x` doesn't read as a target.
 */
function splitAssignment(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && c === '=' && text[i + 1] !== '=' && !'=!<>+-*/%&|^@:'.includes(text[i - 1] ?? '')) {
      parts.push(text.slice(start, i))
      start = i + 1
    } else if (depth === 0 && c === '=' && text[i + 1] === '=') i++
  }
  parts.push(text.slice(start))
  return parts
}

/** The names an assignment target binds: `a`, `a, b`, `(a, *b)`, `x: int`. Attributes and subscripts bind none. */
function targetNames(target: string, names: Set<string>) {
  let t = target.trim()
  const annotated = /^([A-Za-z_]\w*)\s*:(?!=)/.exec(t)
  if (annotated) {
    names.add(annotated[1])
    return
  }
  if ((t.startsWith('(') && t.endsWith(')')) || (t.startsWith('[') && t.endsWith(']'))) t = t.slice(1, -1)
  for (const part of splitTop(t)) {
    const p = part.trim().replace(/^\*\s*/, '')
    if (/^[A-Za-z_]\w*$/.test(p)) names.add(p)
    else if (/^[([].*[)\]]$/.test(p)) targetNames(p, names)
  }
}

/** Split at commas outside brackets. */
function splitTop(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && c === ',') {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}
