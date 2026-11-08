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
    for (const bad of ['', 'english', 'e', 'en-', 'de CH', 'en-Latn', 'en-GB-x-test', 'zh-Hant-TW', null, undefined]) {
      expect(normalizeLanguageTag(bad), String(bad)).toBeUndefined()
    }
  })

  test('test document lang falls back to English', () => {
    expect(documentLang(null)).toBe('en')
    expect(documentLang('nonsense')).toBe('en')
    expect(documentLang('de_de')).toBe('de-DE')
  })
})
