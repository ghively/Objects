import { app, session } from 'electron'
import { spellCheckerLanguageToEnable } from '../electron-shared/spellCheckerLanguage.js'

// Windows and Linux only spellcheck languages passed to setSpellCheckerLanguages.
// The editor `lang` attribute does not switch those dictionaries, and `<html lang="en">`
// keeps the default on English, so choosing French in settings never took effect.
export function syncSpellCheckerLanguage(requested: string | undefined): {
  language: string | undefined
} {
  try {
    const available = session.defaultSession.availableSpellCheckerLanguages
    const preferred = [...app.getPreferredSystemLanguages(), app.getLocale(), app.getSystemLocale()]
    const language = spellCheckerLanguageToEnable(requested, available, preferred)
    if (!language) return { language: undefined }

    session.defaultSession.setSpellCheckerLanguages([language])
    return { language }
  } catch (error) {
    console.error('Failed to set spellchecker language', error)
    return { language: undefined }
  }
}
