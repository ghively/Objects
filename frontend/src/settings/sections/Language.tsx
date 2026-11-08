// "Language": the language (device setting `language`) and the decimal separator
// (`decimalSeparator`). Object's interface stays English: the language sets the locale
// `properties/format.ts` formats "Localized" dates with, and "Automatic" takes the decimal
// separator from it.
import { useState } from 'react'
import type { DeviceSettings, SettingsLanguage } from '@/api/types'
import { useSettings } from '@/settings/useSettings'
import { OptionCards, SaveError, SectionHeader, SettingGroup, errorText } from '../controls'

export const LANGUAGE_TEXT = {
  heading: 'Language',
  // our string: Object has no translations, so the language only sets the formatting locale.
  info: "Object's interface is in English; the language sets how dates and numbers are formatted.",
  changeLanguage: 'Change your language',
  changeLanguageDescription: 'The language the app is shown in.',
  decimalSeparator: 'Decimal separator',
  decimalSeparatorDescription:
    'The character that splits whole numbers from their fractions, such as the point in 3.5.',
  separators: {
    automatic: 'Automatic',
    dot: 'Dot',
    comma: 'Comma',
  },
} as const

/**
 * The languages in menu order with their names and flags.
 */
export const LANGUAGES: readonly { value: SettingsLanguage; name: string; flag: string }[] = [
  { value: 'en', name: 'English', flag: '🇺🇸' },
  { value: 'en-gb', name: 'English (UK)', flag: '🇬🇧' },
  { value: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { value: 'fr', name: 'Français', flag: '🇫🇷' },
  { value: 'es', name: 'Español', flag: '🇪🇸' },
  { value: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { value: 'pt-br', name: 'Português (BR)', flag: '🇧🇷' },
  { value: 'hu', name: 'Magyar', flag: '🇭🇺' },
  { value: 'it', name: 'Italian', flag: '🇮🇹' },
]

const T = LANGUAGE_TEXT

export const LANGUAGE_SEARCH: string[] = [
  T.changeLanguage,
  T.decimalSeparator,
  ...Object.values(T.separators),
  ...LANGUAGES.map((l) => l.name),
]

const SEPARATORS = ['automatic', 'dot', 'comma'] as const

export function LanguageSection() {
  const settings = useSettings((s) => s.settings)
  const [error, setError] = useState<string | null>(null)
  const set = (p: Partial<DeviceSettings>) => {
    setError(null)
    useSettings
      .getState()
      .patch(p)
      .catch((e: unknown) => setError(errorText(e)))
  }
  return (
    <div>
      <SectionHeader icon="ph-translate" heading={T.heading} description={T.info} />
      <SettingGroup title={T.changeLanguage} help={T.changeLanguageDescription}>
        <OptionCards
          label={T.changeLanguage}
          value={settings.language ?? 'en'}
          columns={3}
          options={LANGUAGES.map((l) => ({ value: l.value, label: l.name, description: l.flag }))}
          onChange={(language) => set({ language })}
        />
      </SettingGroup>
      <SettingGroup title={T.decimalSeparator} help={T.decimalSeparatorDescription}>
        <OptionCards
          label={T.decimalSeparator}
          value={settings.decimalSeparator ?? 'automatic'}
          options={SEPARATORS.map((s) => ({ value: s, label: T.separators[s] }))}
          onChange={(decimalSeparator) => set({ decimalSeparator })}
        />
      </SettingGroup>
      <SaveError error={error} />
    </div>
  )
}
