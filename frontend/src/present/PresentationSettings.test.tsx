// M8 Task 9: "Presentation settings" save to the device settings' `presentation` key.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { PRESENTATION_SETTINGS_TEXT as T, PresentationSettings, PresentationSettingsPanel } from './PresentationSettings'

const mocked = vi.mocked(api)

beforeEach(() => {
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
  vi.mocked(mocked.patchSettings).mockClear()
})

describe('PresentationSettings', () => {
  test('test presentation settings save', async () => {
    const user = userEvent.setup()
    render(<PresentationSettingsPanel />)
    for (const k of ['hideCoverImage', 'hideProgressIndicator', 'hideTitle'] as const) {
      expect(screen.getByText(T[k].heading)).toBeTruthy()
      expect(screen.getByText(T[k].description)).toBeTruthy()
    }
    await user.click(screen.getByRole('switch', { name: T.hideCoverImage.heading }))
    await waitFor(() => expect(mocked.patchSettings).toHaveBeenCalledTimes(1))
    expect(vi.mocked(mocked.patchSettings).mock.calls[0][0]).toEqual({
      presentation: { ...settingsDefaults.presentation, hideCoverImage: true },
    })
    expect(useSettings.getState().settings.presentation.hideCoverImage).toBe(true)

    const left = screen.getByRole('textbox', { name: T.left.heading })
    expect(left.getAttribute('placeholder')).toBe(T.left.placeholder)
    await user.type(left, 'Acme')
    expect(mocked.patchSettings).toHaveBeenCalledTimes(1) // saved on commit, not per key
    fireEvent.blur(left)
    await waitFor(() => expect(mocked.patchSettings).toHaveBeenCalledTimes(2))
    expect(vi.mocked(mocked.patchSettings).mock.calls[1][0]).toEqual({
      presentation: { ...settingsDefaults.presentation, hideCoverImage: true, footerLeft: 'Acme' },
    })
    const right = screen.getByRole('textbox', { name: T.right.heading })
    await user.type(right, 'Confidential{Enter}')
    await waitFor(() => expect(mocked.patchSettings).toHaveBeenCalledTimes(3))
    expect(useSettings.getState().settings.presentation.footerRight).toBe('Confidential')
  })

  test('the header button opens the popover', async () => {
    const user = userEvent.setup()
    render(<PresentationSettings />)
    await user.click(screen.getByRole('button', { name: T.heading }))
    expect(await screen.findByText(T.preferences)).toBeTruthy()
    expect(screen.getByText(T.footer)).toBeTruthy()
    expect(screen.queryByText(/watermark/i)).toBeNull()
  })
})
