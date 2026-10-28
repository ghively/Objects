// "Appearance": theme mode, the light and the dark theme, the app font and the monochrome colour
// switches. Every change is a device setting (`useSettings().patch`).
import { useState } from 'react'
import type { DeviceSettings } from '@/api/types'
import { useSettings } from '@/settings/useSettings'
import { OptionCards, SaveError, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'

export const APPEARANCE_TEXT = {
  heading: 'Appearance', // AppearanceSettings.heading
  description: 'Adjust the appearance of the app.', // AppearanceSettings.description
  theme: 'Theme', // ThemeMenu.heading
  themeDescription: 'Define the theme you want to use for Object', // our string, adapted from ThemeMenu.description
  modeLight: 'Light', // ThemeMenu.options.light
  modeDark: 'Dark', // ThemeMenu.options.dark
  lightTheme: 'Light theme', // AppearanceSettings.theme.light.heading
  lightThemeDescription: 'Pick a light mode theme.', // AppearanceSettings.theme.light.description
  darkTheme: 'Dark theme', // AppearanceSettings.theme.dark.heading
  darkThemeDescription: 'Pick a dark mode theme.', // AppearanceSettings.theme.dark.description
  themes: {
    light: { name: 'Light', description: 'The default light theme.' },
    lightDimmed: { name: 'Light Dimmed', description: 'A light theme with a dimmed contrast' },
    dark: { name: 'Dark', description: 'The default dark theme' },
    darkDimmed: { name: 'Dark Dimmed', description: 'A dark theme with a dimmed contrast' },
  }, // AppearanceSettings.theme.themes.*
  font: 'Font', // AppearanceSettings.font.heading
  fontDescription: 'Pick a global font for the app.', // our string, adapted from AppearanceSettings.font.description
  fonts: {
    'sans-serif': { name: 'Sans Serif', description: 'Inter – a beautiful timeless typeface.' },
    serif: { name: 'Serif', description: 'Georgia – a classic serif typeface with good readability.' },
    monospace: { name: 'Monospace', description: 'Courier New – a monospace typeface resembling a typewriter.' },
  }, // AppearanceSettings.font.*
  colors: 'Colors', // AppearanceSettings.colors.heading
  colorsDescription: 'Settings around colors.', // AppearanceSettings.colors.description
  monoTypeLabels: 'Monochrome type labels', // AppearanceSettings.colors.customTypeLabels.heading
  monoTypeLabelsDescription: 'Enable to have all type labels in the same color.',
  monoTags: 'Monochrome tags', // AppearanceSettings.colors.monochromeTags.heading
  monoTagsDescription: 'Enable to have all tags in the same color.',
} as const

const T = APPEARANCE_TEXT

export const APPEARANCE_SEARCH: string[] = [
  T.theme,
  T.modeLight,
  T.modeDark,
  T.lightTheme,
  T.darkTheme,
  ...Object.values(T.themes).map((t) => t.name),
  T.font,
  ...Object.values(T.fonts).map((f) => f.name),
  T.colors,
  T.monoTypeLabels,
  T.monoTags,
]

export function AppearanceSection() {
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
      <SectionHeader icon="ph-paint-brush" heading={T.heading} description={T.description} />
      <SettingGroup title={T.theme} help={T.themeDescription}>
        <OptionCards
          label={T.theme}
          value={settings.themeMode}
          options={[
            { value: 'light', label: T.modeLight },
            { value: 'dark', label: T.modeDark },
          ]}
          onChange={(themeMode) => set({ themeMode })}
        />
      </SettingGroup>
      <SettingGroup title={T.lightTheme} help={T.lightThemeDescription}>
        <OptionCards
          label={T.lightTheme}
          value={settings.lightTheme}
          options={(['light', 'lightDimmed'] as const).map((v) => ({ value: v, label: T.themes[v].name, description: T.themes[v].description }))}
          onChange={(lightTheme) => set({ lightTheme })}
        />
      </SettingGroup>
      <SettingGroup title={T.darkTheme} help={T.darkThemeDescription}>
        <OptionCards
          label={T.darkTheme}
          value={settings.darkTheme}
          options={(['dark', 'darkDimmed'] as const).map((v) => ({ value: v, label: T.themes[v].name, description: T.themes[v].description }))}
          onChange={(darkTheme) => set({ darkTheme })}
        />
      </SettingGroup>
      <SettingGroup title={T.font} help={T.fontDescription}>
        <OptionCards
          label={T.font}
          value={settings.font}
          options={(['sans-serif', 'serif', 'monospace'] as const).map((v) => ({ value: v, label: T.fonts[v].name, description: T.fonts[v].description }))}
          onChange={(font) => set({ font })}
        />
      </SettingGroup>
      <SettingGroup title={T.colors} help={T.colorsDescription} className="pb-0" />
      <SwitchRow
        title={T.monoTypeLabels}
        help={T.monoTypeLabelsDescription}
        checked={settings.monochromeTypeLabels}
        onChange={(monochromeTypeLabels) => set({ monochromeTypeLabels })}
      />
      <SwitchRow
        title={T.monoTags}
        help={T.monoTagsDescription}
        checked={settings.monochromeTags}
        onChange={(monochromeTags) => set({ monochromeTags })}
      />
      <SaveError error={error} />
    </div>
  )
}
