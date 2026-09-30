import { describe, expect, it } from 'vitest'
import type { Output } from './notebook'
import { type VerifiedCode, compareOutputs, definedNames, missingName, missingNameCause, seedWarnings } from './verify'

const text = (t: string): Output => ({ type: 'text', text: t })
const image = (data: string): Output => ({ type: 'image', mime: 'image/png', data })
const table = (rows: (string | number)[][]): Output => ({ type: 'table', columns: ['a', 'b'], index: rows.map((_, i) => String(i)), rows, totalRows: rows.length })

describe('compareOutputs', () => {
  it('calls outputs the same once the normalizer has taken out what changes between runs', () => {
    const saved: Output[] = [{ type: 'stream', name: 'stdout', text: 'at 0x10f3a2b50\n' }, table([['x', 1]])]
    const fresh: Output[] = [
      { type: 'stream', name: 'stdout', text: 'at ' },
      { type: 'stream', name: 'stdout', text: '0x7f00deadbeef\r\n' },
      table([['x', 1]]),
    ]
    expect(compareOutputs(saved, fresh)).toBe('same')
  })

  it('keeps text and tables exact', () => {
    expect(compareOutputs([text('0.581')], [text('0.582')])).toBe('changed')
    expect(compareOutputs([table([['x', 1]])], [table([['x', 2]])])).toBe('changed')
    expect(compareOutputs([text('1')], [])).toBe('changed')
  })

  it('calls a figure the same only byte for byte, and a different one a figure that differs', () => {
    expect(compareOutputs([text('ok'), image('AAAA')], [text('ok'), image('AAAA')])).toBe('same')
    expect(compareOutputs([text('ok'), image('AAAA')], [text('ok'), image('BBBB')])).toBe('figure')
  })

  it('counts a missing figure, or changed text beside a figure, as changed', () => {
    expect(compareOutputs([image('AAAA'), image('BBBB')], [image('AAAA')])).toBe('changed')
    expect(compareOutputs([text('1'), image('AAAA')], [text('2'), image('BBBB')])).toBe('changed')
  })
})

describe('seedWarnings', () => {
  const calls = (code: string, above: string[] = []) => seedWarnings(code, above).map((w) => w.call)

  it("doesn't throw on an import line that isn't valid Python", () => {
    expect(() => seedWarnings('import numpy as np)\nnp.random.rand()')).not.toThrow()
    expect(() => seedWarnings('import random as (r\nr.random()')).not.toThrow()
  })

  it("warns about NumPy's global generator with no seed", () => {
    expect(calls('import numpy as np\nx = np.random.choice(ids, 50)')).toEqual(['np.random.choice'])
    expect(calls('import numpy\nnumpy.random.shuffle(ids)')).toEqual(['numpy.random.shuffle'])
    expect(calls('import numpy as npy\nnpy.random.normal(size=3)')).toEqual(['npy.random.normal'])
  })

  it('is quiet once a seed is set, in the cell or above it', () => {
    expect(calls('np.random.seed(0)\nnp.random.choice(ids, 50)')).toEqual([])
    expect(calls('np.random.choice(ids, 50)', ['import numpy as np\nnp.random.seed(42)'])).toEqual([])
  })

  it('warns about a generator made without a seed, and not one made with it', () => {
    expect(calls('rng = np.random.default_rng()\nrng.normal()')).toEqual(['np.random.default_rng()'])
    expect(calls('rng = np.random.default_rng(None)')).toEqual(['np.random.default_rng()'])
    expect(calls('rng = np.random.default_rng(2024)\nrng.normal()')).toEqual([])
    expect(calls('rng = default_rng()', ['from numpy.random import default_rng'])).toEqual(['default_rng()'])
    expect(calls('rng = default_rng(7)', ['from numpy.random import default_rng'])).toEqual([])
  })

  it('warns about the random module only once it is imported, and not after random.seed()', () => {
    expect(calls('import random\nrandom.shuffle(ids)')).toEqual(['random.shuffle'])
    expect(calls('random.sample(ids, 3)', ['import os, random'])).toEqual(['random.sample'])
    expect(calls('import random\nrandom.seed(1)\nrandom.shuffle(ids)')).toEqual([])
    // np.random is not the random module
    expect(calls('import random\nnp.random.seed(0)\nnp.random.shuffle(ids)')).toEqual([])
    expect(calls('random.shuffle(ids)')).toEqual([])
    expect(calls('import random\nr = random.Random()')).toEqual(['random.Random()'])
    expect(calls('import random\nr = random.Random(3)')).toEqual([])
  })

  it('warns about scikit-learn estimators and splitters without random_state', () => {
    const above = ['from sklearn.ensemble import RandomForestClassifier\nfrom sklearn.model_selection import train_test_split, KFold']
    expect(calls('model = RandomForestClassifier(n_estimators=200)', above)).toEqual(['RandomForestClassifier'])
    expect(calls('model = RandomForestClassifier(n_estimators=200, random_state=0)', above)).toEqual([])
    expect(calls('model = RandomForestClassifier(random_state=None)', above)).toEqual(['RandomForestClassifier'])
    expect(calls('X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2)', above)).toEqual(['train_test_split'])
    expect(calls('X_tr, X_te = train_test_split(X, shuffle=False)', above)).toEqual([])
    expect(calls('m = sklearn.cluster.KMeans(n_clusters=3,\n    n_init=10)', ['import sklearn.cluster'])).toEqual(['KMeans'])
  })

  it('warns about KFold only when it shuffles', () => {
    const above = ['from sklearn.model_selection import KFold']
    expect(calls('cv = KFold(5)', above)).toEqual([])
    expect(calls('cv = KFold(5, shuffle=True)', above)).toEqual(['KFold'])
    expect(calls('cv = KFold(5, shuffle=True, random_state=1)', above)).toEqual([])
  })

  it('keeps false alarms down', () => {
    // Comments and strings don't count
    expect(calls('import numpy as np\n# np.random.choice(ids)\nlabel = "np.random.rand()"')).toEqual([])
    // Not in a notebook that uses scikit-learn
    expect(calls('m = KMeans(3)')).toEqual([])
    // Arguments it can't read
    expect(calls('m = RandomForestClassifier(**params)', ['import sklearn'])).toEqual([])
    // A definition isn't a call
    expect(calls('def KMeans(k):\n    return k', ['import sklearn'])).toEqual([])
  })

  it('names each call once, in plain words with the fix', () => {
    const warnings = seedWarnings('import numpy as np\na = np.random.rand(3)\nb = np.random.rand(3)')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].text).toBe(
      '`np.random.rand` runs with no seed set, so it can give different numbers each run. Call `np.random.seed(0)` first, or draw from `np.random.default_rng(0)`.',
    )
  })
})

describe('missingName', () => {
  it("reads the name from a NameError, with or without Python's suggestion", () => {
    const error = (ename: string, evalue: string): Output => ({ type: 'error', ename, evalue, traceback: [] })
    expect(missingName([error('NameError', "name 'cohort' is not defined")])).toBe('cohort')
    expect(missingName([error('NameError', "name 'cohrt' is not defined. Did you mean: 'cohort'?")])).toBe('cohrt')
    expect(missingName([error('KeyError', "'cohort'")])).toBeNull()
    expect(missingName([text('fine')])).toBeNull()
  })
})

describe('definedNames', () => {
  const names = (code: string) => [...definedNames(code).names].sort()

  it('reads assignments, loops, with, imports, def, class and :=', () => {
    expect(names('df = pd.read_csv("a.csv")\na, (b, *c) = 1, (2, 3)\nx: int = 1\ny = z = 0')).toEqual(['a', 'b', 'c', 'df', 'x', 'y', 'z'])
    expect(names('for i, row in df.iterrows():\n    total = i')).toEqual(['i', 'row', 'total'])
    expect(names('with open("f") as fh, open("g") as gh:\n    pass\ntry:\n    pass\nexcept ValueError as err:\n    pass')).toEqual(['err', 'fh', 'gh'])
    expect(names('import numpy as np, os.path\nfrom scipy import (\n    stats,\n    optimize as opt,\n)')).toEqual(['np', 'opt', 'os', 'stats'])
    expect(names('def fit(x):\n    inner = 1\n    return x\nclass Model:\n    size = 3\nafter = 2')).toEqual(['Model', 'after', 'fit'])
    expect(names('if (n := len(df)) > 3: big = True')).toEqual(['big', 'n'])
  })

  it("doesn't read comparisons, keyword arguments, attributes or subscripts as definitions", () => {
    expect(names('print(x == 1)\nf(a=1)\ndf.col = 3\ndf["a"] = 2\ncount += 1\nfn = lambda k=1: k')).toEqual(['fn'])
  })

  it('notices a star import', () => {
    expect(definedNames('from helpers import *').star).toBe(true)
  })
})

describe('missingNameCause', () => {
  const cell = (number: number, code: string, extra: Partial<VerifiedCode> = {}): VerifiedCode => ({ number, code, failed: false, assigned: [], agentCode: [], ...extra })

  it('says when only the agent created the name, while it worked on a cell', () => {
    const cells = [cell(1, 'df = load()', { agentCode: ['cohort = df[df.age > 65]'] }), cell(2, 'cohort.describe()', { failed: true })]
    expect(missingNameCause('cohort', 1, cells)).toEqual({ kind: 'agent', cell: 1 })
  })

  it('says when nothing in the notebook creates it', () => {
    expect(missingNameCause('cohort', 1, [cell(1, 'df = load()'), cell(2, 'cohort.describe()', { failed: true })])).toEqual({ kind: 'nowhere' })
  })

  it('points to a failed cell above that creates it, and to a cell below', () => {
    const cells = [cell(1, 'cohort = df[df.age > 65]', { failed: true }), cell(2, 'cohort.describe()', { failed: true })]
    expect(missingNameCause('cohort', 1, cells)).toEqual({ kind: 'failed-above', cell: 1 })
    expect(missingNameCause('cohort', 0, [cell(1, 'cohort.describe()', { failed: true }), cell(2, 'cohort = df')])).toEqual({ kind: 'below', cell: 2 })
  })

  it("has nothing to add when a cell above that ran defines it, even one the kernel saw but the text doesn't show", () => {
    expect(missingNameCause('cohort', 1, [cell(1, 'cohort = df'), cell(2, 'del cohort\ncohort', { failed: true })])).toBeNull()
    expect(missingNameCause('cohort', 1, [cell(1, 'exec(src)', { assigned: ['cohort'] }), cell(2, 'cohort', { failed: true })])).toBeNull()
    expect(missingNameCause('cohort', 1, [cell(1, 'from helpers import *'), cell(2, 'cohort', { failed: true })])).toBeNull()
  })
})
