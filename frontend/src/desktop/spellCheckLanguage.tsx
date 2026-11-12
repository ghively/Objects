/**
 * M33: the device setting "Spellcheck language" in the desktop window. A browser's spellchecker
 * follows `<html lang>` (`settings/DeviceSettingsFollower.tsx` writes it); Electron's does not, so
 * inside the shell the same tag is told to it (`setSpellCheckLanguage`), at start and on every
 * change. The shell picks the dictionary (Windows, Linux) or does nothing (macOS, whose own
 * spellchecker is used). Outside the shell nothing here does anything.
 *
 * On Windows and Linux the browser engine downloads a language's dictionary from its vendor's
 * server the first time it is used. Object is a local app, so the setting says so there
 * (`SpellCheckDownloadNote`), and only there.
 */
import { normalizeLanguageTag } from '@/settings/spellcheck'
import { desktop } from './bridge'

export const SPELLCHECK_DOWNLOAD_TEXT = "The dictionary for this language is downloaded once from the browser engine's server."

/** Tell the shell the setting's tag (normalised; null for none or not a tag). Nothing outside the shell. */
export function tellSpellCheckLanguage(spellCheckLang: string | null | undefined): void {
  const d = desktop()
  if (!d || typeof d.setSpellCheckLanguage !== 'function') return
  try {
    d.setSpellCheckLanguage(normalizeLanguageTag(spellCheckLang) ?? null)
  } catch {
    // The shell could not take it: its spellchecker keeps the language it has.
  }
}

/** One line under the setting's help, inside the shell on Windows and Linux only. */
export function SpellCheckDownloadNote() {
  const d = desktop()
  if (!d || (d.platform !== 'win32' && d.platform !== 'linux')) return null
  return <span className="mt-1 block">{SPELLCHECK_DOWNLOAD_TEXT}</span>
}
