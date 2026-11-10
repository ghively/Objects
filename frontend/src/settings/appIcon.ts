// colour-literals: content palette (the app icon's colours are SVG fill values)
/**
 * Appearance "App icon" (M31, catalog section 1: "App icon (colored icon per device)"): the
 * device setting `appIcon` recolours Object's icon. This file sets the browser tab's icon (the
 * `<link rel="icon">`) to the app's bolt in the chosen colour; `default` keeps `/favicon.svg`.
 * The desktop window's icon is the backend's (`appicon.py`, the same colours and shape) and
 * changes from the next start.
 */
import { useEffect } from 'react'
import type { AppIconColor } from '@/api/types'
import { settingsDefaults, useSettings } from './useSettings'

/** The colours in the picker's order, `default` first (the setting's choices). */
export const APP_ICON_CHOICES: readonly AppIconColor[] = ['default', 'red', 'orange', 'green', 'blue', 'purple', 'pink', 'gray']

/** Each colour's fill (Tailwind's 500 shades; `appicon.py` has the same values). */
export const APP_ICON_COLORS: Record<Exclude<AppIconColor, 'default'>, string> = {
  red: '#ef4444',
  orange: '#f97316',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  pink: '#ec4899',
  gray: '#71717a',
}

/** The default icon, as shipped. */
export const DEFAULT_ICON_HREF = '/favicon.svg'

/** The bolt of `public/favicon.svg` (viewBox 0 0 48 46), its outer path. */
export const BOLT_PATH =
  'M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287' +
  'c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237' +
  'c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894' +
  'c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377' +
  'c.943 0 1.473 1.088.89 1.83L25.947 44.94z'

function known(color: string | null | undefined): color is Exclude<AppIconColor, 'default'> {
  return !!color && Object.prototype.hasOwnProperty.call(APP_ICON_COLORS, color)
}

/** The icon in `color` as a one-colour SVG (`null` for the default icon). */
export function appIconSvg(color: AppIconColor | string | null | undefined): string | null {
  if (!known(color)) return null
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="46" fill="none" viewBox="0 0 48 46"><path fill="${APP_ICON_COLORS[color]}" d="${BOLT_PATH}"/></svg>`
}

/** Where the icon in `color` loads from: `/favicon.svg`, or the coloured SVG as a data URL. */
export function appIconHref(color: AppIconColor | string | null | undefined): string {
  const svg = appIconSvg(color)
  return svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : DEFAULT_ICON_HREF
}

/** Point the page's icon link at the icon in `color` (adding the link when the page has none). */
export function applyAppIcon(color: AppIconColor | string | null | undefined, doc: Document = document): void {
  let link = doc.head.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!link) {
    link = doc.createElement('link')
    link.rel = 'icon'
    doc.head.appendChild(link)
  }
  link.type = 'image/svg+xml'
  const href = appIconHref(color)
  if (link.getAttribute('href') !== href) link.setAttribute('href', href)
}

/** Keep the tab icon in the device setting's colour (`DeviceSettingsFollower` mounts it once). */
export function useAppIcon(): void {
  const color = useSettings((s) => s.settings.appIcon)
  const ready = useSettings((s) => s.loaded || s.settings !== settingsDefaults)
  useEffect(() => {
    if (ready) applyAppIcon(color)
  }, [color, ready])
}
