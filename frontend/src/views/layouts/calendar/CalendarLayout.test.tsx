import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

let dragEnd: ((e: unknown) => unknown) | undefined
vi.mock('@dnd-kit/core', async (orig) => {
  const real = await orig<typeof import('@dnd-kit/core')>()
  return {
    ...real,
    DndContext: (p: { onDragEnd?: (e: unknown) => void } & Record<string, unknown>) => {
      dragEnd = p.onDragEnd
      return <real.DndContext {...(p as object)} />
    },
  }
})
vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { zonedWallToInstant } from '@/lib/zonedShell'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek } from '@/nav/tabs'
import { DataView } from '../../DataView'
import { emptyFilterGroup } from '../../model'
import { CalendarSettings } from '../CalendarLayout'

const mocked = vi.mocked(api)

const TASK = typeDef({
  id: 'task',
  name: 'Task',
  pluralName: 'Tasks',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({ id: 'due', type: 'datetime', name: 'Due' }),
    propertyDef({ id: 'start', type: 'datetime', name: 'Start' }),
  ],
})

const mk = (name: string, values: Record<string, unknown>, extra: Partial<Row['summary']> = {}): Row =>
  row({ summary: objectSummary({ path: `Tasks/${name}.md`, type: 'task', title: name, ...extra }), values })
const day = (d: string) => ({ start: d, resolution: 'day' })

// The view shows its empty state when no row survives (DataView's rule), so "empty" calendars hold one undated row.
const UNDATED = [mk('Z', {})]

const view = (cfg?: ViewState['viewDefinition']['calendarConfig']): ViewState => ({
  viewDefinition: { dataViewLayout: 'calendar', ...(cfg ? { calendarConfig: cfg } : {}) },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
})

function Harness({ rows, init = view(), onCreate, patchRow }: { rows: Row[]; init?: ViewState; onCreate?: (v: Record<string, unknown>, t: string) => void; patchRow?: (p: string, r: Row) => void }) {
  const [state, setState] = useState(init)
  return (
    <DataView
      rows={rows}
      types={[TASK]}
      scope={{ typeIds: ['task'] }}
      state={state}
      onState={setState}
      layouts={['list', 'calendar']}
      allowCreate={!!onCreate}
      onCreate={onCreate}
      patchRow={patchRow}
    />
  )
}

const cellOf = (d: string) => screen.getAllByTestId('calendar-day').find((c) => c.getAttribute('data-day') === d)!
const chipsOn = (d: string) => within(cellOf(d)).queryAllByTestId('calendar-chip')
const title = () => screen.getByTestId('calendar-title').textContent
const drop = (path: string, from: string, to: string) =>
  act(async () => {
    await dragEnd?.({ active: { id: `${from}\n${path}`, data: { current: { path, day: from } } }, over: { id: `day:${to}` } })
  })

beforeEach(() => {
  // Thursday, November 5, 2026; weeks start on Sunday (no `ui.calendar`).
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 5, 12) })
  resetLinkIndex()
  usePeek.getState().close()
  vi.clearAllMocks()
  dragEnd = undefined
})
afterEach(() => {
  vi.useRealTimers()
})

describe('CalendarLayout placement', () => {
  test('a single date sits on its day only; the first date property is the default', () => {
    render(<Harness rows={[mk('A', { due: day('2026-11-10') })]} />)
    expect(screen.getByTestId('calendar-layout').getAttribute('data-property')).toBe('due')
    expect(chipsOn('2026-11-10').map((c) => c.textContent)).toEqual(['A'])
    expect(screen.getAllByTestId('calendar-chip')).toHaveLength(1)
  })

  test('a range sits on every day it covers', () => {
    render(<Harness rows={[mk('R', { due: { start: '2026-11-10', end: '2026-11-12', resolution: 'day' } })]} />)
    expect(screen.getAllByTestId('calendar-chip').map((c) => c.getAttribute('data-day'))).toEqual(['2026-11-10', '2026-11-11', '2026-11-12'])
  })

  test('rows without the date are counted in "No date (N)", which lists them', async () => {
    const user = userEvent.setup()
    render(<Harness rows={[mk('A', { due: day('2026-11-10') }), mk('B', { due: null }), mk('C', {})]} />)
    const tray = screen.getByTestId('calendar-no-date')
    expect(tray.textContent).toBe('No date (2)')
    await user.click(tray)
    const list = await screen.findByTestId('calendar-no-date-list')
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('data-path'))).toEqual(['Tasks/B.md', 'Tasks/C.md'])
  })

  test('no "No date" button when every row has the date', () => {
    render(<Harness rows={[mk('A', { due: day('2026-11-10') })]} />)
    expect(screen.queryByTestId('calendar-no-date')).toBeNull()
  })

  test('the saved date property places the rows', () => {
    render(<Harness rows={[mk('A', { due: day('2026-11-10'), start: day('2026-11-02') })]} init={view({ dateProperty: 'start', mode: 'month' })} />)
    expect(chipsOn('2026-11-02')).toHaveLength(1)
    expect(chipsOn('2026-11-10')).toHaveLength(0)
  })

  test('a day shows 4 chips, then "+N more", which lists the whole day', async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 6 }, (_, i) => mk(`T${i}`, { due: day('2026-11-12') }))
    render(<Harness rows={rows} />)
    expect(chipsOn('2026-11-12')).toHaveLength(4)
    const more = within(cellOf('2026-11-12')).getByTestId('calendar-more')
    expect(more.textContent).toBe('+2 more')
    await user.click(more)
    const list = await screen.findByTestId('calendar-more-list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(6)
    expect(within(list).getByText('November 12, 2026')).toBeTruthy()
  })
})

describe('CalendarLayout modes and paging', () => {
  test('month mode: the weeks of the month from the week start', () => {
    render(<Harness rows={UNDATED} />)
    expect(title()).toBe('November 2026')
    const cells = screen.getAllByTestId('calendar-day')
    expect(cells).toHaveLength(35)
    expect(cells[0].getAttribute('data-day')).toBe('2026-11-01')
    expect(cellOf('2026-11-05').getAttribute('aria-current')).toBe('date')
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  })

  test('week mode: the seven days of the week', () => {
    render(<Harness rows={[mk('A', { due: day('2026-11-03') }), mk('B', { due: day('2026-11-20') })]} init={view({ dateProperty: null, mode: 'week' })} />)
    expect(title()).toBe('Nov 1 – 7, 2026')
    const cells = screen.getAllByTestId('calendar-day')
    expect(cells.map((c) => c.getAttribute('data-day'))).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'])
    expect(screen.getAllByTestId('calendar-chip').map((c) => c.textContent)).toEqual(['A'])
  })

  test('the Month / Week switch saves the mode in calendarConfig', async () => {
    const user = userEvent.setup()
    render(<Harness rows={UNDATED} />)
    await user.click(within(screen.getByRole('group', { name: 'Calendar mode' })).getByRole('button', { name: 'Week' }))
    expect(screen.getByTestId('calendar-layout').getAttribute('data-mode')).toBe('week')
    expect(screen.getAllByTestId('calendar-day')).toHaveLength(7)
  })

  test('previous, next and today in month mode', async () => {
    const user = userEvent.setup()
    render(<Harness rows={[mk('D', { due: day('2026-12-24') })]} />)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(title()).toBe('December 2026')
    expect(chipsOn('2026-12-24')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(title()).toBe('October 2026')
    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(title()).toBe('November 2026')
  })

  test('previous and next step a week in week mode', async () => {
    const user = userEvent.setup()
    render(<Harness rows={UNDATED} init={view({ dateProperty: null, mode: 'week' })} />)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(title()).toBe('Nov 8 – 14, 2026')
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(title()).toBe('Oct 25 – 31, 2026')
  })
})

describe('CalendarLayout writes', () => {
  test('a drop writes only the date property, from the row version', async () => {
    const patch = vi.fn()
    render(<Harness rows={[mk('A', { due: day('2026-11-10'), start: day('2026-11-02') })]} patchRow={patch} />)
    await drop('Tasks/A.md', '2026-11-10', '2026-11-13')
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { due: { start: '2026-11-13', resolution: 'day' } }, 'v1')
  })

  test('a range keeps its length, moved by the day it was picked up from', async () => {
    render(<Harness rows={[mk('R', { due: { start: '2026-11-10', end: '2026-11-12', resolution: 'day' } })]} />)
    await drop('Tasks/R.md', '2026-11-11', '2026-11-20')
    expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/R.md', { due: { start: '2026-11-19', end: '2026-11-21', resolution: 'day' } }, 'v1')
  })

  test('a time keeps its time of day', async () => {
    const start = zonedWallToInstant('2026-11-10', 9, 30).toISOString()
    const end = zonedWallToInstant('2026-11-10', 11, 0).toISOString()
    render(<Harness rows={[mk('M', { due: { start, end, resolution: 'time' } })]} />)
    await drop('Tasks/M.md', '2026-11-10', '2026-11-12')
    expect(mocked.updateProperties).toHaveBeenCalledWith(
      'Tasks/M.md',
      { due: { start: zonedWallToInstant('2026-11-12', 9, 30).toISOString(), end: zonedWallToInstant('2026-11-12', 11, 0).toISOString(), resolution: 'time' } },
      'v1',
    )
  })

  test('a drop on the same day writes nothing', async () => {
    render(<Harness rows={[mk('A', { due: day('2026-11-10') })]} />)
    await drop('Tasks/A.md', '2026-11-10', '2026-11-10')
    expect(mocked.updateProperties).not.toHaveBeenCalled()
  })

  test('createdAt and lastUpdated chips are not draggable and a drop writes nothing', async () => {
    const r = mk('C', {}, { createdAt: '2026-11-03T15:00:00.000Z', lastUpdated: '2026-11-04T15:00:00.000Z' })
    const onCreate = vi.fn()
    const { unmount } = render(<Harness rows={[r]} init={view({ dateProperty: 'createdAt', mode: 'month' })} onCreate={onCreate} />)
    const chip = screen.getByTestId('calendar-chip')
    expect(chip.getAttribute('data-draggable')).toBe('false')
    await drop('Tasks/C.md', chip.getAttribute('data-day')!, '2026-11-20')
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    // A day click can't give a new object a creation date.
    fireEvent.click(cellOf('2026-11-20'))
    expect(onCreate).not.toHaveBeenCalled()
    unmount()
    render(<Harness rows={[r]} init={view({ dateProperty: 'lastUpdated', mode: 'month' })} />)
    expect(screen.getByTestId('calendar-chip').getAttribute('data-draggable')).toBe('false')
  })

  test('a draggable chip does not announce a keyboard pick-up it has no sensor for', () => {
    render(<Harness rows={[mk('A', { due: day('2026-11-10') })]} />)
    const chip = screen.getByTestId('calendar-chip')
    expect(chip.getAttribute('data-draggable')).toBe('true')
    expect(chip.hasAttribute('aria-describedby')).toBe(false)
    expect(chip.hasAttribute('aria-roledescription')).toBe(false)
    expect(chip.tagName).toBe('BUTTON')
  })

  test("a synced date's chip is not draggable, and a drop says why and sends nothing (M29 review #7)", async () => {
    const HOST = typeDef({
      id: 'host',
      name: 'Host',
      pluralName: 'Hosts',
      propertyDefinitions: [
        propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
        propertyDef({ id: 'lastBoot', type: 'datetime', name: 'Last boot', synced: { source: 'Inventory script', staleAfterDays: 7 } }),
      ],
    })
    useLinkIndex.setState({ types: [HOST], loaded: true })
    const rows = [row({ summary: objectSummary({ path: 'Hosts/APP01.md', type: 'host', title: 'APP01' }), values: { lastBoot: day('2026-11-10') } })]
    render(<DataView rows={rows} types={[HOST]} scope={{ typeIds: ['host'] }} state={view()} onState={vi.fn()} layouts={['calendar']} />)
    expect(screen.getByTestId('calendar-chip').getAttribute('data-draggable')).toBe('false')
    await drop('Hosts/APP01.md', '2026-11-10', '2026-11-12')
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    expect(screen.getByText(`"Last boot" is filled by Inventory script and can't be edited.`).getAttribute('role')).toBe('status')
  })

  test('a read-only row is not draggable', () => {
    render(<Harness rows={[mk('A', { due: day('2026-11-10') }, { readOnly: true })]} />)
    expect(screen.getByTestId('calendar-chip').getAttribute('data-draggable')).toBe('false')
  })

  test('a conflict reloads the row and says so', async () => {
    const patch = vi.fn()
    const fresh = { ...mk('A', { due: day('2026-11-11') }), version: 'v9' }
    mocked.updateProperties.mockRejectedValueOnce(new ConflictError('v9'))
    mocked.rows.mockResolvedValueOnce([fresh])
    render(<Harness rows={[mk('A', { due: day('2026-11-10') })]} patchRow={patch} />)
    await drop('Tasks/A.md', '2026-11-10', '2026-11-13')
    await waitFor(() => expect(patch).toHaveBeenCalledWith('Tasks/A.md', fresh))
    expect(screen.getByText('Changed elsewhere. Reloaded.').getAttribute('role')).toBe('status')
  })

  test('opening a layout writes nothing', () => {
    render(<Harness rows={[mk('A', { due: day('2026-11-10') })]} />)
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    expect(mocked.createObject).not.toHaveBeenCalled()
  })
})

describe('CalendarLayout create', () => {
  test('a click on an empty spot of a day calls onCreate with that day', () => {
    const onCreate = vi.fn()
    render(<Harness rows={[mk('A', { due: day('2026-11-10') })]} onCreate={onCreate} />)
    fireEvent.click(cellOf('2026-11-18'))
    expect(onCreate).toHaveBeenCalledWith({ due: { start: '2026-11-18', resolution: 'day' } }, 'task')
  })

  test('a click on a chip opens it and creates nothing', () => {
    const onCreate = vi.fn()
    render(<Harness rows={[mk('A', { due: day('2026-11-10') })]} onCreate={onCreate} />)
    fireEvent.click(screen.getByTestId('calendar-chip'))
    expect(onCreate).not.toHaveBeenCalled()
  })

  test('the day\'s "+" button creates too', () => {
    const onCreate = vi.fn()
    render(<Harness rows={UNDATED} onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: 'New object on November 9, 2026' }))
    expect(onCreate).toHaveBeenCalledWith({ due: { start: '2026-11-09', resolution: 'day' } }, 'task')
  })

  test('a synced date creates nothing from a day (M29 review #2)', () => {
    const HOST = typeDef({
      id: 'host',
      name: 'Host',
      pluralName: 'Hosts',
      propertyDefinitions: [
        propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
        propertyDef({ id: 'lastBoot', type: 'datetime', name: 'Last boot', synced: { source: 'Inventory script', staleAfterDays: 7 } }),
      ],
    })
    const onCreate = vi.fn()
    const rows = [row({ summary: objectSummary({ path: 'Hosts/APP01.md', type: 'host', title: 'APP01' }), values: { lastBoot: day('2026-11-10') } })]
    render(
      <DataView rows={rows} types={[HOST]} scope={{ typeIds: ['host'] }} state={view()} onState={vi.fn()} layouts={['calendar']} allowCreate onCreate={onCreate} />,
    )
    expect(screen.getByTestId('calendar-layout').getAttribute('data-property')).toBe('lastBoot')
    fireEvent.click(cellOf('2026-11-18'))
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /New object on/ })).toBeNull()
  })

  test('without onCreate a day click does nothing', () => {
    render(<Harness rows={UNDATED} />)
    expect(screen.queryByRole('button', { name: /New object on/ })).toBeNull()
  })
})

describe('CalendarSettings', () => {
  function SettingsHarness({ onChange }: { onChange(s: ViewState): void }) {
    const [state, setState] = useState(view())
    return (
      <CalendarSettings
        types={[TASK]}
        state={state}
        onState={(s) => {
          setState(s)
          onChange(s)
        }}
      />
    )
  }

  test('lists the date properties and saves the chosen one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SettingsHarness onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'Date property' })
    expect(trigger.getAttribute('data-value')).toBe('due')
    await user.click(trigger)
    const menu = await screen.findByRole('menu', { name: 'Date property' })
    expect(within(menu).getAllByRole('menuitemradio').map((b) => b.textContent)).toEqual(['Due', 'Start', 'Created at', 'Last updated'])
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Start' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ viewDefinition: { dataViewLayout: 'calendar', calendarConfig: { dateProperty: 'start', mode: 'month' } } }))
  })

  test('switches the mode', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SettingsHarness onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Week' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ viewDefinition: { dataViewLayout: 'calendar', calendarConfig: { dateProperty: null, mode: 'week' } } }))
    expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true')
  })
})
