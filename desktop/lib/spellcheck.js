'use strict'
// The device setting "Spellcheck language" in the shell. In a browser the spellchecker follows
// `<html lang>`; Electron's follows `session.setSpellCheckerLanguages` instead, so the page tells
// the shell the tag (`setSpellCheckLanguage`) and the shell picks the dictionary here. Windows
// and Linux only: on macOS the system's own spellchecker is used and the call does nothing.

/** A language tag's shape: subtags of 1-8 letters or digits joined by single hyphens. */
const TAG = /^[a-z]{2,3}(?:-[a-z\d]{1,8})*$/i
const MAX_LENGTH = 35

/** The tag with `_` read as `-`, or null when it cannot be a language tag. */
function cleanTag(value) {
  if (typeof value !== 'string') return null
  const tag = value.trim().replaceAll('_', '-')
  return tag.length <= MAX_LENGTH && TAG.test(tag) ? tag : null
}

/** Where a language's dictionary is usually found when its own tag is not offered. */
const USUAL = { en: 'en-US' }

/**
 * The languages to give `session.setSpellCheckerLanguages` for `tag`:
 * - the offered language that is the tag itself (letter case aside);
 * - else one of the same language: the bare language ("de"), then its own region ("de-DE",
 *   "en-US" for English), then the first offered;
 * - else (no match, no tag, not a tag) `defaults`, the system's languages the shell started with.
 * @param {unknown} tag  the setting's tag, or null
 * @param {string[]} available  `session.availableSpellCheckerLanguages`
 * @param {string[]} defaults   the session's languages before any setting
 */
function spellCheckLanguagesFor(tag, available, defaults) {
  const wanted = cleanTag(tag)
  const offered = Array.isArray(available) ? available.filter((a) => typeof a === 'string') : []
  if (wanted !== null) {
    const lower = wanted.toLowerCase()
    const exact = offered.find((a) => a.toLowerCase() === lower)
    if (exact) return [exact]
    const language = lower.split('-')[0]
    const own = [language, USUAL[language] || `${language}-${language}`].map((t) => t.toLowerCase())
    for (const t of own) {
      const found = offered.find((a) => a.toLowerCase() === t)
      if (found) return [found]
    }
    const same = offered.find((a) => a.toLowerCase().split('-')[0] === language)
    if (same) return [same]
  }
  return Array.isArray(defaults) ? [...defaults] : []
}

module.exports = { cleanTag, spellCheckLanguagesFor }
