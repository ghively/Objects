import { describe, expect, test } from 'vitest'
import { documentLang, normalizeLanguageTag } from './spellcheck'

describe('normalizeLanguageTag', () => {
  test('test tags normalise to BCP 47 case', () => {
    expect(normalizeLanguageTag('fr')).toBe('fr')
    expect(normalizeLanguageTag('de-ch')).toBe('de-CH')
    expect(normalizeLanguageTag(' en_GB ')).toBe('en-GB')
    expect(normalizeLanguageTag('es-419')).toBe('es-419')
    expect(normalizeLanguageTag('de-ch-1996')).toBe('de-CH-1996')
  })

  test('test non-tags are refused', () => {
    for (const bad of ['', 'english', 'e', 'en-', 'de CH', 'en--GB', 'en-GB-toolongsubtag', 'a'.repeat(36), null, undefined]) {
      expect(normalizeLanguageTag(bad), String(bad)).toBeUndefined()
    }
  })

  test('sweep 2026-11-08: a stored tag the strict shape does not know is kept as it is', () => {
    // The older code accepted these (language, region, then any subtags); a saved setting must not
    // fall back to English because the shape got stricter.
    expect(normalizeLanguageTag('en-GB-x-test')).toBe('en-GB-x-test')
    expect(normalizeLanguageTag(' en_GB-x-test ')).toBe('en-GB-x-test')
    expect(normalizeLanguageTag('zh-Hant-TW')).toBe('zh-Hant-TW')
    expect(normalizeLanguageTag('en-Latn')).toBe('en-Latn')
    expect(documentLang('en-GB-x-test')).toBe('en-GB-x-test')
  })

  test('test document lang falls back to English', () => {
    expect(documentLang(null)).toBe('en')
    expect(documentLang('nonsense')).toBe('en')
    expect(documentLang('de_de')).toBe('de-DE')
  })
})
