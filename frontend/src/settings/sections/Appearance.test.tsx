import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { appIconHref } from '@/settings/appIcon'
import { DesktopChrome } from '@/desktop/DesktopChrome'
import { fakeDesktop } from '@/desktop/testBridge'
import { resetChrome, useChrome } from '@/desktop/useWindowChrome'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { TopBar } from '@/shell/TopBar'
import { APPEARANCE_SEARCH, AppearanceSection } from './Appearance'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

describe('AppearanceSection', () => {
  test('test appearance controls patch device settings', async () => {
    const user = userEvent.setup()
    render(<AppearanceSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByText('Themes, fonts and colors.')).toBeInTheDocument()

    // Theme mode: Light / Dark.
    const mode = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(within(mode).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(mode).getByRole('radio', { name: 'Light' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ themeMode: 'light' }, { baseRevision: 'r0' })
    expect(useSettings.getState().settings.themeMode).toBe('light')

    // The light and dark themes, with their descriptions.
    const light = screen.getByRole('radiogroup', { name: 'Light theme' })
    expect(within(light).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Light', 'Light Dimmed'])
    expect(within(light).getByText('Light, with softer contrast.')).toBeInTheDocument()
    await user.click(within(light).getByRole('radio', { name: 'Light Dimmed' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ lightTheme: 'lightDimmed' }, expect.anything())

    const dark = screen.getByRole('radiogroup', { name: 'Dark theme' })
    expect(within(dark).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Dark', 'Dark Dimmed'])
    await user.click(within(dark).getByRole('radio', { name: 'Dark Dimmed' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ darkTheme: 'darkDimmed' }, expect.anything())

    // Font.
    const font = screen.getByRole('radiogroup', { name: 'Font' })
    expect(within(font).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Sans Serif', 'Serif', 'Monospace'])
    expect(within(font).getByText('Georgia, an easy-to-read serif face.')).toBeInTheDocument()
    await user.click(within(font).getByRole('radio', { name: 'Monospace' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ font: 'monospace' }, expect.anything())

    // Monochrome switches.
    expect(screen.getByRole('heading', { name: 'Colors' })).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Monochrome type labels' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ monochromeTypeLabels: true }, expect.anything())
    await user.click(screen.getByRole('switch', { name: 'Monochrome tags' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ monochromeTags: true }, expect.anything())
    expect(useSettings.getState().settings).toMatchObject({
      themeMode: 'light',
      lightTheme: 'lightDimmed',
      darkTheme: 'darkDimmed',
      font: 'monospace',
      monochromeTypeLabels: true,
      monochromeTags: true,
    })
  })

  test('test text size zooms in and out in 5% steps and resets', async () => {
    const user = userEvent.setup()
    render(<AppearanceSection />)
    const group = screen.getByRole('group', { name: 'Text size' })
    expect(within(group).getByText('100%')).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Reset zoom' })).toBeDisabled()
    await user.click(within(group).getByRole('button', { name: 'Zoom in' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ zoom: 1.05 }, expect.anything())
    expect(within(group).getByText('105%')).toBeInTheDocument()
    await user.click(within(group).getByRole('button', { name: 'Zoom out' }))
    await user.click(within(group).getByRole('button', { name: 'Zoom out' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ zoom: 0.95 }, expect.anything())
    await user.click(within(group).getByRole('button', { name: 'Reset zoom' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ zoom: 1 }, expect.anything())
  })

  test('test text size buttons stop at the ends of the range', () => {
    useSettings.setState({ settings: { ...settingsDefaults, zoom: 1.45 } })
    render(<AppearanceSection />)
    const group = screen.getByRole('group', { name: 'Text size' })
    expect(within(group).getByRole('button', { name: 'Zoom in' })).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'Zoom out' })).toBeEnabled()
  })

  test('test the four theme descriptions read as one style', () => {
    render(<AppearanceSection />)
    const light = screen.getByRole('radiogroup', { name: 'Light theme' })
    const dark = screen.getByRole('radiogroup', { name: 'Dark theme' })
    expect(within(light).getByText('The standard light theme.')).toBeInTheDocument()
    expect(within(light).getByText('Light, with softer contrast.')).toBeInTheDocument()
    expect(within(dark).getByText('The standard dark theme.')).toBeInTheDocument()
    expect(within(dark).getByText('Dark, with softer contrast.')).toBeInTheDocument()
  })

  test('test app icon swatches pick a colour per device', async () => {
    const user = userEvent.setup()
    render(<AppearanceSection />)
    const group = screen.getByRole('radiogroup', { name: 'App icon' })
    expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Default',
      'Red',
      'Orange',
      'Green',
      'Blue',
      'Purple',
      'Pink',
      'Gray',
    ])
    expect(within(group).getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true')
    // Each swatch shows the icon in its colour.
    const red = within(group).getByRole('radio', { name: 'Red' })
    expect(red.querySelector('img')?.getAttribute('src')).toBe(appIconHref('red'))
    await user.click(red)
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ appIcon: 'red' }, { baseRevision: 'r0' })
    expect(within(group).getByRole('radio', { name: 'Red' })).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.getByText("The color of Object's icon on this device: the browser tab at once, the app window from the next start."),
    ).toBeInTheDocument()
    expect(APPEARANCE_SEARCH).toContain('App icon')
  })

})

// M33: the desktop window on Linux draws its own buttons; the setting says whether.
describe('AppearanceSection: Window buttons', () => {
  beforeEach(() => {
    resetChrome()
    resetSpaceInfo()
  })
  afterEach(() => {
    delete window.objectDesktop
  })

  const stored = () => (useSettings.getState().settings as { windowButtons?: string }).windowButtons

  test('test in a browser there is no Window buttons setting', () => {
    render(<AppearanceSection />)
    expect(screen.queryByText('Window buttons')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Window buttons' })).toBeNull()
    expect(APPEARANCE_SEARCH).not.toContain('Window buttons')
  })

  test.each(['win32', 'darwin'] as const)('test in the desktop window on %s there is none either: the system draws its own', (platform) => {
    window.objectDesktop = fakeDesktop({ platform }).bridge
    render(<AppearanceSection />)
    expect(screen.queryByRole('radiogroup', { name: 'Window buttons' })).toBeNull()
  })

  test('test with the system frame on Linux there is none: the frame has the buttons', () => {
    window.objectDesktop = fakeDesktop({ platform: 'linux', framed: true }).bridge
    render(<AppearanceSection />)
    expect(screen.queryByRole('radiogroup', { name: 'Window buttons' })).toBeNull()
  })

  test('test in the desktop window on Linux: Automatic, Show, Hide; a change is stored and the buttons go and come at once', async () => {
    const user = userEvent.setup()
    const fake = fakeDesktop({ platform: 'linux', controls: 'custom' })
    window.objectDesktop = fake.bridge
    render(
      <>
        <TopBar spaceName="space" onToggleSidebar={() => {}} onToggleRightPanel={() => {}} rightPanelOpen={false} />
        <DesktopChrome />
        <AppearanceSection />
      </>,
    )
    const group = screen.getByRole('radiogroup', { name: 'Window buttons' })
    expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Automatic', 'Show', 'Hide'])
    // No stored value (an older settings file), or the default: Automatic.
    expect(stored() ?? 'auto').toBe('auto')
    expect(within(group).getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('heading', { name: 'Window buttons' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()

    await user.click(within(group).getByRole('radio', { name: 'Hide' }))
    expect(fake.bridge.setWindowButtons).toHaveBeenLastCalledWith('hide')
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ windowButtons: 'hide' }, expect.anything())
    expect(stored()).toBe('hide')
    expect(within(group).getByRole('radio', { name: 'Hide' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close' })).toBeNull())
    expect(useChrome.getState().controls).toBe('none')

    await user.click(within(group).getByRole('radio', { name: 'Show' }))
    expect(fake.bridge.setWindowButtons).toHaveBeenLastCalledWith('show')
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ windowButtons: 'show' }, expect.anything())
    expect(await screen.findByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeInTheDocument()

    await user.click(within(group).getByRole('radio', { name: 'Automatic' }))
    expect(fake.bridge.setWindowButtons).toHaveBeenLastCalledWith('auto')
    expect(stored()).toBe('auto')
  })

  test('test Automatic on a tiling compositor: no buttons until Show', async () => {
    const user = userEvent.setup()
    const fake = fakeDesktop({ platform: 'linux', controls: 'none' })
    window.objectDesktop = fake.bridge
    render(
      <>
        <TopBar spaceName="space" onToggleSidebar={() => {}} onToggleRightPanel={() => {}} rightPanelOpen={false} />
        <DesktopChrome />
        <AppearanceSection />
      </>,
    )
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'Show' }))
    expect(await screen.findByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})
