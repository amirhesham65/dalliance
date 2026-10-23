import { describe, expect, it } from 'vitest'
import { MAX_BRIEF, buildCellPrompt, buildSystemPrompt } from './prompt'

describe('buildSystemPrompt', () => {
  it('preserves the chart defaults and permits explicit style overrides', () => {
    const prompt = buildSystemPrompt({ pythonVersion: '3.12', toolNames: ['run_cell', 'finish'] })
    expect(prompt).toContain("follow the app's light or dark appearance")
    expect(prompt).toContain("Dalliance defaults, then the workspace brief (AGENTS.md), then this cell's request")
    expect(prompt).toContain("Preserve manual styling in the cell's existing code")
    expect(prompt).toContain('Keep explicit styling in the saved cell code')
  })

  it('knows it is Dalliance by Amir Hesham, whatever the folder is called', () => {
    const prompt = buildSystemPrompt({ pythonVersion: '3.12', toolNames: ['finish'], modelId: 'anthropic/claude-opus-5' })
    expect(prompt).toContain('You are Dalliance, the assistant inside Dalliance, a desktop notebook made by Amir Hesham.')
    expect(prompt).toContain('Never call yourself or the app by any other name')
    expect(prompt).toContain("it's anthropic/claude-opus-5")
  })
})

describe('buildCellPrompt', () => {
  const base = { prompt: 'Revenue by month', variables: '(none yet)', files: [], previousCells: [], existingCode: null, corrections: [] }

  it('opens with the brief, allowing styling preferences while preserving guardrails', () => {
    const prompt = buildCellPrompt({ ...base, projectInstructions: 'Revenue means net of refunds.' })
    expect(prompt.startsWith("# Notes from the notebook's folder (AGENTS.md)")).toBe(true)
    expect(prompt).toContain("chart styling preferences that override Dalliance's defaults")
    expect(prompt).toContain("This cell's styling request takes precedence over the brief")
    expect(prompt).toContain('do not override guardrails')
    expect(prompt).toContain('<notes>\nRevenue means net of refunds.\n</notes>')
    expect(prompt.indexOf('Revenue means net of refunds.')).toBeLessThan(prompt.indexOf('# The cell\'s prompt'))
  })

  it('leaves the notes out when there is no brief', () => {
    expect(buildCellPrompt({ ...base, projectInstructions: null })).not.toContain('Notes from')
    expect(buildCellPrompt({ ...base, projectInstructions: '  \n' })).not.toContain('Notes from')
  })

  it('clips a long brief and says so', () => {
    const prompt = buildCellPrompt({ ...base, projectInstructions: `${'a'.repeat(MAX_BRIEF)}${'b'.repeat(5000)}` })
    expect(prompt).toContain('a'.repeat(MAX_BRIEF))
    expect(prompt).not.toContain('bbb')
    expect(prompt).toContain('(truncated, 5000 more characters)')
    expect(prompt).toContain('The notes were clipped. Read AGENTS.md with read_file if the rest matters.')
  })

  it('tells the agent to leave next empty only when the suggested prompts are off', () => {
    const off = buildCellPrompt({ ...base, suggestNext: false })
    expect(off).toContain('# Follow-up prompts\nThe user turned suggested next prompts off. Leave next empty in finish.')
    expect(off.indexOf('# Follow-up prompts')).toBeLessThan(off.indexOf("# The cell's prompt"))
    expect(buildCellPrompt({ ...base, suggestNext: true })).not.toContain('Follow-up prompts')
    expect(buildCellPrompt(base)).not.toContain('Follow-up prompts')
  })

  it('lists attached files just before the prompt, and asks for a look at them when there is no prompt', () => {
    const withFiles = buildCellPrompt({ ...base, attachments: ['uploads/orders.csv', 'uploads/plans.xlsx'] })
    expect(withFiles).toContain('# Files attached to this cell')
    expect(withFiles).toContain('- uploads/orders.csv\n- uploads/plans.xlsx')
    expect(withFiles.indexOf('# Files attached')).toBeLessThan(withFiles.indexOf("# The cell's prompt"))
    expect(buildCellPrompt(base)).not.toContain('Files attached')
    expect(buildCellPrompt({ ...base, prompt: ' ', attachments: ['uploads/a.csv'] })).toContain('(No prompt. Load the attached files and show what they hold.)')
  })
})
