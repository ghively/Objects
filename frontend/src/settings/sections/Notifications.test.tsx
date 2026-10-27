import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { resetPinned, useUiStore } from '@/shell/usePinned'
import { NotificationsSection } from './Notifications'

const mocked = vi.mocked(api)
const UI = { pinned: [], sections: [], allNotesLayout: 'list' as const }

beforeEach(() => {
  vi.clearAllMocks()
  resetPinned()
})

describe('NotificationsSection', () => {
  test('test notifications switch patches ui.json reminders.enabled', async () => {
    const user = userEvent.setup()
    mocked.ui.mockResolvedValue({ ui: UI, revision: 'u1' })
    render(<NotificationsSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByText('Notifications only work while Object is open')).toBeInTheDocument()
    await waitFor(() => expect(useUiStore.getState().loaded).toBe(true))
    // Absent means on (M4's default).
    const sw = screen.getByRole('switch', { name: 'Activate notifications' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await user.click(sw)
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalledWith({ reminders: { enabled: false } }, { baseRevision: 'u1' }))
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(useUiStore.getState().ui.reminders).toEqual({ enabled: false })
  })

  test('test a 409 reloads ui.json and re-applies the switch once', async () => {
    const user = userEvent.setup()
    mocked.ui.mockResolvedValueOnce({ ui: UI, revision: 'u1' }).mockResolvedValueOnce({ ui: { ...UI, reminders: { enabled: true } }, revision: 'u2' })
    mocked.patchUi.mockRejectedValueOnce(new ConflictError('u2'))
    render(<NotificationsSection />)
    await waitFor(() => expect(useUiStore.getState().loaded).toBe(true))
    await user.click(screen.getByRole('switch', { name: 'Activate notifications' }))
    await waitFor(() => expect(mocked.patchUi).toHaveBeenLastCalledWith({ reminders: { enabled: false } }, { baseRevision: 'u2' }))
    expect(mocked.patchUi).toHaveBeenCalledTimes(2)
    expect(useUiStore.getState().ui.reminders).toEqual({ enabled: false })
  })
})
