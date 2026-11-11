import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { addDays, todayYmd } from '@/calendar/dates'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { takeBodyFocus } from '@/nav/focusRequest'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { TASK_TYPE, taskRow } from '@/tasks/taskFixtures'
import { objectSummary, typeDef } from '@/test/mockApi'
import { HOME_TEXT, HomePage, noteTypeId } from './HomePage'

const mocked = vi.mocked(api)
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const TASK = TASK_TYPE
const TAG = typeDef({ id: 'tag', name: 'Tag', pluralName: 'Tags', basic: true })
const DAILY = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true })
const MEETING = typeDef({ id: 'meeting', name: 'Meeting', pluralName: 'Meetings' })
const TYPES = [PAGE, TASK, TAG, DAILY, MEETING]

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString()
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function index(objects: ReturnType<typeof objectSummary>[], types = TYPES) {
  useLinkIndex.setState({ types, objects, loaded: true })
}

beforeEach(() => {
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
})

describe('HomePage (M32)', () => {
  test('test Home shows New note and Today’s note and writes nothing by showing', async () => {
    index([objectSummary({ path: 'Pages/A.md', lastUpdated: hoursAgo(1) })])
    mocked.rows.mockResolvedValue([])
    render(<HomePage types={TYPES} />)
    expect(screen.getByRole('button', { name: 'New note' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Today's note" })).toBeInTheDocument()
    expect(screen.queryByText('Pick an object type')).toBeNull()
    await screen.findByText(HOME_TEXT.noTasks)
    // Opening Home never writes a file: no create, no save, until a button is pressed.
    expect(mocked.createObject).not.toHaveBeenCalled()
    expect(mocked.createDailyNote).not.toHaveBeenCalled()
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    expect(mocked.saveBody).not.toHaveBeenCalled()
    expect(mocked.patchUi).not.toHaveBeenCalled()
    expect(mocked.patchSettings).not.toHaveBeenCalled()
  })

  test('test New note makes a note of the Page type and opens it in the tab', async () => {
    index([])
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

  test('test Today’s note makes (or finds) today’s daily note, shows it and asks for the caret at its end', async () => {
    index([])
    mocked.createDailyNote.mockResolvedValueOnce({ path: 'DailyNotes/today.md', version: 'v1', typeIds: [] })
    const user = userEvent.setup()
    render(<HomePage types={[PAGE]} />)
    await user.click(screen.getByRole('button', { name: "Today's note" }))
    await waitFor(() => expect(mocked.createDailyNote).toHaveBeenCalledWith(todayYmd()))
    await waitFor(() => expect(usePeek.getState().path).toBe('DailyNotes/today.md'))
    expect(takeBodyFocus('DailyNotes/today.md')).toBe('end')
  })

  test('test Recent lists the last 12 notes edited, newest first, daily notes in, tasks and tags out', async () => {
    const pages = Array.from({ length: 13 }, (_, i) =>
      objectSummary({ path: `Pages/P${i + 1}.md`, title: `P${i + 1}`, type: 'page', lastUpdated: daysAgo(i + 2) }),
    )
    index([
      ...pages,
      objectSummary({ path: 'DailyNotes/2026-11-11.md', title: 'Wed, Nov 11', type: 'dailynote', lastUpdated: hoursAgo(2) }),
      objectSummary({ path: 'Meetings/Standup.md', title: 'Standup', type: 'meeting', lastUpdated: hoursAgo(1) }),
      objectSummary({ path: 'Tasks/Call.md', title: 'Call the bank', type: 'task', lastUpdated: hoursAgo(0) }),
      objectSummary({ path: 'Tags/home.md', title: 'home', type: 'tag', lastUpdated: hoursAgo(0) }),
    ])
    mocked.rows.mockResolvedValue([])
    render(<HomePage types={TYPES} />)
    const recent = screen.getByRole('region', { name: 'Recent' })
    const rows = within(recent).getAllByRole('listitem')
    expect(rows).toHaveLength(12)
    expect(rows[0]).toHaveTextContent('Standup')
    expect(rows[0]).toHaveTextContent('Meeting')
    expect(rows[1]).toHaveTextContent('Wed, Nov 11')
    expect(rows[1]).toHaveTextContent('Daily note')
    expect(rows[2]).toHaveTextContent('P1')
    expect(rows[2]).toHaveTextContent('Note')
    expect(rows[11]).toHaveTextContent('P10')
    expect(within(recent).queryByText('Call the bank')).toBeNull()
    expect(within(recent).queryByText('home')).toBeNull()
    expect(within(recent).queryByText('P11')).toBeNull()
  })

  test('test a Recent row opens the note in the tab', async () => {
    index([objectSummary({ path: 'Pages/A.md', title: 'Alpha', lastUpdated: hoursAgo(1) })])
    mocked.rows.mockResolvedValue([])
    const user = userEvent.setup()
    render(<HomePage types={TYPES} />)
    await user.click(screen.getByRole('button', { name: /Alpha/ }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Pages/A.md' })
    expect(usePeek.getState().path).toBeNull()
  })

  test('test Tasks lists overdue and today, and the tick completes a task', async () => {
    const today = todayYmd()
    index([objectSummary({ path: 'Pages/A.md', lastUpdated: hoursAgo(1) })])
    const late = taskRow('Tasks/Late.md', { status: ['Not Started'], date: { start: addDays(today, -2), resolution: 'day' } })
    const due = taskRow('Tasks/Due.md', { status: ['Not Started'], date: { start: today, resolution: 'day' } })
    const later = taskRow('Tasks/Later.md', { status: ['Not Started'], date: { start: addDays(today, 3), resolution: 'day' } })
    const undated = taskRow('Tasks/Someday.md', { status: ['Not Started'] })
    mocked.rows.mockResolvedValue([due, later, late, undated])
    mocked.updateProperties.mockResolvedValue({ version: 'v2', frontmatter: {}, links: {}, synced: [], skipped: [] } as never)
    const user = userEvent.setup()
    render(<HomePage types={TYPES} />)
    const tasks = screen.getByRole('region', { name: 'Tasks' })
    const rows = await within(tasks).findAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-path'))).toEqual(['Tasks/Late.md', 'Tasks/Due.md'])
    expect(rows[0]).toHaveAttribute('data-overdue')
    expect(rows[1]).not.toHaveAttribute('data-overdue')
    expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['task'], preview: false })
    // The tick: one status write to the type's done option.
    await user.click(within(rows[1]).getByRole('checkbox'))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/Due.md', { status: ['Done'] }, 'v1'))
  })

  test('test no tasks for today: one quiet line; no Task type: the line and no rows asked for', async () => {
    index([objectSummary({ path: 'Pages/A.md', lastUpdated: hoursAgo(1) })])
    mocked.rows.mockResolvedValue([taskRow('Tasks/Someday.md', { status: ['Not Started'] })])
    const { unmount } = render(<HomePage types={TYPES} />)
    expect(await screen.findByText(HOME_TEXT.noTasks)).toBeInTheDocument()
    unmount()
    mocked.rows.mockClear()
    index([objectSummary({ path: 'Pages/A.md', lastUpdated: hoursAgo(1) })], [PAGE])
    render(<HomePage types={[PAGE]} />)
    expect(screen.getByText(HOME_TEXT.noTasks)).toBeInTheDocument()
    expect(mocked.rows).not.toHaveBeenCalled()
  })

  test('test Tasks is left out while the space hides task management', async () => {
    index([objectSummary({ path: 'Pages/A.md', title: 'Alpha', lastUpdated: hoursAgo(1) })])
    useSpaceInfo.setState({ space: { name: 's', root: '/s', types: TYPES, hideTaskManagement: true }, loaded: true })
    try {
      render(<HomePage types={TYPES} />)
      expect(screen.getByRole('region', { name: 'Recent' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Tasks' })).toBeNull()
      expect(mocked.rows).not.toHaveBeenCalled()
    } finally {
      resetSpaceInfo()
    }
  })

  test('test an empty space shows one friendly line and the two buttons', async () => {
    index([], [PAGE, DAILY])
    render(<HomePage types={[PAGE, DAILY]} />)
    expect(screen.getByText(HOME_TEXT.empty)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New note' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Today's note" })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Recent' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Tasks' })).toBeNull()
  })

  test('test noteTypeId is the Page type, else page', () => {
    expect(noteTypeId([TASK, PAGE])).toBe('page')
    expect(noteTypeId([typeDef({ id: 'p9', name: 'Page' })])).toBe('p9')
    expect(noteTypeId([])).toBe('page')
  })
})
