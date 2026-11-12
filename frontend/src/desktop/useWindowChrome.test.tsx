import { act, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { TopBar } from '@/shell/TopBar'
import { DesktopChrome } from './DesktopChrome'
import { fakeDesktop } from './testBridge'
import { barDragsWindow } from './bridge'
import { applyWindowButtons, resetChrome, useChrome } from './useWindowChrome'

function Shell() {
  return (
    <>
      <TopBar spaceName="space" onToggleSidebar={() => {}} onToggleRightPanel={() => {}} rightPanelOpen={false} />
      <DesktopChrome />
    </>
  )
}

const root = document.documentElement
const desktopClasses = () => [...root.classList].filter((c) => c.startsWith('desktop-'))

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  resetChrome()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

afterEach(() => {
  delete window.objectDesktop
})

describe('useWindowChrome', () => {
  test('test in a browser nothing changes: no class on html, no window buttons, no room kept', () => {
    const before = root.className
    const { unmount } = render(<Shell />)
    expect(root.className).toBe(before)
    expect(desktopClasses()).toEqual([])
    expect(screen.queryByRole('group', { name: 'Window' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Minimize' })).toBeNull()
    // The bar itself carries no inline room for window buttons.
    const bar = screen.getByRole('banner')
    expect(bar.getAttribute('style')).toBeNull()
    expect(useChrome.getState()).toEqual({ controls: null, maximized: false, fullScreen: false })
    unmount()
    expect(root.className).toBe(before)
  })

  test.each([
    ['win32', 'overlay'],
    ['darwin', 'traffic'],
    ['linux', 'custom'],
  ] as const)('test in the shell html says the system (%s), where the buttons are (%s) and that the bar drags', async (platform, controls) => {
    const fake = fakeDesktop({ platform })
    window.objectDesktop = fake.bridge
    const { unmount } = render(<Shell />)
    expect(desktopClasses().sort()).toEqual([`desktop-${platform}`, `desktop-controls-${controls}`, 'desktop-drag'].sort())
    expect(useChrome.getState().controls).toBe(controls)
    await waitFor(() => expect(fake.bridge.isFullScreen).toHaveBeenCalled())
    unmount()
    expect(desktopClasses()).toEqual([])
  })

  test.each(['win32', 'darwin', 'linux'] as const)('test the classes are on html before the first paint (%s): no frame shows the bar un-padded', (platform) => {
    window.objectDesktop = fakeDesktop({ platform }).bridge
    // What is on <html> when the layout effects of the same commit run: that is before the
    // browser paints. An effect that ran after the paint would not have been seen here.
    const seen: string[] = []
    function Probe() {
      useLayoutEffect(() => {
        seen.push(...desktopClasses())
      }, [])
      return null
    }
    render(
      <>
        <Shell />
        <Probe />
      </>,
    )
    expect(seen).toContain(`desktop-${platform}`)
    expect(seen).toContain('desktop-drag')
    expect(seen.some((c) => c.startsWith('desktop-controls-'))).toBe(true)
  })

  test.each(['win32', 'darwin', 'linux'] as const)('test with the system frame (%s) nothing is reserved and the bar does not drag', (platform) => {
    window.objectDesktop = fakeDesktop({ platform, framed: true }).bridge
    render(<Shell />)
    expect(desktopClasses().sort()).toEqual([`desktop-${platform}`, 'desktop-controls-none'].sort())
    expect(screen.queryByRole('group', { name: 'Window' })).toBeNull()
  })

  test('test a frameless Linux window without buttons is still moved by the bar', () => {
    window.objectDesktop = fakeDesktop({ platform: 'linux', controls: 'none' }).bridge
    render(<Shell />)
    expect(desktopClasses().sort()).toEqual(['desktop-controls-none', 'desktop-drag', 'desktop-linux'])
  })

  test('test barDragsWindow: the frame decides first, then buttons, then Linux', () => {
    expect(barDragsWindow({ platform: 'win32' }, 'overlay')).toBe(true)
    expect(barDragsWindow({ platform: 'darwin' }, 'traffic')).toBe(true)
    expect(barDragsWindow({ platform: 'linux' }, 'custom')).toBe(true)
    expect(barDragsWindow({ platform: 'linux' }, 'none')).toBe(true)
    expect(barDragsWindow({ platform: 'linux', framed: false }, 'none')).toBe(true)
    expect(barDragsWindow({ platform: 'win32' }, 'none')).toBe(false)
    expect(barDragsWindow({ platform: 'darwin' }, 'none')).toBe(false)
    expect(barDragsWindow({ platform: 'linux', framed: true }, 'none')).toBe(false)
    expect(barDragsWindow({ platform: 'win32', framed: true }, 'overlay')).toBe(false)
  })

  test('test the classes follow the buttons when they change', () => {
    window.objectDesktop = fakeDesktop({ platform: 'linux' }).bridge
    render(<Shell />)
    expect(root.classList.contains('desktop-controls-custom')).toBe(true)
    act(() => useChrome.setState({ controls: 'none' }))
    expect(desktopClasses().sort()).toEqual(['desktop-controls-none', 'desktop-drag', 'desktop-linux'])
    act(() => useChrome.setState({ controls: 'custom' }))
    expect(desktopClasses().sort()).toEqual(['desktop-controls-custom', 'desktop-drag', 'desktop-linux'])
  })

  test('test desktop-fullscreen follows the window, and the store its maximised state', async () => {
    const fake = fakeDesktop({ platform: 'darwin' })
    window.objectDesktop = fake.bridge
    render(<Shell />)
    expect(root.classList.contains('desktop-fullscreen')).toBe(false)
    act(() => fake.emitWindowState({ maximized: false, fullScreen: true }))
    expect(root.classList.contains('desktop-fullscreen')).toBe(true)
    expect(useChrome.getState().fullScreen).toBe(true)
    act(() => fake.emitWindowState({ maximized: true, fullScreen: false }))
    expect(root.classList.contains('desktop-fullscreen')).toBe(false)
    expect(useChrome.getState()).toMatchObject({ maximized: true, fullScreen: false })
  })

  test('test a window that starts maximised or full screen is known at once', async () => {
    const fake = fakeDesktop({ platform: 'win32', maximized: true, fullScreen: true })
    window.objectDesktop = fake.bridge
    render(<Shell />)
    await waitFor(() => expect(useChrome.getState()).toMatchObject({ maximized: true, fullScreen: true }))
    expect(root.classList.contains('desktop-fullscreen')).toBe(true)
  })

  test('test the first answer never overwrites a later change of the window', async () => {
    const fake = fakeDesktop({ platform: 'linux' })
    let answer: (v: boolean) => void = () => {}
    vi.mocked(fake.bridge.isMaximized).mockReturnValue(new Promise<boolean>((r) => (answer = r)))
    window.objectDesktop = fake.bridge
    render(<Shell />)
    act(() => fake.emitWindowState({ maximized: true, fullScreen: false }))
    await act(async () => answer(false))
    expect(useChrome.getState().maximized).toBe(true)
  })

  test('test the top bar is the drag region, with the classes the stylesheet names', () => {
    render(<Shell />)
    const bar = screen.getByRole('banner')
    expect(bar).toHaveClass('app-titlebar', 'app-drag')
    // Its height in a browser is what it was.
    expect(bar).toHaveClass('h-[42px]')
    expect(screen.getByRole('button', { name: 'Toggle sidebar' }).parentElement).toHaveClass('app-titlebar-lead')
  })
})

describe('the stored Window buttons setting', () => {
  const withButtons = (v: string) => ({ ...settingsDefaults, windowButtons: v }) as typeof settingsDefaults

  test('test on Linux the stored choice is applied at start', async () => {
    const fake = fakeDesktop({ platform: 'linux', controls: 'custom' })
    window.objectDesktop = fake.bridge
    useSettings.setState({ settings: withButtons('hide'), loaded: true })
    render(<Shell />)
    await waitFor(() => expect(fake.bridge.setWindowButtons).toHaveBeenCalledWith('hide'))
    await waitFor(() => expect(useChrome.getState().controls).toBe('none'))
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(root.classList.contains('desktop-controls-none')).toBe(true)
  })

  test('test nothing is applied before the settings are read, then the stored choice is', async () => {
    const fake = fakeDesktop({ platform: 'linux', controls: 'none' })
    window.objectDesktop = fake.bridge
    useSettings.setState({ settings: settingsDefaults, loaded: false })
    render(<Shell />)
    expect(fake.bridge.setWindowButtons).not.toHaveBeenCalled()
    act(() => useSettings.setState({ settings: withButtons('show'), loaded: true }))
    await waitFor(() => expect(fake.bridge.setWindowButtons).toHaveBeenCalledWith('show'))
    expect(await screen.findByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  test('test a change made in another window is followed', async () => {
    const fake = fakeDesktop({ platform: 'linux', controls: 'custom' })
    window.objectDesktop = fake.bridge
    render(<Shell />)
    await waitFor(() => expect(fake.bridge.setWindowButtons).toHaveBeenCalledWith('auto'))
    act(() => useSettings.setState({ settings: withButtons('hide') }))
    await waitFor(() => expect(fake.bridge.setWindowButtons).toHaveBeenLastCalledWith('hide'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close' })).toBeNull())
  })

  test('test a value that is none of the three reads as Automatic', async () => {
    const fake = fakeDesktop({ platform: 'linux', controls: 'custom' })
    window.objectDesktop = fake.bridge
    useSettings.setState({ settings: withButtons('sometimes'), loaded: true })
    render(<Shell />)
    await waitFor(() => expect(fake.bridge.setWindowButtons).toHaveBeenCalledWith('auto'))
  })

  test.each([
    ['win32', false],
    ['darwin', false],
    ['linux', true],
  ] as const)('test on %s (framed: %s) the setting is never applied', async (platform, framed) => {
    const fake = fakeDesktop({ platform, framed })
    window.objectDesktop = fake.bridge
    useSettings.setState({ settings: withButtons('show'), loaded: true })
    render(<Shell />)
    await applyWindowButtons('show')
    expect(fake.bridge.setWindowButtons).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  test('test the latest choice wins when answers come back out of order', async () => {
    const fake = fakeDesktop({ platform: 'linux', controls: 'custom' })
    const answers: ((v: 'custom' | 'none') => void)[] = []
    vi.mocked(fake.bridge.setWindowButtons).mockImplementation(() => new Promise((r) => answers.push(r)))
    window.objectDesktop = fake.bridge
    const first = applyWindowButtons('hide')
    const second = applyWindowButtons('show')
    answers[1]('custom')
    answers[0]('none')
    await Promise.all([first, second])
    expect(useChrome.getState().controls).toBe('custom')
  })
})

describe('desktop.css', () => {
  const css = readFileSync(join(process.cwd(), 'src/desktop/desktop.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].split(/,\s*\n/).map((s) => s.trim()), body: m[2] }))
  const IN_SHELL = /^html(\.desktop-(drag|controls-overlay|controls-traffic)|:is\(\.desktop-win32, \.desktop-darwin, \.desktop-linux\))/
  const bodies = (pick: (selector: string) => boolean) => rules.filter((r) => r.selectors.some(pick)).map((r) => r.body).join('\n')

  test('test every rule applies only inside the shell (a class on html)', () => {
    expect(rules.length).toBeGreaterThan(6)
    for (const r of rules) for (const s of r.selectors) expect(s, s).toMatch(IN_SHELL)
  })

  test('test the drag region and what stays clickable in it', () => {
    const drag = bodies((s) => s === 'html.desktop-drag .app-drag')
    expect(drag).toContain('-webkit-app-region: drag')
    expect(drag).toMatch(/\n\s*app-region: drag/)
    expect(drag).toContain('user-select: none')
    const noDrag = rules.find((r) => r.selectors.includes('html.desktop-drag .app-no-drag'))
    expect(noDrag?.body).toContain('-webkit-app-region: no-drag')
    expect(noDrag?.body).toMatch(/\n\s*app-region: no-drag/)
    const clickable = noDrag!.selectors.join(' ')
    for (const what of ['button', 'input', "[role='tab']", "[role='tablist']", 'a', 'select', 'textarea', '[tabindex]']) expect(clickable).toContain(what)
    // Menus, dialogs and tooltips open over the bar from the end of <body>: they take their clicks.
    const over = rules.find((r) => r.selectors.includes('html.desktop-drag body > :not(#root)'))
    expect(over?.body).toContain('app-region: no-drag')
    // Nothing drags without the class (the system's frame).
    for (const r of rules) if (r.body.includes('app-region')) for (const s of r.selectors) expect(s).toMatch(/^html\.desktop-drag /)
  })

  test('test the room kept free follows the controls, never the system', () => {
    // 'overlay': the top right corner, from the Window Controls Overlay values, 138px without them.
    const overlay = bodies((s) => s === 'html.desktop-controls-overlay .app-titlebar')
    expect(overlay).toContain('padding-right')
    expect(overlay).toContain('env(titlebar-area-width, calc(100vw - 138px))')
    expect(overlay).toContain('env(titlebar-area-x, 0px)')
    // 'traffic': 78px on the left for the traffic lights, not in full screen.
    const traffic = rules.filter((r) => r.selectors.some((s) => s.startsWith('html.desktop-controls-traffic')))
    expect(traffic.length).toBeGreaterThan(0)
    for (const r of traffic) for (const s of r.selectors) expect(s).toContain(':not(.desktop-fullscreen)')
    expect(traffic.map((r) => r.body).join('\n')).toContain('padding-left: 78px')
    // 'custom' and 'none' keep nothing free, and no padding hangs on a system's class.
    expect(css).not.toContain('desktop-controls-custom')
    expect(css).not.toContain('desktop-controls-none')
    for (const r of rules) {
      if (!/padding|width/.test(r.body.replace(/min-height[^;]*;/g, ''))) continue
      for (const s of r.selectors) expect(s).toMatch(/^html\.desktop-controls-(overlay|traffic)/)
    }
    // The bar is never lower than the controls need.
    expect(bodies((s) => s.endsWith('.desktop-linux) .app-titlebar'))).toContain('min-height: 42px')
  })

  test('test the window buttons take clicks while the rest of the bar is faded for typing', async () => {
    // `focus/TypingFade` turns pointer events off for everything in the fading bar, with
    // `!important`; the window buttons stay shown, so they must stay clickable. The rule here
    // has to win over that one: more specific, and `!important` too.
    const { TYPING_ATTR, TYPING_FADE_ATTR, TYPING_FADE_CSS } = await import('@/focus/TypingFade')
    const mine = rules.find((r) => r.selectors.some((s) => s.includes('[data-window-controls]')))
    expect(mine?.body).toMatch(/pointer-events: auto !important/)
    expect(mine?.selectors).toHaveLength(2)
    const attrs = (s: string) => (s.match(/\[[^\]]+\]/g) ?? []).length
    for (const s of mine!.selectors) {
      expect(s).toContain(`[${TYPING_ATTR}]`)
      expect(s).toContain(`[${TYPING_FADE_ATTR}]`)
      // The fade's own rule names two attributes; this one names three.
      expect(attrs(s)).toBe(3)
    }
    expect(mine!.selectors.some((s) => s.endsWith('[data-window-controls] *'))).toBe(true)
    expect(TYPING_FADE_CSS).toContain(`html[${TYPING_ATTR}] [${TYPING_FADE_ATTR}] * { pointer-events: none !important; }`)
  })
})
