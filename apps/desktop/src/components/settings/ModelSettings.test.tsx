import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeApi, fakeSettings, result } from '@/test/fake-api'
import { ModelSettings } from './ModelSettings'

describe('ModelSettings', () => {
  it('runs on the Dalliance account, with no provider or key to choose', () => {
    render(<ModelSettings api={fakeApi(() => result()).api} settings={fakeSettings()} />)
    expect(screen.getByText('Every model call runs with zero data retention.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/provider/i)).toBeNull()
    expect(screen.queryByText(/key/i)).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('anthropic/claude-sonnet-5.5')
  })
})
