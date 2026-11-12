// "Appearance": theme mode, the light and the dark theme, the app icon's colour (M31), the app font
// and the monochrome colour switches, and the text size (`zoom.ts`). Every change is a device
// setting (`useSettings().patch`).
import { useState } from 'react'
import type { AppIconColor, DeviceSettings } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { applyWindowButtons, storedWindowButtons, windowButtonsApply, windowButtonsPatch } from '@/desktop/useWindowChrome'
import { APP_ICON_CHOICES, appIconHref } from '@/settings/appIcon'
import { useSettings } from '@/settings/useSettings'
import { nextZoom, validZoom, zoomPercent } from '@/settings/zoom'
import { OptionCards, SaveError, SecondaryButton, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'

export const APPEARANCE_TEXT = {
  heading: 'Appearance',
  description: 'Themes, fonts and colors.',
  theme: 'Theme',
  themeDescription: 'Define the theme you want to use for Object.', // our string
  modeLight: 'Light',
  modeDark: 'Dark',
  lightTheme: 'Light theme',
  lightThemeDescription: 'The theme used in light mode.',
  darkTheme: 'Dark theme',
  darkThemeDescription: 'The theme used in dark mode.',
  themes: {
    light: { name: 'Light', description: 'The standard light theme.' },
    lightDimmed: { name: 'Light Dimmed', description: 'Light, with softer contrast.' },
    dark: { name: 'Dark', description: 'The standard dark theme.' },
    darkDimmed: { name: 'Dark Dimmed', description: 'Dark, with softer contrast.' },
  },
  // M31 (catalog: "App icon (colored icon per device)"); the help and the colour names are ours.
  appIcon: 'App icon',
  appIconDescription: "The color of Object's icon on this device: the browser tab at once, the app window from the next start.",
  appIconColors: {
    default: 'Default',
    red: 'Red',
    orange: 'Orange',
    green: 'Green',
    blue: 'Blue',
    purple: 'Purple',
    pink: 'Pink',
    gray: 'Gray',
  } satisfies Record<AppIconColor, string>,
  font: 'Font',
  fontDescription: 'Pick a global font for the app.', // our string
  fonts: {
    'sans-serif': { name: 'Sans Serif', description: 'Inter, a clean and neutral face.' },
    serif: { name: 'Serif', description: 'Georgia, an easy-to-read serif face.' },
    monospace: { name: 'Monospace', description: 'Courier New, a fixed-width, typewriter-like face.' },
  },
  colors: 'Colors',
  colorsDescription: 'Settings around colors.',
  monoTypeLabels: 'Monochrome type labels',
  monoTypeLabelsDescription: 'Show every type label in one color.',
  monoTags: 'Monochrome tags',
  monoTagsDescription: 'Show every tag in one color.',
  // A browser has no View menu to zoom from, so the text size lives here (our choice).
  textSize: 'Text size', // our string
  textSizeDescription: 'Make the text of your notes larger or smaller.', // our string
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetZoom: 'Reset zoom',
  layout: 'Layout', // our string
  layoutDescription: 'How the window looks when Object opens.', // our string
  sidebarOnStart: 'Show the sidebar when Object opens', // our string
  sidebarOnStartDescription: 'Off: Object opens with the sidebar collapsed. Ctrl+Shift+Left shows it.', // our string
  // M33: only in the desktop window on Linux, where Object draws the window's own buttons.
  windowButtons: 'Window buttons',
  windowButtonsDescription:
    'The minimize, maximize and close buttons at the end of the top bar. Automatic leaves them out on a tiling window manager, where windows have none.', // our string
  windowButtonsAuto: 'Automatic',
  windowButtonsShow: 'Show',
  windowButtonsHide: 'Hide',
} as const

const T = APPEARANCE_TEXT

export const APPEARANCE_SEARCH: string[] = [
  T.theme,
  T.modeLight,
  T.modeDark,
  T.lightTheme,
  T.darkTheme,
  ...Object.values(T.themes).map((t) => t.name),
  T.appIcon,
  T.font,
  ...Object.values(T.fonts).map((f) => f.name),
  T.colors,
  T.monoTypeLabels,
  T.monoTags,
  T.textSize,
  T.zoomIn,
  T.zoomOut,
  T.resetZoom,
  // Only where the setting is shown.
  ...(windowButtonsApply() ? [T.windowButtons] : []),
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

/** "App icon": one swatch per colour, each showing the icon in that colour. */
function AppIconPicker({ value, onChange }: { value: AppIconColor; onChange(next: AppIconColor): void }) {
  return (
    <div role="radiogroup" aria-label={T.appIcon} className="flex flex-wrap gap-2">
      {APP_ICON_CHOICES.map((c) => {
        const checked = c === value
        const label = T.appIconColors[c]
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            data-value={c}
            onClick={() => {
              if (!checked) onChange(c)
            }}
            className={cn(
              'flex size-11 items-center justify-center rounded-lg border bg-raised hover:bg-hover',
              checked ? 'border-fg-muted ring-1 ring-fg-muted' : 'border-line',
            )}
          >
            <img src={appIconHref(c)} alt="" className="size-6" draggable={false} />
          </button>
        )
      })}
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
      <SettingGroup title={T.appIcon} help={T.appIconDescription}>
        <AppIconPicker value={settings.appIcon ?? 'default'} onChange={(appIcon) => set({ appIcon })} />
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
      <SettingGroup title={T.layout} help={T.layoutDescription} className="pb-0" />
      <SwitchRow
        title={T.sidebarOnStart}
        help={T.sidebarOnStartDescription}
        checked={settings.showSidebarOnStart !== false}
        onChange={(showSidebarOnStart) => set({ showSidebarOnStart })}
      />
      {/* M33: the desktop window on Linux only (the system draws the buttons everywhere else). */}
      {windowButtonsApply() && (
        <SettingGroup title={T.windowButtons} help={T.windowButtonsDescription}>
          <OptionCards
            label={T.windowButtons}
            value={storedWindowButtons(settings)}
            options={[
              { value: 'auto', label: T.windowButtonsAuto },
              { value: 'show', label: T.windowButtonsShow },
              { value: 'hide', label: T.windowButtonsHide },
            ]}
            onChange={(v) => {
              // The buttons appear or go at once; the choice is stored for the next start.
              void applyWindowButtons(v)
              set(windowButtonsPatch(v))
            }}
          />
        </SettingGroup>
      )}
      <SettingGroup title={T.textSize} help={T.textSizeDescription}>
        <TextSize zoom={validZoom(settings.zoom) ? settings.zoom : 1} onChange={(zoom) => set({ zoom })} />
      </SettingGroup>
      <SaveError error={error} />
    </div>
  )
}
