// M31 item 15a: Appearance "App icon": the tab icon in the device setting's colour.
import { render } from '@testing-library/react'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { DeviceSettingsFollower } from '@/settings/DeviceSettingsFollower'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { APP_ICON_CHOICES, APP_ICON_COLORS, BOLT_PATH, DEFAULT_ICON_HREF, appIconHref, appIconSvg, applyAppIcon, useAppIcon } from './appIcon'

function iconLink(): HTMLLinkElement | null {
  return document.head.querySelector('link[rel~="icon"]')
}

beforeEach(() => {
  document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />'
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

describe('app icon', () => {
  test('test the choices are the setting choices', () => {
    expect(APP_ICON_CHOICES).toEqual(['default', 'red', 'orange', 'green', 'blue', 'purple', 'pink', 'gray'])
    expect(Object.keys(APP_ICON_COLORS)).toEqual(APP_ICON_CHOICES.slice(1))
  })

  test('test the bolt is the shipped favicon outline', () => {
    const favicon = readFileSync(join(process.cwd(), 'public', 'favicon.svg'), 'utf8')
    // Same shape, written in the same commands (the favicon's first path).
    const first = /<path fill="#863bff" d="([^"]+)"/.exec(favicon)?.[1] ?? ''
    expect(first.replace(/\s+/g, '')).toBe(BOLT_PATH.replace(/\s+/g, ''))
  })

  test('test a colour is an svg data url in that colour, default the favicon', () => {
    expect(appIconSvg('default')).toBeNull()
    expect(appIconHref('default')).toBe(DEFAULT_ICON_HREF)
    expect(appIconHref('teal')).toBe(DEFAULT_ICON_HREF)
    const href = appIconHref('red')
    expect(href.startsWith('data:image/svg+xml,')).toBe(true)
    expect(decodeURIComponent(href.slice('data:image/svg+xml,'.length))).toContain(`fill="${APP_ICON_COLORS.red}"`)
  })

  test('test applyAppIcon sets the link and adds one when missing', () => {
    applyAppIcon('blue')
    expect(iconLink()?.getAttribute('href')).toBe(appIconHref('blue'))
    applyAppIcon('default')
    expect(iconLink()?.getAttribute('href')).toBe('/favicon.svg')
    document.head.innerHTML = ''
    applyAppIcon('green')
    expect(iconLink()?.getAttribute('href')).toBe(appIconHref('green'))
    expect(iconLink()?.type).toBe('image/svg+xml')
  })

  test('test useAppIcon follows the device setting', () => {
    function Probe() {
      useAppIcon()
      return null
    }
    render(<Probe />)
    expect(iconLink()?.getAttribute('href')).toBe('/favicon.svg')
    act(() => useSettings.setState({ settings: { ...settingsDefaults, appIcon: 'pink' } }))
    expect(iconLink()?.getAttribute('href')).toBe(appIconHref('pink'))
  })

  test('test the device settings follower sets the tab icon', () => {
    useSettings.setState({ settings: { ...settingsDefaults, appIcon: 'orange' }, loaded: true })
    render(<DeviceSettingsFollower />)
    expect(iconLink()?.getAttribute('href')).toBe(appIconHref('orange'))
  })
})
