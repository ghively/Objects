import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import { resetChrome, useChrome } from './useWindowChrome'
import { WindowControls } from './WindowControls'

function Shell() {
  return (
    <>
      <TopBar spaceName="space" onToggleSidebar={() => {}} onToggleRightPanel={() => {}} rightPanelOpen={false} onNewTab={() => {}} />
      <DesktopChrome />
    </>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  resetChrome()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

afterEach(() => {
  delete window.objectDesktop
})

describe('WindowControls', () => {
  test('test custom controls draw Minimize, Maximize and Close, and each asks the window', async () => {
    const user = userEvent.setup()
    const fake = fakeDesktop({ platform: 'linux', controls: 'custom' })
    window.objectDesktop = fake.bridge
    render(<Shell />)
    const group = screen.getByRole('group', { name: 'Window' })
    const names = within(group)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['Minimize', 'Maximize', 'Close'])
    for (const b of within(group).getAllByRole('button')) expect(b).toHaveAttribute('title', b.getAttribute('aria-label'))

    await user.click(within(group).getByRole('button', { name: 'Minimize' }))
    expect(fake.bridge.minimize).toHaveBeenCalledTimes(1)
    await user.click(within(group).getByRole('button', { name: 'Maximize' }))
    expect(fake.bridge.toggleMaximize).toHaveBeenCalledTimes(1)
    await user.click(within(group).getByRole('button', { name: 'Close' }))
    expect(fake.bridge.close).toHaveBeenCalledTimes(1)
  })

  test('test Maximize reads Restore while the window is maximised', async () => {
    const user = userEvent.setup()
    const fake = fakeDesktop({ platform: 'linux', controls: 'custom' })
    window.objectDesktop = fake.bridge
    render(<Shell />)
    expect(screen.getByRole('button', { name: 'Maximize' })).toHaveAttribute('title', 'Maximize')
    act(() => fake.emitWindowState({ maximized: true, fullScreen: false }))
    expect(screen.queryByRole('button', { name: 'Maximize' })).toBeNull()
    const restore = screen.getByRole('button', { name: 'Restore' })
    expect(restore).toHaveAttribute('title', 'Restore')
    await user.click(restore)
    expect(fake.bridge.toggleMaximize).toHaveBeenCalledTimes(1)
    act(() => fake.emitWindowState({ maximized: false, fullScreen: false }))
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeInTheDocument()
  })

  test('test the close button takes the danger colour on hover', () => {
    window.objectDesktop = fakeDesktop({ platform: 'linux', controls: 'custom' }).bridge
    render(<Shell />)
    // The box that is seen takes the colour while the pointer is anywhere on the button.
    expect(screen.getByRole('button', { name: 'Close' }).firstElementChild).toHaveClass('group-hover:bg-danger', 'group-hover:text-white')
    expect(screen.getByRole('button', { name: 'Minimize' }).firstElementChild).not.toHaveClass('group-hover:bg-danger')
    expect(screen.getByRole('button', { name: 'Minimize' }).firstElementChild).toHaveClass('group-hover:bg-hover')
  })

  test('test the buttons fill the bar to its top and to the window edge: the corner closes', () => {
    window.objectDesktop = fakeDesktop({ platform: 'linux', controls: 'custom' }).bridge
    render(<Shell />)
    const group = screen.getByRole('group', { name: 'Window' })
    // Full height of the bar, and over the bar's own right padding.
    expect(group).toHaveClass('self-stretch', 'items-stretch', '-mr-2', 'app-no-drag')
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('pr-2')
  })

  test('test the buttons keep to the window\'s right end when the tabs are hidden (focus mode)', () => {
    window.objectDesktop = fakeDesktop({ platform: 'linux', controls: 'custom' }).bridge
    render(<Shell />)
    // Focus mode hides the tab strip, the bar's only part that grows: the free room then goes
    // before the window buttons, never after them. The gap to the bar's last button is inside
    // the group, so it stays when there is no free room.
    const group = screen.getByRole('group', { name: 'Window' })
    expect(group).toHaveClass('ml-auto', 'pl-1.5')
    expect(group).not.toHaveClass('ml-1.5')
  })

  test('test the buttons are reachable by keyboard and last in the bar', () => {
    window.objectDesktop = fakeDesktop({ platform: 'linux', controls: 'custom' }).bridge
    render(<Shell />)
    const bar = screen.getByRole('banner')
    const focusable = [...bar.querySelectorAll<HTMLElement>('button, [tabindex]')].filter((el) => el.tabIndex >= 0)
    expect(focusable.slice(-3).map((b) => b.getAttribute('aria-label'))).toEqual(['Minimize', 'Maximize', 'Close'])
    // No positive tabindex anywhere: the order is the row's own.
    expect(focusable.every((el) => el.tabIndex === 0)).toBe(true)
    expect(bar.lastElementChild).toBe(screen.getByRole('group', { name: 'Window' }))
    // They stay while the rest of the bar fades for typing, as the system's own buttons do.
    expect(bar.lastElementChild).toHaveAttribute('data-typing-stay')
  })

  test.each([
    ['win32', 'overlay'],
    ['darwin', 'traffic'],
    ['linux', 'none'],
    ['win32', 'none'],
  ] as const)('test %s with %s controls draws nothing', (platform, controls) => {
    window.objectDesktop = fakeDesktop({ platform, controls }).bridge
    render(<Shell />)
    expect(screen.queryByRole('group', { name: 'Window' })).toBeNull()
    for (const name of ['Minimize', 'Maximize', 'Restore', 'Close']) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  test('test nothing is drawn in a browser, whatever the store says', () => {
    useChrome.setState({ controls: 'custom' })
    render(<WindowControls />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('test the buttons come and go with the controls in force', () => {
    window.objectDesktop = fakeDesktop({ platform: 'linux', controls: 'custom' }).bridge
    render(<Shell />)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    act(() => useChrome.setState({ controls: 'none' }))
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    act(() => useChrome.setState({ controls: 'custom' }))
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  test('test without the chrome mounted the bridge alone decides', () => {
    window.objectDesktop = fakeDesktop({ platform: 'linux', controls: 'custom' }).bridge
    render(<WindowControls />)
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Minimize', 'Maximize', 'Close'])
  })
})
