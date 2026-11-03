/**
 * "Spellcheck language": a BCP 47 tag ("fr", "de-CH"). Normalised the way Object's
 * `normalizeLanguageTag` does (underscores to dashes, language lower case, region upper case);
 * `undefined` for anything else. On the web Object hands the tag to the browser
 * (`webSpellCheckLang`); Object puts it on `<html lang>`, which the browser's spellchecker follows.
 */
export function normalizeLanguageTag(code: string | null | undefined): string | undefined {
  if (!code) return undefined
  const trimmed = code.trim().replace(/_/g, '-')
  if (!trimmed || trimmed.length > 35) return undefined
  const parts = trimmed.split('-')
  if (parts.some((p) => p.length === 0)) return undefined
  const language = parts[0].toLowerCase()
  if (!/^[a-z]{2,3}$/.test(language)) return undefined
  if (parts.length === 1) return language
  const region = parts[1]
  const rest = parts.slice(2)
  if (!rest.every((p) => /^[a-z0-9]{1,8}$/i.test(p))) return undefined
  if (/^[a-z]{2}$/i.test(region)) return [language, region.toUpperCase(), ...rest].join('-')
  if (/^\d{3}$/.test(region) && rest.length === 0) return `${language}-${region}`
  return undefined
}

/** The `<html lang>` for a setting: its tag, else Object's interface language. */
export function documentLang(spellCheckLang: string | null | undefined): string {
  return normalizeLanguageTag(spellCheckLang) ?? 'en'
}
