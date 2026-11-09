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
  showSidebarOnStart: true,
  twentyFourHourTime: false,
  dateFormatting: 'localized',
  openOnStart: {},
  startupSpace: 'lastOpened',
  startupSpacePath: null,
  // M8
  language: 'en',
  decimalSeparator: 'automatic',
  timeZone: null,
  backlinkSectionsDefault: Object.freeze({ backlinks: 'open', relatedContent: 'open', unlinkedMentions: 'open' }),
  backlinkContentView: 'embed',
  relatedContentHiddenTypes: Object.freeze([]) as unknown as string[],
  nestedBacklinkView: 'showBlockContainingBacklink',
  presentation: Object.freeze({
    hideCoverImage: false,
    hideProgressIndicator: false,
    hideTitle: false,
    footerLeft: '',
    footerRight: '',
  }),
  // Polish 2026-11-03
  zoom: 1,
  spellCheckLang: null,
  alwaysCreateInlineLinks: false,
  hideTypeSettings: false,
  highlightStyle: 'default',
  // M10
  aiHidden: false,
  claudePath: null,
  aiModel: null,
  // M22
  activityName: 'Gene',
  // M23
  workAlertFolder: null,
  workAlertIntervals: {},
  // M24
  workAgentId: null,
  workAgentActs: false,
  workAutoRun: true,
  workReadTools: [],
}) as DeviceSettings
