/**
 * The Kalos model registry. Anthropic-only — Kalos drives Claude Code, which is
 * Anthropic's CLI. Adding a non-Anthropic model here would be a category error.
 *
 * Each entry's `id` is the stable identifier we persist (in `tasks.model_id`,
 * `settings.default_model_id`, `repo_settings.model_id`) and surface in the
 * REST API / TUI. The `slug` is what we pass to `claude --model`.
 */

export type Model = {
  /** Stable kalos identifier — what we store and what the API/TUI references. */
  id: string
  /** Human-friendly label shown in UI. */
  label: string
  /** What to pass to `claude --model`. */
  slug: string
  /** Generation tier — newest models in each tier are preferred for new tasks. */
  tier: 'opus' | 'sonnet' | 'haiku'
  /** False when superseded by a newer model in the same tier. Older gen still
   *  selectable so users can pin. */
  current: boolean
}

export const MODELS: readonly Model[] = [
  {
    id: 'opus-4.7',
    label: 'Claude Opus 4.7',
    slug: 'claude-opus-4-7',
    tier: 'opus',
    current: true,
  },
  {
    id: 'sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    slug: 'claude-sonnet-4-6',
    tier: 'sonnet',
    current: true,
  },
  {
    id: 'haiku-4.5',
    label: 'Claude Haiku 4.5',
    slug: 'claude-haiku-4-5',
    tier: 'haiku',
    current: true,
  },
  {
    id: 'opus-4.6',
    label: 'Claude Opus 4.6',
    slug: 'claude-opus-4-6',
    tier: 'opus',
    current: false,
  },
  {
    id: 'sonnet-4.5',
    label: 'Claude Sonnet 4.5',
    slug: 'claude-sonnet-4-5',
    tier: 'sonnet',
    current: false,
  },
  {
    id: 'haiku-4',
    label: 'Claude Haiku 4',
    slug: 'claude-haiku-4',
    tier: 'haiku',
    current: false,
  },
] as const

/** The model the wizard should propose if the user hasn't picked one. */
export const FALLBACK_MODEL_ID = 'sonnet-4.6'

export function getModel(id: string): Model | undefined {
  return MODELS.find((m) => m.id === id)
}

/** Resolve a kalos model id to the slug `claude --model` expects. Throws on
 *  unknown id so callers don't silently dispatch with a bogus model. */
export function resolveModelSlug(id: string): string {
  const m = getModel(id)
  if (!m) throw new Error(`Unknown model id: ${id}`)
  return m.slug
}
