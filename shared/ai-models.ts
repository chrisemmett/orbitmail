/**
 * Which Claude model the AI features use, and how hard it may think.
 *
 * The list is curated rather than fetched from the API. Every entry has to
 * support two things the AI features depend on: **structured outputs** (each
 * feature calls `messages.parse` with a JSON schema) and the **effort**
 * parameter. Claude Haiku 4.5 supports the first but not the second — passing
 * `output_config.effort` to it is a 400 — so it is deliberately absent rather
 * than handled with a per-model conditional around every request.
 *
 * Shared because both sides need it: the settings pane renders the options, and
 * the main process validates what comes back out of the preferences blob before
 * it reaches the API.
 */

export type AiEffort = 'low' | 'medium' | 'high'

export interface AiModelOption {
  id: string
  label: string
  hint: string
}

export const DEFAULT_AI_MODEL = 'claude-opus-5'
export const DEFAULT_AI_EFFORT: AiEffort = 'low'

export const AI_MODELS: readonly AiModelOption[] = [
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    hint: 'The default. Best results on the kind of reading these features do.'
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    hint: 'Faster and cheaper per message, and close behind on this work.'
  },
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    hint: 'The previous default, kept so an upgrade can be undone.'
  }
]

export const AI_EFFORTS: readonly { value: AiEffort; label: string; hint: string }[] = [
  { value: 'low', label: 'Low', hint: 'The default. Fastest, and the cheapest per message.' },
  { value: 'medium', label: 'Medium', hint: 'Thinks longer before answering.' },
  { value: 'high', label: 'High', hint: 'Most thorough, and the most tokens.' }
]

/**
 * Both resolvers fall back rather than trust what they are given. The values
 * arrive from a JSON blob on disk that a previous version — or a hand edit —
 * may have written, and an unrecognised model string sent to the API is a 404
 * every AI feature would then report as a failure.
 */
export function resolveAiModel(value: string | undefined): string {
  return AI_MODELS.some((m) => m.id === value) ? (value as string) : DEFAULT_AI_MODEL
}

export function resolveAiEffort(value: string | undefined): AiEffort {
  return AI_EFFORTS.some((e) => e.value === value) ? (value as AiEffort) : DEFAULT_AI_EFFORT
}
