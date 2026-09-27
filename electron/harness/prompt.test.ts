import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from './prompt'

describe('buildSystemPrompt', () => {
  it('knows it is Ilios by Amir Hesham, whatever the folder is called', () => {
    const prompt = buildSystemPrompt({ pythonVersion: '3.12', toolNames: ['finish'], projectInstructions: null, modelId: 'anthropic/claude-opus-5' })
    expect(prompt).toContain('You are Ilios, the assistant inside Ilios, a desktop notebook made by Amir Hesham.')
    expect(prompt).toContain('Never call yourself or the app by any other name')
    expect(prompt).toContain("it's anthropic/claude-opus-5")
  })
})
