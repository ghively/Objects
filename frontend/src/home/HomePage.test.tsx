import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { todayYmd } from '@/calendar/dates'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { typeDef } from '@/test/mockApi'
import { HomePage, noteTypeId } from './HomePage'

const mocked = vi.mocked(api)
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
})

describe('HomePage (M32 contract stub)', () => {
  test('test Home shows New note and Today’s note and reads or writes nothing by showing', () => {
    render(<HomePage types={[TASK, PAGE]} />)
    expect(screen.getByRole('button', { name: 'New note' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Today's note" })).toBeInTheDocument()
    expect(screen.queryByText('Pick an object type')).toBeNull()
    expect(mocked.createObject).not.toHaveBeenCalled()
    expect(mocked.createDailyNote).not.toHaveBeenCalled()
  })

  test('test New note makes a note of the Page type and opens it in the tab', async () => {
    mocked.createObject.mockResolvedValueOnce({ path: 'Pages/Untitled.md', version: 'v1' })
    const user = userEvent.setup()
    render(<HomePage types={[TASK, PAGE]} />)
    await user.click(screen.getByRole('button', { name: 'New note' }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('page', {}))
    await waitFor(() =>
      expect(useTabs.getState().tabs[0]?.history.at(-1)).toEqual({ kind: 'object', path: 'Pages/Untitled.md' }),
    )
    expect(usePeek.getState().path).toBeNull()
  })

  test('test Today’s note makes (or finds) today’s daily note and shows it', async () => {
    mocked.createDailyNote.mockResolvedValueOnce({ path: 'DailyNotes/today.md', version: 'v1', typeIds: [] })
    const user = userEvent.setup()
    render(<HomePage types={[PAGE]} />)
    await user.click(screen.getByRole('button', { name: "Today's note" }))
    await waitFor(() => expect(mocked.createDailyNote).toHaveBeenCalledWith(todayYmd()))
    await waitFor(() => expect(usePeek.getState().path).toBe('DailyNotes/today.md'))
  })

  test('test noteTypeId is the Page type, else page', () => {
    expect(noteTypeId([TASK, PAGE])).toBe('page')
    expect(noteTypeId([typeDef({ id: 'p9', name: 'Page' })])).toBe('p9')
    expect(noteTypeId([])).toBe('page')
  })
})
