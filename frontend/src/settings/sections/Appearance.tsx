// "Appearance": theme mode, the light and the dark theme, the app font and the monochrome colour
// switches, and the text size (`zoom.ts`). Every change is a device
// setting (`useSettings().patch`).
import { useState } from 'react'
import type { DeviceSettings } from '@/api/types'
import { Icon } from '@/components/Icon'
import { useSettings } from '@/settings/useSettings'
import { nextZoom, validZoom, zoomPercent } from '@/settings/zoom'
import { OptionCards, SaveError, SecondaryButton, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'

export const APPEARANCE_TEXT = {
  heading: 'Appearance',
  description: 'Adjust the appearance of the app.',
  theme: 'Theme',
  themeDescription: 'Define the theme you want to use for Object', // our string
  modeLight: 'Light',
  modeDark: 'Dark',
  lightTheme: 'Light theme',
  lightThemeDescription: 'Pick a light mode theme.',
  darkTheme: 'Dark theme',
  darkThemeDescription: 'Pick a dark mode theme.',
  themes: {
    light: { name: 'Light', description: 'The default light theme.' },
    lightDimmed: { name: 'Light Dimmed', description: 'A light theme with a dimmed contrast' },
    dark: { name: 'Dark', description: 'The default dark theme' },
    darkDimmed: { name: 'Dark Dimmed', description: 'A dark theme with a dimmed contrast' },
  },
  font: 'Font',
  fontDescription: 'Pick a global font for the app.', // our string
  fonts: {
    'sans-serif': { name: 'Sans Serif', description: 'Inter – a beautiful timeless typeface.' },
    serif: { name: 'Serif', description: 'Georgia – a classic serif typeface with good readability.' },
    monospace: { name: 'Monospace', description: 'Courier New – a monospace typeface resembling a typewriter.' },
  },
  colors: 'Colors',
  colorsDescription: 'Settings around colors.',
  monoTypeLabels: 'Monochrome type labels',
  monoTypeLabelsDescription: 'Enable to have all type labels in the same color.',
  monoTags: 'Monochrome tags',
  monoTagsDescription: 'Enable to have all tags in the same color.',
  // A browser has no View menu to zoom from, so the text size lives here (our choice).
  textSize: 'Text size', // our string
  textSizeDescription: 'Make the text of your notes larger or smaller.', // our string
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetZoom: 'Reset zoom',
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
  T.textSize,
  T.zoomIn,
  T.zoomOut,
  T.resetZoom,
]

const ZOOM_BUTTON =
  'inline-flex size-8 items-center justify-center rounded-md border border-line bg-raised text-fg hover:bg-hover disabled:opacity-60'

/** Zoom out, the current size, zoom in, and Reset zoom (steps from `zoom.ts`). */
function TextSize({ zoom, onChange }: { zoom: number; onChange(next: number): void }) {
  const out = nextZoom(zoom, 'out')
  const into = nextZoom(zoom, 'in')
  return (
    <div role="group" aria-label={T.textSize} className="flex items-center gap-2">
      <button type="button" aria-label={T.zoomOut} title={T.zoomOut} disabled={out === zoom} onClick={() => onChange(out)} className={ZOOM_BUTTON}>
        <Icon name="ph-minus" size={14} />
      </button>
      <span className="w-12 text-center text-[14px] text-fg tabular-nums">{zoomPercent(zoom)}</span>
      <button type="button" aria-label={T.zoomIn} title={T.zoomIn} disabled={into === zoom} onClick={() => onChange(into)} className={ZOOM_BUTTON}>
        <Icon name="ph-plus" size={14} />
      </button>
      <SecondaryButton disabled={zoom === 1} onClick={() => onChange(1)}>
        {T.resetZoom}
      </SecondaryButton>
    </div>
  )
}

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
      <SettingGroup title={T.textSize} help={T.textSizeDescription}>
        <TextSize zoom={validZoom(settings.zoom) ? settings.zoom : 1} onChange={(zoom) => set({ zoom })} />
      </SettingGroup>
      <SaveError error={error} />
    </div>
  )
}
