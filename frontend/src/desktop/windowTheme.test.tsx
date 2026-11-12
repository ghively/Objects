import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { applyTheme } from '@/theme/applyTheme'
import { DesktopChrome } from './DesktopChrome'
import { fakeDesktop } from './testBridge'
import { resetChrome } from './useWindowChrome'
import { cssHex, topBarTheme } from './windowTheme'

const root = document.documentElement

/** A top bar with the colours a theme would give it (jsdom loads no stylesheet). */
function Bar({ background, color }: { background: string; color: string }) {
  return (
    <>
      <header className="app-titlebar" style={{ backgroundColor: background, color }} />
      <DesktopChrome />
    </>
  )
}

const DARK = { background: '#09090b', color: '#f4f4f5' }
const LIGHT = { background: '#fafaf9', color: '#1c1917' }

beforeEach(() => {
  vi.clearAllMocks()
  resetChrome()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
  applyTheme(settingsDefaults)
})

afterEach(() => {
  delete window.objectDesktop
  document.body.removeAttribute('style')
})

describe('cssHex', () => {
  test('test computed colours become css hex', () => {
    expect(cssHex('rgb(9, 9, 11)')).toBe('#09090b')
    expect(cssHex('rgb(250 250 249)')).toBe('#fafaf9')
    expect(cssHex('rgba(244, 244, 245, 1)')).toBe('#f4f4f5')
    expect(cssHex('rgb(28 25 23 / 0.5)')).toBe('#1c1917')
    expect(cssHex('color(srgb 1 0.5 0)')).toBe('#ff8000')
    expect(cssHex('#FAFAF9')).toBe('#fafaf9')
    expect(cssHex('#abc')).toBe('#aabbcc')
  })

  test('test nothing, transparent and what it cannot read are null', () => {
    expect(cssHex('')).toBeNull()
    expect(cssHex('transparent')).toBeNull()
    expect(cssHex('rgba(0, 0, 0, 0)')).toBeNull()
    expect(cssHex('canvastext')).toBeNull()
  })
})

describe('the window follows the theme', () => {
  test('test the top bar colours and mode are sent once at start', () => {
    const fake = fakeDesktop({ platform: 'win32' })
    window.objectDesktop = fake.bridge
    render(<Bar {...DARK} />)
    expect(fake.bridge.setTheme).toHaveBeenCalledTimes(1)
    expect(fake.bridge.setTheme).toHaveBeenCalledWith({ mode: 'dark', background: '#09090b', foreground: '#f4f4f5' })
  })

  test('test a theme change is sent with the new colours, and the same theme is not sent twice', async () => {
    const fake = fakeDesktop({ platform: 'win32' })
    window.objectDesktop = fake.bridge
    const { rerender } = render(<Bar {...DARK} />)
    expect(fake.bridge.setTheme).toHaveBeenCalledTimes(1)

    // Settings > Appearance > Light: the app writes the theme on <html>, the bar repaints.
    rerender(<Bar {...LIGHT} />)
    act(() => {
      applyTheme({ ...settingsDefaults, themeMode: 'light' })
    })
    await waitFor(() => expect(fake.bridge.setTheme).toHaveBeenLastCalledWith({ mode: 'light', background: '#fafaf9', foreground: '#1c1917' }))
    expect(fake.bridge.setTheme).toHaveBeenCalledTimes(2)

    // Light Dimmed: the same mode, another surface.
    rerender(<Bar background="#f5f5f4" color="#292524" />)
    act(() => {
      applyTheme({ ...settingsDefaults, themeMode: 'light', lightTheme: 'lightDimmed' })
    })
    await waitFor(() => expect(fake.bridge.setTheme).toHaveBeenLastCalledWith({ mode: 'light', background: '#f5f5f4', foreground: '#292524' }))
    expect(fake.bridge.setTheme).toHaveBeenCalledTimes(3)

    // Something else on <html> changes (a font, full screen): nothing new to say.
    act(() => {
      applyTheme({ ...settingsDefaults, themeMode: 'light', lightTheme: 'lightDimmed', font: 'serif' })
      root.classList.add('desktop-fullscreen')
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(fake.bridge.setTheme).toHaveBeenCalledTimes(3)
    root.classList.remove('desktop-fullscreen')
  })

  test('test without a top bar the page colours are used', () => {
    document.body.style.backgroundColor = '#18181b'
    document.body.style.color = '#e4e4e7'
    expect(topBarTheme()).toEqual({ mode: 'dark', background: '#18181b', foreground: '#e4e4e7' })
  })

  test('test colours that cannot be read send nothing rather than a guess', () => {
    const fake = fakeDesktop({ platform: 'win32' })
    window.objectDesktop = fake.bridge
    render(<DesktopChrome />)
    expect(topBarTheme()).toBeNull()
    expect(fake.bridge.setTheme).not.toHaveBeenCalled()
  })

  test('test in a browser nothing is sent', () => {
    const fake = fakeDesktop({ platform: 'win32' })
    render(<Bar {...DARK} />)
    expect(fake.bridge.setTheme).not.toHaveBeenCalled()
  })
})
