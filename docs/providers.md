# Providers and API keys

Dalliance calls Anthropic, Google, or OpenAI directly from Electron's main process. Users supply their own API key and pay their provider for usage. Notebooks, Python, drafts, and settings remain local.

## Setup

Settings > Models and the Provider step of onboarding show separate Anthropic, Google, and OpenAI connections. Users can save keys for all three at once. Saving, replacing, or removing one key leaves the other connections and the selected model unchanged. The field clears after saving; saved keys are never displayed.

There is no active provider setting. The model pickers in Settings, onboarding, and the top bar show the union of models from providers with saved keys. Choosing a model determines which provider receives generation requests. Onboarding is ready once the chosen model's provider has a key.

The local catalog in `packages/shared/src/models.ts` contains models with tools, image input, and streaming. Settings also accepts a custom ID such as `openai/my-model`. A custom model must support tools and image input. Missing catalog entries never reset the user's selection. Provider access and availability are checked by the provider when a request runs.

## Key storage

`electron/provider-keys.ts` stores encrypted values in `provider-keys.json` under userData, with mode `0600` and atomic writes. Electron `safeStorage` handles OS-backed encryption. Linux's `basic_text` backend is rejected. If secure storage is unavailable, keys remain in memory until quit; the UI says so. There is no plaintext fallback.

The preload exposes `getProviderKeys()` and `setProviderKey(provider, key)`. The former returns configured flags, whether storage persists, and a generic storage error. It never returns a saved key. Empty input removes the key. Input is validated in the main process. Encryption and filesystem errors do not echo key values.

`SettingsStore` receives a key resolver, never a serialized key. Saved settings contain only model IDs and preferences. `secrets.ts` redacts known key values from provider errors and the run log. Provider API key environment variables are removed from the kernel's child environment. The app does not export saved keys into environment variables.

## Routing

`harness/model.ts` creates `@ai-sdk/anthropic`, `@ai-sdk/google`, or `@ai-sdk/openai` with an explicit key. OpenAI uses Responses. `ModelConfig` is `{ model, effort, key }`. Model IDs inside the app include the provider, such as `anthropic/claude-sonnet-5-5`; adapters receive the native portion. Anthropic numeric version dots normalize to dashes.

A missing key fails generation with a message pointing to Settings > Models. Plain saved-code runs and Verify do not resolve a model or request a title. Titles for generated cells use the selected model with low effort and the same provider key. They are optional and best effort. There is no provider fallback.

Anthropic models receive caching and sequential tool-use options, plus thinking and effort only where supported. Recognized OpenAI reasoning families receive effort and reasoning summaries. Google and other custom models use provider defaults when there is no applicable option.

## Data and usage

Generation sends the prompt and the context the agent reads, including earlier cells, file previews, variable descriptions, outputs, and chart images. Retention and training policies depend on the provider and the user's account. API keys go only to that provider's API from the main process. The app sends no telemetry.

The Activity pane can show provider-reported token usage for each run and the notebook's total, including title requests. Input totals include cached tokens and output totals include reasoning, so those counts are not added twice. This is usage, not a price estimate. Actual charges come from the provider.

## Verification

Normal tests mock requests and need no keys. `provider-keys.test.ts` checks persistence, deletion, session-only behavior, errors, permissions, and redaction. `model.test.ts` checks all three direct endpoints and key headers with intercepted requests.

Live checks are opt-in and bill the selected provider. Set its standard API key variable in a local `apps/desktop/.env` and select a provider/model:

```bash
DALLIANCE_E2E=1 DALLIANCE_E2E_MODEL=google/gemini-3.8-flash pnpm --filter @dalliance/desktop exec vitest run electron/e2e.test.ts
```

Use `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, or `OPENAI_API_KEY`. Never put a key value in a command or commit it. The desktop app itself uses keys entered in Settings, not this test file.
