import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { DataViewDefinition, Row, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek } from '@/nav/tabs'
import { DataView } from '../DataView'
import { emptyFilterGroup } from '../model'
import { TimelineSettings } from './TimelineLayout'
import { DAY_PX } from './timeline/model'

const mocked = vi.mocked(api)

const STORY = typeDef({
  id: 'story',
  name: 'Story',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({ id: 'createdAt', type: 'entity_createdAt', name: 'Creation date' }),
    propertyDef({ id: 'due', type: 'datetime', name: 'Due' }),
    propertyDef({ id: 'finish', type: 'datetime', name: 'Finish' }),
    propertyDef({ id: 'points', type: 'number', name: 'Points' }),
    propertyDef({ id: 'parent', type: 'entity', name: 'Parent item', options: { isArray: false } }),
    propertyDef({ id: 'children', type: 'entity', name: 'Sub-items' }),
    propertyDef({ id: 'blockedBy', type: 'entity', name: 'Blocked by' }),
    propertyDef({ id: 'blocking', type: 'entity', name: 'Blocking' }),
  ],
})

const d = (start: string, end?: string) => ({ start, ...(end ? { end } : {}), resolution: 'day' as const })

function story(title: string, values: Record<string, unknown> = {}, links: Record<string, (string | null)[]> = {}, version = 'v1'): Row {
  return row({ summary: objectSummary({ path: `Stories/${title}.md`, type: 'story', title }), values, links, version })
}

const timeline = (def: Partial<DataViewDefinition> = {}): ViewState => ({
  viewDefinition: { dataViewLayout: 'timeline', ...def },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
})

let lastState: ViewState | null = null
function Harness({ rows, init = timeline(), patchRow }: { rows: Row[]; init?: ViewState; patchRow?: (p: string, r: Row) => void }) {
  const [state, setState] = useState(init)
  return (
    <DataView
      rows={rows}
      types={[STORY]}
      scope={{ typeIds: ['story'] }}
      state={state}
      onState={(s) => {
        lastState = s
        setState(s)
      }}
      layouts={['table', 'timeline']}
      patchRow={patchRow}
    />
  )
}

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

const bar = (title: string) => screen.getAllByTestId('timeline-bar').find((b) => b.getAttribute('data-path') === `Stories/${title}.md`) as HTMLElement
const px = (el: HTMLElement) => parseFloat(el.style.left)

/** Press on `el`, move by `dx` px, release (mouse events, as the layout listens). */
function dragBy(el: HTMLElement, dx: number) {
  fireEvent.mouseDown(el, { clientX: 100, clientY: 10, button: 0 })
  fireEvent.mouseMove(document, { clientX: 100 + dx / 2, clientY: 10 })
  fireEvent.mouseMove(document, { clientX: 100 + dx, clientY: 10 })
  fireEvent.mouseUp(document, { clientX: 100 + dx, clientY: 10 })
}

beforeEach(() => {
  resetLinkIndex()
  usePeek.getState().close()
  vi.clearAllMocks()
  lastState = null
})

describe('TimelineLayout', () => {
  test('places each bar on its days and counts the undated ones; reading writes nothing', async () => {
    const rows = [story('A', { due: d('2026-11-03') }), story('B', { due: d('2026-11-04', '2026-11-07') }), story('C'), story('D')]
    render(<Harness rows={rows} />)
    expect(bar('A').dataset.start).toBe('2026-11-03')
    expect(bar('A').dataset.end).toBe('2026-11-03')
    expect(bar('B').dataset.end).toBe('2026-11-07')
    // One day apart: one day's width at the default zoom (week).
    expect(px(bar('B')) - px(bar('A'))).toBeCloseTo(DAY_PX.week)
    expect(parseFloat(bar('B').style.width)).toBeCloseTo(4 * DAY_PX.week)
    expect(screen.getByRole('button', { name: 'No date (2)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy()
    expect(screen.getByTestId('timeline-today')).toBeTruthy()
    await act(async () => {})
    expect(mocked.updateProperties).not.toHaveBeenCalled()
  })

  test('the zoom buttons change the scale and save it in the view', async () => {
    const rows = [story('A', { due: d('2026-11-03') }), story('B', { due: d('2026-11-05') })]
    render(<Harness rows={rows} />)
    expect(screen.getByRole('button', { name: 'Week', pressed: true })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Day' }))
    expect(lastState?.viewDefinition.timelineConfig?.zoom).toBe('day')
    expect(px(bar('B')) - px(bar('A'))).toBeCloseTo(2 * DAY_PX.day)
    await userEvent.click(screen.getByRole('button', { name: 'Year' }))
    expect(px(bar('B')) - px(bar('A'))).toBeCloseTo(2 * DAY_PX.year)
    expect(screen.getAllByTestId('timeline-header-bottom').length).toBeGreaterThan(12)
  })

  test('dragging the body moves both dates and writes once, on drop', async () => {
    const patch = vi.fn()
    render(<Harness rows={[story('A', { due: d('2026-11-03', '2026-11-05') }, {}, 'v7')]} patchRow={patch} />)
    fireEvent.mouseDown(bar('A'), { clientX: 100, clientY: 10, button: 0 })
    fireEvent.mouseMove(document, { clientX: 100 + 2 * DAY_PX.week, clientY: 10 })
    // Dragging shows the new place but writes nothing yet.
    expect(bar('A').dataset.start).toBe('2026-11-05')
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    fireEvent.mouseUp(document, { clientX: 100 + 2 * DAY_PX.week, clientY: 10 })
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(1))
    expect(mocked.updateProperties).toHaveBeenCalledWith('Stories/A.md', { due: d('2026-11-05', '2026-11-07') }, 'v7')
    // The bar stays where it was dropped, and the row is reloaded.
    expect(bar('A').dataset.start).toBe('2026-11-05')
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Stories/A.md'] }))
  })

  test('an edge writes only its own date property', async () => {
    const init = timeline({ timelineConfig: { startProperty: 'due', endProperty: 'finish', zoom: 'week', showTable: true, tableColumns: [], showDependencies: true } })
    render(<Harness rows={[story('A', { due: d('2026-11-03'), finish: d('2026-11-06') })]} init={init} />)
    expect(bar('A').dataset.end).toBe('2026-11-06')
    dragBy(screen.getByTestId('timeline-bar-end'), 3 * DAY_PX.week)
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Stories/A.md', { finish: d('2026-11-09') }, 'v1'))
    vi.clearAllMocks()
    dragBy(screen.getByTestId('timeline-bar-start'), -1 * DAY_PX.week)
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(1))
    expect(Object.keys(mocked.updateProperties.mock.calls[0][1])).toEqual(['due'])
  })

  test('a click opens the object; a drag does not', async () => {
    render(<Harness rows={[story('A', { due: d('2026-11-03') })]} />)
    await userEvent.click(bar('A'))
    expect(usePeek.getState().path).toBe('Stories/A.md')
    usePeek.getState().close()
    dragBy(bar('A'), 2 * DAY_PX.week)
    fireEvent.click(bar('A'))
    expect(usePeek.getState().path).toBeFalsy()
  })

  test('a conflict reloads the row and says so', async () => {
    mocked.updateProperties.mockRejectedValueOnce(new ConflictError('v9'))
    render(<Harness rows={[story('A', { due: d('2026-11-03') })]} />)
    dragBy(bar('A'), DAY_PX.week)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Changed elsewhere. Reloaded.'))
    expect(bar('A').dataset.start).toBe('2026-11-03')
  })

  test('Created can not be dragged', async () => {
    const init = timeline({ timelineConfig: { startProperty: 'createdAt', endProperty: null, zoom: 'week', showTable: true, tableColumns: [], showDependencies: true } })
    const r = row({ summary: objectSummary({ path: 'Stories/A.md', type: 'story', title: 'A', createdAt: '2026-11-03T12:00:00.000Z' }) })
    render(<Harness rows={[r]} init={init} />)
    dragBy(bar('A'), 2 * DAY_PX.week)
    await act(async () => {})
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    expect(screen.queryByTestId('timeline-bar-end')).toBeNull()
  })

  test('dragging an undated item from the tray onto the axis sets its start', async () => {
    render(<Harness rows={[story('A', { due: d('2026-11-03') }), story('Later')]} />)
    await userEvent.click(screen.getByRole('button', { name: 'No date (1)' }))
    const chip = screen.getByTestId('timeline-tray-item')
    const axis = screen.getByTestId('timeline-axis')
    const left = 1000
    axis.getBoundingClientRect = () => rect(left, 50, 5000, 350)
    // The scroller shows the axis from x = 800 on, with the table's 200 px on its left.
    screen.getByTestId('timeline-scroll').getBoundingClientRect = () => rect(600, 0, 2000, 400)
    screen.getByTestId('timeline-sidebar').getBoundingClientRect = () => rect(600, 0, 200, 48)
    const aLeft = px(bar('A'))
    // Two days after A's start.
    const x = left + aLeft + 2 * DAY_PX.week + 1
    fireEvent.mouseDown(chip, { clientX: 10, clientY: 500, button: 0 })
    fireEvent.mouseMove(document, { clientX: x, clientY: 100 })
    expect(screen.getByTestId('timeline-tray-ghost')).toBeTruthy()
    fireEvent.mouseUp(document, { clientX: x, clientY: 100 })
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Stories/Later.md', { due: d('2026-11-05') }, 'v1'))
  })

  test('a drop outside the axis writes nothing', async () => {
    render(<Harness rows={[story('Later')]} />)
    await userEvent.click(screen.getByRole('button', { name: 'No date (1)' }))
    const chip = screen.getByTestId('timeline-tray-item')
    fireEvent.mouseDown(chip, { clientX: 10, clientY: 500, button: 0 })
    fireEvent.mouseMove(document, { clientX: 300, clientY: 900 })
    fireEvent.mouseUp(document, { clientX: 300, clientY: 900 })
    await act(async () => {})
    expect(mocked.updateProperties).not.toHaveBeenCalled()
  })

  test('a tray item dropped over the table or below the scroller writes nothing, though the axis lies under it', async () => {
    render(<Harness rows={[story('A', { due: d('2026-11-03') }), story('Later')]} />)
    await userEvent.click(screen.getByRole('button', { name: 'No date (1)' }))
    const chip = screen.getByTestId('timeline-tray-item')
    // The axis is wider and taller than the scroller (it scrolls); it starts under the table.
    screen.getByTestId('timeline-axis').getBoundingClientRect = () => rect(300, 50, 5000, 3000)
    screen.getByTestId('timeline-scroll').getBoundingClientRect = () => rect(100, 0, 1000, 400)
    screen.getByTestId('timeline-sidebar').getBoundingClientRect = () => rect(100, 0, 300, 48)
    const dropAt = (x: number, y: number) => {
      fireEvent.mouseDown(chip, { clientX: 10, clientY: 500, button: 0 })
      fireEvent.mouseMove(document, { clientX: x, clientY: y })
      fireEvent.mouseUp(document, { clientX: x, clientY: y })
    }
    dropAt(350, 200) // over the sticky table
    dropAt(700, 600) // over the tray, below the scroller
    dropAt(700, 20) // over the sticky header
    await act(async () => {})
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    dropAt(700, 200)
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(1))
  })

  test('bars are buttons: Enter or Space opens the object; the link handle is out of the tab order', async () => {
    const init = timeline({ dependenciesConfig: { blockedByPropertyId: 'blockedBy', blockingPropertyId: 'blocking' } })
    render(<Harness rows={[story('A', { due: d('2026-11-03') }), story('B', { due: d('2026-11-04') })]} init={init} />)
    const a = bar('A')
    expect(a.getAttribute('role')).toBe('button')
    expect(a.tabIndex).toBe(0)
    a.focus()
    fireEvent.keyDown(a, { key: 'Enter' })
    expect(usePeek.getState().path).toBe('Stories/A.md')
    usePeek.getState().close()
    fireEvent.keyDown(bar('B'), { key: ' ' })
    expect(usePeek.getState().path).toBe('Stories/B.md')
    const handle = within(a).getByTestId('timeline-link-handle')
    expect(handle.getAttribute('aria-hidden')).toBe('true')
    expect(handle.tabIndex).toBe(-1)
    expect(within(a).queryByRole('button')).toBeNull()
  })

  test('a typo date far from the rest goes to an "Out of range" tray instead of stretching the axis', async () => {
    const rows = [story('A', { due: d('2026-11-03') }), story('Typo', { due: d('0202-11-03') }), story('Later')]
    render(<Harness rows={rows} />)
    expect(screen.queryAllByTestId('timeline-bar').map((b) => b.dataset.path)).toEqual(['Stories/A.md'])
    expect(parseFloat(screen.getByTestId('timeline-axis').style.width)).toBeLessThan(30 * 366 * DAY_PX.week)
    expect(screen.getByRole('button', { name: 'No date (1)' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Out of range (1)' }))
    const item = screen.getAllByTestId('timeline-tray-item').find((i) => i.dataset.path === 'Stories/Typo.md') as HTMLElement
    expect(item.textContent).toContain('Typo')
    expect(item.textContent).toContain('0202-11-03')
  })

  test('the scrolled window is measured on mount (no fixed height until the first scroll)', () => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.testid === 'timeline-scroll' ? 3200 : 0
      },
    })
    try {
      const rows = Array.from({ length: 500 }, (_, i) => story(`S${i}`, { due: d('2026-11-03') }))
      render(<Harness rows={rows} />)
      // 3,200 px of rows is 100 rows (plus the overscan), more than an 800 px guess would draw.
      expect(screen.getAllByTestId('timeline-bar').length).toBeGreaterThanOrEqual(100)
    } finally {
      // The own property shadows Element's getter; removing it restores jsdom's.
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
    }
  })

  test('the table shows the chosen columns and their calculations', () => {
    const init = timeline({
      timelineConfig: { startProperty: null, endProperty: null, zoom: 'week', showTable: true, tableColumns: ['points'], showDependencies: true },
      calculations: [{ propertyId: 'points', structureId: 'story', kind: 'sum' }],
    })
    render(<Harness rows={[story('A', { due: d('2026-11-03'), points: 2 }), story('B', { points: 5 })]} init={init} />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Title', 'Points'])
    expect(screen.getByTestId('calc-points').textContent).toContain('7')
  })

  test('without the table, the bars stay', () => {
    const init = timeline({ timelineConfig: { startProperty: null, endProperty: null, zoom: 'week', showTable: false, tableColumns: [], showDependencies: true } })
    render(<Harness rows={[story('A', { due: d('2026-11-03') })]} init={init} />)
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0)
    expect(bar('A')).toBeTruthy()
  })

  test('sub-items nest under their parent behind a toggle', async () => {
    const init = timeline({ subItemsConfig: { parentPropertyId: 'parent', childrenPropertyId: 'children' } })
    const rows = [
      story('Child', { due: d('2026-11-04') }, { parent: ['Stories/Epic.md'] }),
      story('Epic', { due: d('2026-11-03') }),
      story('Loose', { due: d('2026-11-05') }, { parent: ['Stories/Elsewhere.md'] }),
    ]
    render(<Harness rows={rows} init={init} />)
    const order = () => screen.getAllByRole('row').filter((r) => r.hasAttribute('data-path')).map((r) => [r.getAttribute('data-path'), r.getAttribute('data-depth')])
    expect(order()).toEqual([
      ['Stories/Epic.md', '0'],
      ['Stories/Child.md', '1'],
      ['Stories/Loose.md', '0'],
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Hide sub-items of Epic' }))
    expect(order().map((o) => o[0])).toEqual(['Stories/Epic.md', 'Stories/Loose.md'])
    await userEvent.click(screen.getByRole('button', { name: 'Show sub-items of Epic' }))
    expect(order()).toHaveLength(3)
  })

  test('dependency arrows join each blocker to the item it blocks', () => {
    const init = timeline({ dependenciesConfig: { blockedByPropertyId: 'blockedBy', blockingPropertyId: 'blocking' } })
    const rows = [
      story('A', { due: d('2026-11-03') }, { blocking: ['Stories/B.md'] }),
      story('B', { due: d('2026-11-06'), blockedBy: [{ target: 'A', path: null }] }, { blockedBy: ['Stories/A.md'] }),
      story('C', { due: d('2026-11-06'), blockedBy: [{ target: 'Gone', path: null }] }, { blockedBy: ['Stories/Gone.md'] }),
    ]
    const { rerender } = render(<Harness rows={rows} init={init} />)
    const arrows = screen.getAllByTestId('dependency-arrow')
    expect(arrows.map((a) => [a.getAttribute('data-from'), a.getAttribute('data-to')])).toEqual([['Stories/A.md', 'Stories/B.md']])
    // From A's bar end to B's bar start.
    const dpath = arrows[0].getAttribute('d') ?? ''
    const x1 = px(bar('A')) + DAY_PX.week
    expect(dpath.startsWith(`M${x1},`)).toBe(true)
    expect(dpath.endsWith(`H${px(bar('B'))}`)).toBe(true)
    // "Show dependencies" off hides them.
    const off = timeline({
      dependenciesConfig: { blockedByPropertyId: 'blockedBy', blockingPropertyId: 'blocking' },
      timelineConfig: { startProperty: null, endProperty: null, zoom: 'week', showTable: true, tableColumns: [], showDependencies: false },
    })
    rerender(<Harness key="off" rows={rows} init={off} />)
    expect(screen.queryAllByTestId('dependency-arrow')).toHaveLength(0)
    expect(screen.queryAllByTestId('timeline-link-handle')).toHaveLength(0)
  })

  test("dragging a bar's handle onto another bar makes that one blocked by it", async () => {
    const init = timeline({ dependenciesConfig: { blockedByPropertyId: 'blockedBy', blockingPropertyId: 'blocking' } })
    const rows = [
      story('A', { due: d('2026-11-03') }),
      story('B', { due: d('2026-11-06'), blockedBy: [{ target: 'C', path: null }] }, { blockedBy: ['Stories/C.md'] }, 'v4'),
      story('C', { due: d('2026-11-01') }),
    ]
    mocked.updateProperties.mockResolvedValueOnce({ version: 'v5', frontmatter: {}, links: {}, synced: ['Stories/A.md'], skipped: [] })
    render(<Harness rows={rows} init={init} />)
    const handle = within(bar('A')).getByTestId('timeline-link-handle')
    fireEvent.mouseDown(handle, { clientX: 10, clientY: 10, button: 0 })
    fireEvent.mouseMove(document, { clientX: 60, clientY: 40 })
    expect(screen.getByTestId('dependency-draft')).toBeTruthy()
    fireEvent.mouseEnter(bar('B'))
    fireEvent.mouseUp(document, { clientX: 60, clientY: 40 })
    await waitFor(() =>
      expect(mocked.updateProperties).toHaveBeenCalledWith(
        'Stories/B.md',
        { blockedBy: [{ target: 'C', path: 'Stories/C.md' }, { target: 'A', path: 'Stories/A.md' }] },
        'v4',
      ),
    )
    // The blocked row and the synced one are reloaded; nothing else is written (no move).
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Stories/B.md', 'Stories/A.md'] }))
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
  })

  test('a handle dropped on its own bar or nowhere writes nothing', async () => {
    const init = timeline({ dependenciesConfig: { blockedByPropertyId: 'blockedBy', blockingPropertyId: 'blocking' } })
    render(<Harness rows={[story('A', { due: d('2026-11-03') })]} init={init} />)
    fireEvent.mouseDown(within(bar('A')).getByTestId('timeline-link-handle'), { clientX: 10, clientY: 10, button: 0 })
    fireEvent.mouseEnter(bar('A'))
    fireEvent.mouseUp(document)
    await act(async () => {})
    expect(mocked.updateProperties).not.toHaveBeenCalled()
  })

  test('a 2,000-row view draws only the rows in its window', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => story(`S${i}`, { due: d('2026-11-03') }))
    render(<Harness rows={rows} />)
    expect(screen.getAllByTestId('timeline-bar').length).toBeLessThan(100)
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull()
  })
})

describe('TimelineSettings', () => {
  function SettingsHarness({ init }: { init: ViewState }) {
    const [state, setState] = useState(init)
    lastState = state
    return <TimelineSettings types={[STORY]} state={state} onState={setState} />
  }

  test('picks the start, end and zoom, the table and its columns', async () => {
    render(<SettingsHarness init={timeline()} />)
    expect(screen.getByRole('button', { name: 'Start date' }).textContent).toContain('Due')
    await userEvent.click(screen.getByRole('button', { name: 'End date' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Finish' }))
    expect(lastState?.viewDefinition.timelineConfig?.endProperty).toBe('finish')
    await userEvent.click(screen.getByRole('button', { name: 'Zoom' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Quarter' }))
    expect(lastState?.viewDefinition.timelineConfig?.zoom).toBe('quarter')
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Points' }))
    expect(lastState?.viewDefinition.timelineConfig?.tableColumns).toEqual(['points'])
    // Picking the end property as the start clears the end.
    await userEvent.click(screen.getByRole('button', { name: 'Start date' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Finish' }))
    expect(lastState?.viewDefinition.timelineConfig).toMatchObject({ startProperty: 'finish', endProperty: null })
    await userEvent.click(screen.getByRole('switch', { name: 'Show table' }))
    expect(lastState?.viewDefinition.timelineConfig?.showTable).toBe(false)
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Points' })).toBeNull()
    // "Show dependencies" only with the dependencies turned on.
    expect(screen.queryByRole('switch', { name: 'Show dependencies' })).toBeNull()
  })

})
