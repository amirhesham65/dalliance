import { type LanguageModel, generateText } from 'ai'
import { type ModelCall, stepUsage } from './cost'
import { type ModelConfig, resolveModel } from './model'

const INSTRUCTIONS = `You name cells in a data notebook. Given a cell's prompt, reply with a title of 2 to 5 words that says what the cell computes or shows.
- Sentence case, like "Monthly revenue by plan" or "Return rate by category".
- Keep the key nouns from the prompt. Drop filler like "show me", "please", "can you".
- @name refers to a variable. Keep the name without the @.
- Reply with the title only: no quotes, no trailing period, no explanation.`

type ProviderOptions = Parameters<typeof generateText>[0]['providerOptions']

export interface TitleModel {
  model: LanguageModel
  providerOptions?: ProviderOptions
}

/** No title request without the selected provider's key. */
export function titleModel(config: ModelConfig): TitleModel | null {
  try {
    const resolved = resolveModel({ ...config, effort: 'low' })
    return resolved
  } catch {
    return null
  }
}

/** Tidy what the model sent back: first line, no quotes, prefix or trailing punctuation, at most 6 words. */
export function cleanTitle(raw: string): string | null {
  const line = raw.trim().split('\n')[0] ?? ''
  const title = line
    .replace(/^(title|name)\s*:\s*/i, '')
    .replace(/^["'“‘`*]+|["'”’`*]+$/g, '')
    .replace(/[.:;,!]+$/, '')
    .replace(/@(?=[a-z_])/gi, '')
    .trim()
  if (!title) return null
  return title.split(/\s+/).slice(0, 6).join(' ')
}

/**
 * A short title for the outline. Null without a key, the model fails or it takes too long. `onCall` gets the
 * call's tokens once it answers, for Show token usage.
 */
export async function generateTitle(
  prompt: string,
  { model, providerOptions }: TitleModel,
  signal?: AbortSignal,
  onCall?: (call: ModelCall) => void,
): Promise<string | null> {
  try {
    const { text, usage } = await generateText({
      model,
      providerOptions,
      instructions: INSTRUCTIONS,
      prompt: prompt.slice(0, 2000),
      // Reasoning counts toward output, so leave room beyond the handful of words a title needs
      maxOutputTokens: 1024,
      maxRetries: 1,
      timeout: 10_000,
      abortSignal: signal,
    })
    onCall?.({ model: typeof model === 'string' ? model : model.modelId, usage: stepUsage(usage) })
    return cleanTitle(text)
  } catch {
    return null
  }
}
