import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { newPromptCell } from '@dalliance/shared/notebook'
import { provenance } from '@/test/fake-api'
import { HowItWasMade } from './HowItWasMade'

const cell = newPromptCell('Average order value', 'orders.total.mean()')
const view = () => screen.getByRole('region', { name: 'How this was made' })

describe('HowItWasMade', () => {
  it('says in plain words who made the code, when, with which model and from what', () => {
    render(<HowItWasMade cell={cell} record={provenance()} />)
    expect(view()).toHaveTextContent(/^The agent wrote this code on Sep 30, 2026, .+ with Sonnet 5\.5 at medium effort, in 3 steps\./)
    expect(view()).toHaveTextContent('From the prompt “Average order value”.')
  })

  it("calls the model's summaries its stated rationale", () => {
    render(<HowItWasMade cell={cell} record={provenance()} />)
    expect(screen.getByRole('heading', { name: 'Stated rationale' })).toBeInTheDocument()
    expect(view()).toHaveTextContent("The model's own summaries of its reasoning, as it stated them.")
    expect(view()).toHaveTextContent('The column is total, not amount.')
    expect(screen.queryByRole('heading', { name: /reasoning/i })).not.toBeInTheDocument()
  })

  it('says when the rationale is the interpretation and answer instead, without the brackets', () => {
    render(<HowItWasMade cell={cell} record={provenance({ rationale: { from: 'interpretation', text: ['Order value is [[total including tax]].', 'It is 41.2.'] } })} />)
    expect(view()).toHaveTextContent('The model sent no reasoning summaries for this run, so this is its interpretation of the prompt and its answer.')
    expect(view()).toHaveTextContent('Order value is total including tax.')
    expect(view()).not.toHaveTextContent('[[')
  })

  it('lists each attempt with its error and what changed', () => {
    render(<HowItWasMade cell={cell} record={provenance()} />)
    const attempts = screen.getByRole('heading', { name: 'Attempts' }).parentElement!
    expect(attempts).toHaveTextContent('It ran the code 2 times. The first try failed or needed changes, and the last worked.')
    expect(attempts).toHaveTextContent("Attempt 1: KeyError: 'amount'")
    expect(attempts).toHaveTextContent('Final attempt: ran without errors')
    expect(attempts).toHaveTextContent('- orders.amount.mean() + orders.total.mean()')
  })

  it('says the earlier attempts are in the agent log once only the final one is saved', () => {
    const saved = provenance()
    render(<HowItWasMade cell={cell} record={{ ...saved, attempts: saved.attempts.slice(-1) }} />)
    expect(view()).toHaveTextContent('The notebook keeps only the final attempt. The earlier one is in the agent log, logs/agent.jsonl.')
    expect(view()).not.toHaveTextContent('Attempt 1:')
  })

  it('shows the files read, what was allowed and the fingerprints', () => {
    const record = provenance({
      approvals: [
        { kind: 'packages', detail: 'pip install seaborn', outcome: 'approved' },
        { kind: 'network', detail: 'import requests', outcome: 'trusted' },
        { kind: 'secret', detail: '.env', outcome: 'blocked' },
      ],
    })
    render(<HowItWasMade cell={cell} record={record} />)
    const files = within(screen.getByRole('heading', { name: 'Files read' }).parentElement!).getAllByRole('listitem')
    expect(files.map((f) => f.textContent)).toEqual(['orders.csv · by the code', 'README.md · looked at by the agent'])
    const allowed = within(screen.getByRole('heading', { name: 'Allowed and refused' }).parentElement!).getAllByRole('listitem')
    expect(allowed.map((a) => a.textContent)).toEqual([
      'You allowed an install: pip install seaborn',
      'Allowed without asking network use: import requests',
      'Blocked, since it may hold secrets, a secret file: .env',
    ])
    expect(view()).toHaveTextContent(`code sha256:${'c'.repeat(64)}`)
  })

  it('names each model when a fallback switched it mid-run', () => {
    const steps = [
      { step: 1, model: 'anthropic/claude-sonnet-5.5', fallback: false },
      { step: 2, model: 'anthropic/claude-sonnet-5.5', fallback: false },
      { step: 3, model: 'anthropic/claude-opus-5', fallback: true },
    ]
    render(<HowItWasMade cell={cell} record={provenance({ steps })} />)
    expect(view()).toHaveTextContent('at medium effort, in 3 steps: steps 1 to 2 on Sonnet 5.5, then step 3 on Opus 5 after the chosen model declined.')
  })

  it('keeps the code one click away, and says when the cell has changed it since', async () => {
    const user = userEvent.setup()
    render(<HowItWasMade cell={{ ...cell, code: 'orders.total.median()', codeEdited: true }} record={provenance()} />)
    expect(view()).toHaveTextContent("The cell's code has changed since: this is the code the agent wrote.")
    expect(screen.queryByLabelText('Code the agent wrote')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show the code' }))
    expect(screen.getByLabelText('Code the agent wrote')).toHaveTextContent('orders.total.mean()')
    expect(screen.getByRole('button', { name: 'Hide the code' })).toHaveAttribute('aria-expanded', 'true')
  })
})
