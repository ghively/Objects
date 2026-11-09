/**
 * The "Spellcheck language" setting. Object writes it to `<html lang>`, and the browser's
 * spellchecker follows that attribute, so the setting only has to be a tag the browser
 * understands: a language, optionally a region, optionally variants ("fr", "de-CH",
 * "es-419", "de-CH-1996"). A stored tag of another plausible shape (a script subtag, a
 * private-use part such as "en-GB-x-test") is kept as it is rather than dropped.
 */

/**
 * Language (2-3 letters), then an optional region (2 letters or 3 digits) and its variants
 * (5-8 letters or digits, or a digit and three more, as BCP 47 spells them).
 */
const SHAPE = /^[a-z]{2,3}(?:-(?:[a-z]{2}|\d{3})(?:-(?:[a-z\d]{5,8}|\d[a-z\d]{3}))*)?$/i

/**
 * Any other tag BCP 47 could spell: a language, then subtags of 1-8 letters or digits joined
 * by single hyphens. A bare word that is not a language ("english") is not one.
 */
const PLAUSIBLE = /^[a-z]{2,3}(?:-[a-z\d]{1,8})+$/i

/** Long enough for any tag this setting accepts; anything longer is not a language tag. */
const MAX_LENGTH = 35

/**
 * The setting's tag in its canonical spelling (`de_ch` and `DE-ch` become `de-CH`), or
 * `undefined` when the text isn't such a tag. Casing and aliases come from the platform's
 * own BCP 47 canonicalisation (`Intl.getCanonicalLocales`). A tag outside `SHAPE` that is
 * still plausible passes through unchanged, so a setting saved by an earlier Object is kept.
 */
export function normalizeLanguageTag(code: string | null | undefined): string | undefined {
  const candidate = (code ?? '').trim().replaceAll('_', '-')
  if (candidate.length === 0 || candidate.length > MAX_LENGTH) return undefined
  if (!SHAPE.test(candidate)) return PLAUSIBLE.test(candidate) ? candidate : undefined
  try {
    return Intl.getCanonicalLocales(candidate)[0]
  } catch {
    return undefined
  }
}

/** The `<html lang>` for a setting: its tag, else English (Object's interface language). */
export function documentLang(spellCheckLang: string | null | undefined): string {
  return normalizeLanguageTag(spellCheckLang) ?? 'en'
}
