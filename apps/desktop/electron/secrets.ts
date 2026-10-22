/** Values known to the main process, for removing accidental echoes from errors and logs. */
const secrets = new Set<string>()

export function rememberSecret(value: string) {
  if (value) secrets.add(value)
}

export function redactSecrets(text: string): string {
  for (const secret of secrets) text = text.split(secret).join('[redacted]')
  return text
}

/** Provider credentials inherited from a shell never belong in a Python child process. */
export function pythonEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|GEMINI_API_KEY)$/.test(name)))
}
