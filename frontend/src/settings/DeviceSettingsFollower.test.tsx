import { readFileSync } from 'node:fs'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { DeviceSettingsFollower } from './DeviceSettingsFollower'

const html = document.documentElement

beforeEach(() => {
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

afterEach(() => {
  html.style.removeProperty('--app-zoom')
  localStorage.clear()
})

describe('DeviceSettingsFollower', () => {
  test('test the zoom setting follows onto the root', () => {
    render(<DeviceSettingsFollower />)
    expect(html.style.getPropertyValue('--app-zoom')).toBe('')
    act(() => useSettings.setState({ settings: { ...settingsDefaults, zoom: 1.2 } }))
    expect(html.style.getPropertyValue('--app-zoom')).toBe('1.2')
  })

  test('test spellcheck language, type settings and highlight style follow onto the root', () => {
    render(<DeviceSettingsFollower />)
    expect(html.getAttribute('lang')).toBe('en')
    expect(html.hasAttribute('data-hide-structure-settings')).toBe(false)
    expect(html.getAttribute('data-highlight-style')).toBe('default')
    act(() =>
      useSettings.setState({
        settings: { ...settingsDefaults, spellCheckLang: 'de-CH', hideStructureSettings: true, highlightStyle: 'minimal' },
      }),
    )
    expect(html.getAttribute('lang')).toBe('de-CH')
    expect(html.hasAttribute('data-hide-structure-settings')).toBe(true)
    expect(html.getAttribute('data-highlight-style')).toBe('minimal')
    act(() => useSettings.setState({ settings: settingsDefaults }))
    expect(html.getAttribute('lang')).toBe('en')
    expect(html.hasAttribute('data-hide-structure-settings')).toBe(false)
  })

  test('test the stylesheet hides marked type-settings entry points', () => {
    const css = readFileSync(`${process.cwd()}/src/theme/tokens.css`, 'utf8')
    expect(css).toMatch(/html\[data-hide-structure-settings\] \[data-structure-setting\]\s*{\s*display: none !important;/)
  })

  test('test the defaults do not overwrite the cached zoom before settings load', () => {
    localStorage.setItem('object.zoom', '1.1')
    html.style.setProperty('--app-zoom', '1.1')
    useSettings.setState({ settings: settingsDefaults, revision: '', loaded: false })
    render(<DeviceSettingsFollower />)
    expect(html.style.getPropertyValue('--app-zoom')).toBe('1.1')
  })
})
