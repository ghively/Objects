export function normalizeLanguageTag(code: string | undefined): string | undefined {
  if (!code) return undefined
  const trimmed = code.trim().replace(/_/g, '-')
  if (!trimmed) return undefined

  const parts = trimmed.split('-').filter((part) => part.length > 0)
  if (!parts.length) return undefined

  const language = parts[0].toLowerCase()
  if (!/^[a-z]{2,3}$/.test(language)) return undefined
  if (parts.length === 1) return language

  const region = parts[1]
  if (/^[a-z]{2}$/i.test(region)) {
    return [language, region.toUpperCase(), ...parts.slice(2)].join('-')
  }
  if (/^\d{3}$/.test(region) && parts.length === 2) return `${language}-${region}`
  return undefined
}

function codesByLower(available: readonly string[]) {
  const byLower = new Map<string, string>()
  for (const code of available) byLower.set(code.toLowerCase(), code)
  return byLower
}

function pickLanguageDictionary(
  language: string,
  byLower: Map<string, string>,
  preferredLocales: readonly string[]
): string | undefined {
  const primary = byLower.get(language)
  if (primary) return primary

  for (const locale of preferredLocales) {
    const normalized = normalizeLanguageTag(locale)
    if (!normalized || normalized.toLowerCase().split('-')[0] !== language) continue
    const preferred = byLower.get(normalized.toLowerCase())
    if (preferred) return preferred
  }

  const languageRegion = byLower.get(`${language}-${language.toUpperCase()}`)
  if (languageRegion) return languageRegion

  if (language === 'en') {
    const us = byLower.get('en-us')
    if (us) return us
  }

  for (const [key, code] of byLower) {
    if (key.startsWith(`${language}-`)) return code
  }
  return undefined
}

function matchLanguage(
  requested: string,
  available: readonly string[],
  preferredLocales: readonly string[]
): string | undefined {
  const normalized = normalizeLanguageTag(requested)
  if (!normalized) return undefined

  const byLower = codesByLower(available)
  const exact = byLower.get(normalized.toLowerCase())
  if (exact) return exact

  const language = normalized.toLowerCase().split('-')[0]
  if (normalized.includes('-')) {
    const primary = byLower.get(language)
    if (primary) return primary
  }
  return pickLanguageDictionary(language, byLower, preferredLocales)
}

export function spellCheckerLanguageToEnable(
  requested: string | undefined,
  available: readonly string[],
  preferredLocales: readonly string[]
): string | undefined {
  const trimmed = requested?.trim()
  if (trimmed) return matchLanguage(trimmed, available, preferredLocales)

  for (const locale of preferredLocales) {
    const match = matchLanguage(locale, available, preferredLocales)
    if (match) return match
  }
  return undefined
}

export function webSpellCheckLang(
  requested: string | undefined,
  preferredLocales: readonly string[]
): string | undefined {
  if (requested?.trim()) return normalizeLanguageTag(requested)
  for (const locale of preferredLocales) {
    const normalized = normalizeLanguageTag(locale)
    if (normalized) return normalized
  }
  return undefined
}
