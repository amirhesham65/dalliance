import { describe, expect, it } from 'vitest'
import { makerLogo, makerOfModel } from './makers'

describe('maker logos', () => {
  it('finds each supported provider logo', () => {
    for (const provider of ['Anthropic', 'Google', 'OpenAI']) expect(makerLogo(provider)).toBeTruthy()
  })

  it('has none for makers without one', () => {
    expect(makerLogo('Thinking Machines')).toBeNull()
  })

  it('reads the maker from the model id', () => {
    expect(makerOfModel('openai/gpt-6')).toBe('openai')
    expect(makerOfModel('anthropic/claude-opus-5')).toBe('anthropic')
  })
})
