import { describe, expect, it } from 'vitest'
import { newNoteCell, newPromptCell } from '@dalliance/shared/notebook'
import { answerBlocks, answerHtml, answerMarkdown, cellTitle, formatDuration, highlightPython, parseMarkdown, splitRefs, stripAnsi } from './text'

describe('splitRefs', () => {
  it('separates @references from prose', () => {
    expect(splitRefs('Why did @churn_by_plan spike?')).toEqual([
      { type: 'text', value: 'Why did ' },
      { type: 'ref', value: '@churn_by_plan' },
      { type: 'text', value: ' spike?' },
    ])
  })
})

describe('parseMarkdown', () => {
  it('reads headings and joins paragraph lines', () => {
    expect(parseMarkdown('# Title\nfirst line\nsecond line\n\n## Next')).toEqual([
      { type: 'h1', text: 'Title' },
      { type: 'p', text: 'first line second line' },
      { type: 'h2', text: 'Next' },
    ])
  })
})

describe('highlightPython', () => {
  it('tags keywords, strings, numbers, calls and comments without losing text', () => {
    const source = "import pd\nx = f('a', 14)  # note"
    const tokens = highlightPython(source)
    expect(tokens.filter((t) => t.type !== 'plain').map((t) => [t.type, t.value])).toEqual([
      ['k', 'import'],
      ['f', 'f'],
      ['s', "'a'"],
      ['n', '14'],
      ['c', '# note'],
    ])
    expect(tokens.map((t) => t.value).join('')).toBe(source)
  })
})

describe('cellTitle, formatDuration and stripAnsi', () => {
  it('uses the note heading and truncates long prompts', () => {
    expect(cellTitle(newNoteCell('# Churn review\nbody'))).toBe('Churn review')
    expect(cellTitle(newPromptCell('Load subscriptions.csv and the events table'), 19)).toBe('Load subscriptions…')
    expect(cellTitle(newPromptCell(''))).toBe('Empty prompt')
  })

  it('formats durations', () => {
    expect(formatDuration(900)).toBe('900ms')
    expect(formatDuration(1800)).toBe('1.8s')
    expect(formatDuration(95_000)).toBe('1m 35s')
  })

  it('removes terminal colour codes', () => {
    expect(stripAnsi('\u001b[0;31mKeyError\u001b[0m')).toBe('KeyError')
  })
})

describe('parseMarkdown in notes', () => {
  it('reads a note with a list the way it was written', () => {
    const note = [
      '# Titanic Passenger Survival Prediction',
      'The classic binary classification problem.',
      '',
      'You can load the data using `seaborn` and follow a workflow:',
      '- **Feature engineering**: family size (`SibSp` + `Parch`)',
      '- **Preprocessing**: impute missing values',
      '  grouped by class and gender.',
      '',
      '- **Evaluation**: accuracy and ROC-AUC.',
    ].join('\n')
    expect(parseMarkdown(note)).toEqual([
      { type: 'h1', text: 'Titanic Passenger Survival Prediction' },
      { type: 'p', text: 'The classic binary classification problem.' },
      { type: 'p', text: 'You can load the data using `seaborn` and follow a workflow:' },
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: ['**Feature engineering**: family size (`SibSp` + `Parch`)', '**Preprocessing**: impute missing values grouped by class and gender.', '**Evaluation**: accuracy and ROC-AUC.'],
      },
    ])
  })

  it('reads numbered lists, quotes, code, rules and deeper headings', () => {
    expect(parseMarkdown('### Steps\n3. load\n4. clean\n\n> Keep it small.\n> Really.\n\n---\n```python\ndf.head()\n```')).toEqual([
      { type: 'h3', text: 'Steps' },
      { type: 'list', ordered: true, start: 3, items: ['load', 'clean'] },
      { type: 'quote', text: 'Keep it small. Really.' },
      { type: 'rule' },
      { type: 'code', lang: 'python', text: 'df.head()' },
    ])
  })
})

describe('answerBlocks', () => {
  it('keeps paragraphs, bullets and numbered lists apart', () => {
    expect(answerBlocks('Two options.\n- first\n- second\n\n1. load\n2. clean\nThen model it.')).toEqual([
      { type: 'p', text: 'Two options.' },
      { type: 'list', ordered: false, items: ['first', 'second'] },
      { type: 'list', ordered: true, items: ['load', 'clean'] },
      { type: 'p', text: 'Then model it.' },
    ])
  })

  it('turns a list run into a sentence back into a list', () => {
    const text =
      'Try the Titanic dataset. A good path: 1) explore survival by class and sex (pandas + matplotlib), 2) clean missing values (age, embarked), 3) build a simple classifier, 4) check accuracy and which features matter most. It is beginner-friendly.'
    expect(answerBlocks(text)).toEqual([
      { type: 'p', text: 'Try the Titanic dataset. A good path:' },
      {
        type: 'list',
        ordered: true,
        items: ['Explore survival by class and sex (pandas + matplotlib)', 'Clean missing values (age, embarked)', 'Build a simple classifier', 'Check accuracy and which features matter most.'],
      },
      { type: 'p', text: 'It is beginner-friendly.' },
    ])
  })

  it('needs three markers counting from one', () => {
    const text = 'Use model 2) or 3) if the first fails.'
    expect(answerBlocks(text)).toEqual([{ type: 'p', text }])
  })
})

describe('copying an answer', () => {
  const text = 'Use `df.dropna()` on **41** rows <before> fitting. Steps: 1) load it, 2) clean it, 3) fit a model.'

  it('keeps bold, code and lists as HTML, escaping the rest', () => {
    expect(answerHtml(text)).toBe(
      '<p>Use <code>df.dropna()</code> on <strong>41</strong> rows &lt;before&gt; fitting. Steps:</p>\n<ol><li>Load it</li><li>Clean it</li><li>Fit a model.</li></ol>',
    )
  })

  it('writes Markdown with real list lines', () => {
    expect(answerMarkdown(text)).toBe('Use `df.dropna()` on **41** rows <before> fitting. Steps:\n\n1. Load it\n2. Clean it\n3. Fit a model.')
  })
})
