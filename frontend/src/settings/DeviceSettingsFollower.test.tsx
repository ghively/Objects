import { readFileSync } from 'node:fs'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { fakeDesktop } from '@/desktop/testBridge'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { DeviceSettingsFollower } from './DeviceSettingsFollower'

const html = document.documentElement

beforeEach(() => {
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

afterEach(() => {
  delete window.objectDesktop
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
    expect(html.hasAttribute('data-hide-type-settings')).toBe(false)
    expect(html.getAttribute('data-highlight-style')).toBe('default')
    act(() =>
      useSettings.setState({
        settings: { ...settingsDefaults, spellCheckLang: 'de-CH', hideTypeSettings: true, highlightStyle: 'minimal' },
      }),
    )
    expect(html.getAttribute('lang')).toBe('de-CH')
    expect(html.hasAttribute('data-hide-type-settings')).toBe(true)
    expect(html.getAttribute('data-highlight-style')).toBe('minimal')
    act(() => useSettings.setState({ settings: settingsDefaults }))
    expect(html.getAttribute('lang')).toBe('en')
    expect(html.hasAttribute('data-hide-type-settings')).toBe(false)
  })

  test('test in the desktop window the spellcheck language also reaches the shell, at start and on every change', () => {
    // Electron's spellchecker does not follow <html lang>: the shell is told the tag.
    const fake = fakeDesktop({ platform: 'linux' })
    window.objectDesktop = fake.bridge
    useSettings.setState({ settings: { ...settingsDefaults, spellCheckLang: 'fr' }, loaded: true })
    render(<DeviceSettingsFollower />)
    expect(fake.bridge.setSpellCheckLanguage).toHaveBeenLastCalledWith('fr')
    act(() => useSettings.setState({ settings: { ...settingsDefaults, spellCheckLang: 'de_ch' } }))
    expect(fake.bridge.setSpellCheckLanguage).toHaveBeenLastCalledWith('de-CH')
    act(() => useSettings.setState({ settings: { ...settingsDefaults, spellCheckLang: null } }))
    expect(fake.bridge.setSpellCheckLanguage).toHaveBeenLastCalledWith(null)
    expect(fake.bridge.setSpellCheckLanguage).toHaveBeenCalledTimes(3)
  })

  test('test before the settings are read the shell is not told the default', () => {
    const fake = fakeDesktop({ platform: 'win32' })
    window.objectDesktop = fake.bridge
    useSettings.setState({ settings: settingsDefaults, revision: '', loaded: false })
    render(<DeviceSettingsFollower />)
    expect(fake.bridge.setSpellCheckLanguage).not.toHaveBeenCalled()
    act(() => useSettings.setState({ settings: { ...settingsDefaults, spellCheckLang: 'sv' }, loaded: true }))
    expect(fake.bridge.setSpellCheckLanguage).toHaveBeenCalledWith('sv')
  })

  test('test the stylesheet hides marked type-settings entry points', () => {
    const css = readFileSync(`${process.cwd()}/src/theme/tokens.css`, 'utf8')
    expect(css).toMatch(/html\[data-hide-type-settings\] \[data-type-setting\]\s*{\s*display: none !important;/)
  })

  test('test the defaults do not overwrite the cached zoom before settings load', () => {
    localStorage.setItem('object.zoom', '1.1')
    html.style.setProperty('--app-zoom', '1.1')
    useSettings.setState({ settings: settingsDefaults, revision: '', loaded: false })
    render(<DeviceSettingsFollower />)
    expect(html.style.getPropertyValue('--app-zoom')).toBe('1.1')
  })
})
