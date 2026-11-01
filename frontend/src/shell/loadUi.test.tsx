import { act, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { UiState } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useWeekStart } from '@/calendar/useCalendar'
import { useGraphUi } from '@/graph/useGraphUi'
import { NotificationsSection } from '@/settings/sections/Notifications'
import { resetPinned, usePinned, useUiStore } from './usePinned'

const mocked = vi.mocked(api)
const UI: UiState = { pinned: [], sections: [], allNotesLayout: 'list' }

function Consumers() {
  useWeekStart()
  useGraphUi()
  usePinned()
  return <NotificationsSection />
}

let answer: (v: { ui: UiState; revision: string }) => void = () => undefined

beforeEach(() => {
  resetPinned()
  mocked.ui.mockReset()
  mocked.ui.mockImplementation(() => new Promise((r) => (answer = r)))
})

test('everyone mounted before the first answer shares one GET /api/ui', async () => {
  render(
    <StrictMode>
      <Consumers />
      <Consumers />
    </StrictMode>,
  )
  expect(mocked.ui).toHaveBeenCalledTimes(1)
  await act(async () => answer({ ui: UI, revision: 'r1' }))
  expect(useUiStore.getState().loaded).toBe(true)
  expect(useUiStore.getState().revision).toBe('r1')
  expect(mocked.ui).toHaveBeenCalledTimes(1)
})

test('usePinned under StrictMode subscribes to change events once, and unsubscribes after the last consumer', async () => {
  let active = 0
  mocked.onChange.mockReset()
  mocked.onChange.mockImplementation(() => {
    active += 1
    return () => {
      active -= 1
    }
  })
  mocked.ui.mockResolvedValue({ ui: UI, revision: 'r1' })
  function Pins() {
    usePinned()
    return null
  }
  const { unmount } = render(
    <StrictMode>
      <Pins />
      <Pins />
    </StrictMode>,
  )
  await act(async () => undefined)
  expect(mocked.onChange).toHaveBeenCalledTimes(1)
  expect(active).toBe(1)
  expect(mocked.ui).toHaveBeenCalledTimes(1)
  unmount()
  await act(async () => undefined)
  expect(active).toBe(0)
})
