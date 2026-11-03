import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { AppearanceSection } from './Appearance'

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
    expect(screen.getByText('Adjust the appearance of the app.')).toBeInTheDocument()

    // Theme mode: Light / Dark.
    const mode = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(within(mode).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(mode).getByRole('radio', { name: 'Light' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ themeMode: 'light' }, { baseRevision: 'r0' })
    expect(useSettings.getState().settings.themeMode).toBe('light')

    // The light and dark themes, with their descriptions.
    const light = screen.getByRole('radiogroup', { name: 'Light theme' })
    expect(within(light).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Light', 'Light Dimmed'])
    expect(within(light).getByText('A light theme with a dimmed contrast')).toBeInTheDocument()
    await user.click(within(light).getByRole('radio', { name: 'Light Dimmed' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ lightTheme: 'lightDimmed' }, expect.anything())

    const dark = screen.getByRole('radiogroup', { name: 'Dark theme' })
    expect(within(dark).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Dark', 'Dark Dimmed'])
    await user.click(within(dark).getByRole('radio', { name: 'Dark Dimmed' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ darkTheme: 'darkDimmed' }, expect.anything())

    // Font.
    const font = screen.getByRole('radiogroup', { name: 'Font' })
    expect(within(font).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Sans Serif', 'Serif', 'Monospace'])
    expect(within(font).getByText('Georgia – a classic serif typeface with good readability.')).toBeInTheDocument()
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
})
