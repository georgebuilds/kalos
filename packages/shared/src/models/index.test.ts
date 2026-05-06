import { describe, expect, test } from 'vitest'
import { MODELS, FALLBACK_MODEL_ID, getModel, resolveModelSlug } from './index.js'

describe('model registry shape', () => {
  test('exposes 6 models', () => {
    expect(MODELS).toHaveLength(6)
  })

  test('every entry has id, label, slug, tier, current', () => {
    for (const m of MODELS) {
      expect(typeof m.id).toBe('string')
      expect(m.id.length).toBeGreaterThan(0)
      expect(typeof m.label).toBe('string')
      expect(m.label.length).toBeGreaterThan(0)
      expect(typeof m.slug).toBe('string')
      expect(m.slug.startsWith('claude-')).toBe(true)
      expect(['opus', 'sonnet', 'haiku']).toContain(m.tier)
      expect(typeof m.current).toBe('boolean')
    }
  })

  test('ids are unique', () => {
    const ids = new Set(MODELS.map((m) => m.id))
    expect(ids.size).toBe(MODELS.length)
  })

  test('slugs are unique', () => {
    const slugs = new Set(MODELS.map((m) => m.slug))
    expect(slugs.size).toBe(MODELS.length)
  })

  test('every tier has at least one current model', () => {
    for (const tier of ['opus', 'sonnet', 'haiku'] as const) {
      const inTier = MODELS.filter((m) => m.tier === tier)
      expect(inTier.length).toBeGreaterThan(0)
      expect(inTier.some((m) => m.current)).toBe(true)
    }
  })
})

describe('FALLBACK_MODEL_ID', () => {
  test('resolves to a real registry entry', () => {
    expect(getModel(FALLBACK_MODEL_ID)).toBeDefined()
  })
})

describe('getModel', () => {
  test('returns the entry by id', () => {
    const m = getModel('opus-4.7')
    expect(m?.label).toBe('Claude Opus 4.7')
    expect(m?.slug).toBe('claude-opus-4-7')
  })

  test('returns undefined for unknown id', () => {
    expect(getModel('bogus-9000')).toBeUndefined()
  })
})

describe('resolveModelSlug', () => {
  test('returns the claude --model slug for a known id', () => {
    expect(resolveModelSlug('sonnet-4.6')).toBe('claude-sonnet-4.6'.replace('.', '-'))
  })

  test('throws on unknown id', () => {
    expect(() => resolveModelSlug('does-not-exist')).toThrow(/Unknown model id/)
  })
})
