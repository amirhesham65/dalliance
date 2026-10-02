import { type LanguageModel, generateText } from 'ai'
import { type ModelCall, generationIdOf, stepUsage } from './cost'
import { type ModelConfig, cloudGateway } from './model'

/** The small, cheap model that names cells, whatever model writes the code, on the user's plan. */
export const TITLE_MODEL = 'openai/gpt-6-luna'

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

/** Null when signed out. */
export function titleModel(config: ModelConfig): TitleModel | null {
  if (!config.cloud.signedIn()) return null
  // Luna reasons before it answers; low effort keeps a title to a second or so
  return { model: cloudGateway(config.cloud)(TITLE_MODEL), providerOptions: { openai: { reasoningEffort: 'low' } } }
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
 * A short title for the outline. Null when signed out, the model fails or it takes too long. `onCall` gets the
 * call's tokens once it answers, for Show costs.
 */
export async function generateTitle(
  prompt: string,
  { model, providerOptions }: TitleModel,
  signal?: AbortSignal,
  onCall?: (call: ModelCall) => void,
): Promise<string | null> {
  try {
    const { text, usage, providerMetadata } = await generateText({
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
    onCall?.({ model: typeof model === 'string' ? model : model.modelId, usage: stepUsage(usage), generationId: generationIdOf(providerMetadata) })
    return cleanTitle(text)
  } catch {
    return null
  }
}
