import { describe, expect, it } from 'vitest'
import { makerLogo, makerOfModel } from './makers'

describe('maker logos', () => {
  it('finds a logo from the label or the gateway prefix', () => {
    expect(makerLogo('Anthropic')).toBeTruthy()
    expect(makerLogo('Moonshot AI')).toBe(makerLogo('moonshotai'))
    expect(makerLogo('Z.ai')).toBeTruthy()
    // Grok models sit under SpaceX's prefix on the gateway
    expect(makerLogo('spacexai')).toBe(makerLogo('xAI'))
    expect(makerLogo('arcee-ai')).toBe(makerLogo('Arcee'))
  })

  it('has none for makers without one', () => {
    expect(makerLogo('Thinking Machines')).toBeNull()
  })

  it('reads the maker from the model id', () => {
    expect(makerOfModel('openai/gpt-6')).toBe('openai')
    expect(makerOfModel('anthropic/claude-opus-5')).toBe('anthropic')
  })
})
