// The contract's `DeviceSettings` defaults (the server merges the same ones). Kept apart from
// `useSettings` so `test/mockApi.ts` can use it without importing the api client.
import type { DeviceSettings } from '@/api/types'

export const settingsDefaults: DeviceSettings = Object.freeze({
  themeMode: 'dark',
  lightTheme: 'light',
  darkTheme: 'dark',
  font: 'sans-serif',
  monochromeTags: false,
  monochromeTypeLabels: false,
  toggleStyle: 'toggle',
  disableNumberedListTransformation: false,
  disableSpellcheck: false,
  alwaysOpenAsFullPage: false,
  hideEntityIconsOnInlineLinks: false,
  hideOutlinerLines: false,
  twentyFourHourTime: false,
  dateFormatting: 'localized',
  openOnStart: {},
  startupSpace: 'lastOpened',
  startupSpacePath: null,
}) as DeviceSettings
