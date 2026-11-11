// M32, tests only: the "Open notes as a full page" setting (`alwaysOpenAsFullPage`). It starts on,
// so a plain click on a note opens it in the current tab; a test of the peek a plain click gives
// with the setting off turns it off here, and puts the default back when it is done.
import { settingsDefaults, useSettings } from '@/settings/useSettings'

/** Set "Open notes as a full page" (the rest of the settings stay as they are). */
export function setOpenAsFullPage(on: boolean): void {
  useSettings.setState((s) => ({ settings: { ...s.settings, alwaysOpenAsFullPage: on } }))
}

/** Put the setting back to its default (on). */
export function resetOpenAsFullPage(): void {
  setOpenAsFullPage(settingsDefaults.alwaysOpenAsFullPage)
}
