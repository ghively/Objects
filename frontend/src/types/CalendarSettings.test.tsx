import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TypeDef } from '@/api/types'
import { defaultViews, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { PropertySettings } from '@/properties/PropertySettings'
import { buildSections } from './dashboardSections'
import { TypeOverview } from './TypeOverview'
import { TypeSettings } from './TypeSettings'

const mocked = vi.mocked(api)

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const dateProp = (key: string) => propertyDef({ id: key, key, name: key, type: 'datetime' })
const MEETING = typeDef({ id: 'meeting', name: 'Meeting', revision: 'rm', propertyDefinitions: [TITLE, dateProp('when')] })
const PROJECT = typeDef({ id: 'project', name: 'Project', revision: 'rp', propertyDefinitions: [TITLE] })
const TASK = typeDef({ id: 'task', name: 'Task', basic: true, revision: 'rt', propertyDefinitions: [TITLE, dateProp('date')] })
const DAILYNOTE = typeDef({
  id: 'dailynote',
  name: 'DailyNote',
  pluralName: 'DailyNotes',
  basic: true,
  revision: 'rd',
  propertyDefinitions: [TITLE, dateProp('date'), propertyDef({ id: 'reviewed', key: 'reviewed', name: 'Reviewed', type: 'boolean' })],
})

function savedType(call = 0): TypeDef {
  return mocked.saveType.mock.calls[call][0]
}

beforeEach(() => {
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  useLinkIndex.setState({ types: [MEETING, PROJECT, TASK, DAILYNOTE], objects: [], loaded: true })
})

describe('Calendar settings', () => {
  test('test calendar group only for types with a date property; not for Task or DailyNote', () => {
    const { unmount } = render(<TypeSettings typeId="meeting" />)
    const group = screen.getByRole('region', { name: 'Calendar' })
    expect(within(group).getByRole('heading', { level: 3 })).toHaveTextContent('Calendar')
    expect(within(group).getByText('Calendar Settings')).toBeInTheDocument()
    expect(
      within(group).getByText(
        'This object type has a date property. It is therefore integrated in the calendar. You can select your preferences here.',
      ),
    ).toBeInTheDocument()
    expect(within(group).getByText('Create object from calendar')).toBeInTheDocument()
    expect(within(group).getByText('Hide object in calendar sidebar')).toBeInTheDocument()
    unmount()
    for (const id of ['project', 'task', 'dailynote']) {
      const r = render(<TypeSettings typeId={id} />)
      expect(screen.queryByRole('region', { name: 'Calendar' })).not.toBeInTheDocument()
      r.unmount()
    }
  })

  test('test create-from-calendar choices write createInCalendarOption (absent, createOnce, disabled)', async () => {
    const user = userEvent.setup()
    render(<TypeSettings typeId="meeting" />)
    const choices = screen.getByRole('group', { name: 'Create object from calendar' })
    expect(within(choices).getAllByRole('button').map((b) => b.textContent)).toEqual(['Show', 'Show for one per day', 'Hide'])
    expect(within(choices).getByRole('button', { name: 'Show' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(choices).getByRole('button', { name: 'Show for one per day' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    expect(savedType(0).createInCalendarOption).toBe('createOnce')
    expect(mocked.saveType.mock.calls[0][1]).toEqual({ baseRevision: 'rm' })
    await user.click(within(screen.getByRole('group', { name: 'Create object from calendar' })).getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(2))
    expect(savedType(1).createInCalendarOption).toBe('disabled')
    await user.click(within(screen.getByRole('group', { name: 'Create object from calendar' })).getByRole('button', { name: 'Show' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(3))
    expect('createInCalendarOption' in savedType(2)).toBe(false)
  })

  test('test hide in sidebar switch writes hideFromCalendarSidebar', async () => {
    const user = userEvent.setup()
    render(<TypeSettings typeId="meeting" />)
    const sw = screen.getByRole('switch', { name: 'Hide object in calendar sidebar' })
    expect(sw).not.toBeChecked()
    await user.click(sw)
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    expect(savedType().hideFromCalendarSidebar).toBe(true)
    expect(savedType().propertyDefinitions).toEqual(MEETING.propertyDefinitions)
  })

  test('test date property Hide in calendar writes hideCalendarEvents', async () => {
    const user = userEvent.setup()
    render(<PropertySettings typeId="meeting" propertyId="when" open onOpenChange={vi.fn()} />)
    const sw = screen.getByRole('switch', { name: 'Hide in calendar' })
    expect(sw).not.toBeChecked()
    await user.click(sw)
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    const def = savedType().propertyDefinitions.find((d) => d.id === 'when')
    expect(def?.options.hideCalendarEvents).toBe(true)
  })

  test('test Reviewing hide writes hideReviewing and hides the Unreviewed section', async () => {
    const user = userEvent.setup()
    render(<TypeSettings typeId="dailynote" />)
    const group = screen.getByRole('region', { name: 'Reviewing' })
    expect(within(group).getByText('Daily notes can be marked as reviewed. Hide this if you do not use reviewing.')).toBeInTheDocument()
    expect(buildSections(DAILYNOTE, defaultViews(), { collections: [], queries: [] }).map((s) => s.key)).toContain('unreviewed')
    await user.click(within(group).getByRole('switch', { name: 'Hide reviewing' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    expect(savedType().hideReviewing).toBe(true)
    expect(buildSections(savedType(), defaultViews(), { collections: [], queries: [] }).map((s) => s.key)).not.toContain('unreviewed')
    // Other types have no Reviewing group.
    expect(screen.queryAllByRole('region', { name: 'Reviewing' })).toHaveLength(1)
  })
})

describe('DailyNote Overview', () => {
  test('the Unreviewed section renders unreviewed notes as a list, newest first', async () => {
    const note = (day: string, reviewed: boolean) =>
      row({
        summary: objectSummary({ path: `DailyNotes/${day}.md`, type: 'dailynote', title: day }),
        values: { reviewed, date: { start: day, resolution: 'day' } },
      })
    mocked.rows.mockResolvedValue([note('2026-10-20', false), note('2026-10-22', true), note('2026-10-24', false)])
    const sections = buildSections(DAILYNOTE, defaultViews(), { collections: [], queries: [] })
    render(<TypeOverview type={DAILYNOTE} sections={sections} ctx={{ collections: [], queries: [] }} search="" update={vi.fn()} />)
    const section = screen.getByRole('region', { name: 'Unreviewed' })
    await waitFor(() => expect(within(section).getByText('2026-10-24')).toBeInTheDocument())
    expect(within(section).queryByText('2026-10-22')).not.toBeInTheDocument()
    const a = within(section).getByText('2026-10-24')
    const b = within(section).getByText('2026-10-20')
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
