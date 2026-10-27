// M8 Task 14: reminders on any date property that supports them (the picker's Reminder row, the
// write through `PUT /api/tasks/reminder`, and the "Reminders" switch in Property settings).
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { PropertyDef, TypeDef } from '@/api/types'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useObjectWrites } from '@/object/useObjectWrites'
import { formatRemind } from '@/tasks/remind'
import { propertyDef, typeDef } from '@/test/mockApi'
import { DateCell } from './cells/DateCell'
import { DatePicker } from './DatePicker'
import { PropertySettings } from './PropertySettings'

const NOW = new Date(2026, 9, 21, 10, 30)
const DEADLINE: PropertyDef = propertyDef({
  id: 'p-deadline',
  key: 'deadline',
  name: 'Deadline',
  type: 'datetime',
  options: { constraints: { resolutionPreference: 'day', supportsReminders: true } },
})
const PLAIN: PropertyDef = propertyDef({ id: 'p-due', key: 'due', name: 'Due', type: 'datetime' })
const DAY = { start: '2026-10-30', resolution: 'day' as const }
const ONE_DAY = formatRemind({ minutesBefore: 0, daysBefore: 1, timeOfDay: '09:00' }, 'day')

beforeEach(() => {
  localStorage.clear()
  resetLinkIndex()
})
afterEach(() => vi.unstubAllGlobals())

describe('Reminders on any date property', () => {
  test('test reminder menu shows for a supports reminders property', async () => {
    const { unmount } = render(
      <DatePicker value={DAY} constraints={DEADLINE.options.constraints} onChange={() => {}} reminder={{ value: null, onChange: () => {} }} now={NOW} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reminder: No reminder' }))
    expect(screen.getAllByRole('menuitemradio').map((b) => b.textContent)).toEqual([
      'No reminder',
      'On the day',
      '1 day before',
      '2 days before',
      '7 days before',
    ])
    unmount()
    // Without the constraint (or without a reminder owner) there is no row.
    const { unmount: u2 } = render(
      <DatePicker value={DAY} constraints={PLAIN.options.constraints} onChange={() => {}} reminder={{ value: null, onChange: () => {} }} now={NOW} />,
    )
    expect(screen.queryByRole('button', { name: /^Reminder:/ })).toBeNull()
    u2()
    render(<DatePicker value={DAY} constraints={DEADLINE.options.constraints} onChange={() => {}} now={NOW} />)
    expect(screen.queryByRole('button', { name: /^Reminder:/ })).toBeNull()
  })

  test('test reminder writes through set reminder', async () => {
    // The cell hands the pick to `onSetReminder(key, remind)`; the date is not rewritten.
    const onSetReminder = vi.fn()
    const onChange = vi.fn()
    const onChangeMany = vi.fn()
    const { unmount } = render(
      <DateCell
        def={DEADLINE}
        value={DAY}
        typeId="project"
        frontmatter={{ deadline: '2026-10-30' }}
        onChange={onChange}
        onChangeMany={onChangeMany}
        onSetReminder={onSetReminder}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit Deadline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reminder: No reminder' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: '1 day before' }))
    expect(onSetReminder).toHaveBeenCalledWith('deadline', ONE_DAY)
    expect(onChange).not.toHaveBeenCalled()
    expect(onChangeMany).not.toHaveBeenCalled()
    unmount()

    // An existing entry of the `reminders` map shows; "No reminder" clears it.
    onSetReminder.mockClear()
    render(
      <DateCell
        def={DEADLINE}
        value={DAY}
        typeId="project"
        frontmatter={{ deadline: '2026-10-30', reminders: { deadline: ONE_DAY } }}
        onChange={onChange}
        onSetReminder={onSetReminder}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit Deadline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reminder: 1 day before' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'No reminder' }))
    expect(onSetReminder).toHaveBeenCalledWith('deadline', null)
  })

  test('test object writes send the reminder route with the base version', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ version: 'v2', frontmatter: { deadline: '2026-10-30' }, links: {}, synced: [], skipped: [] }), {
          status: 200,
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const versionRef = { current: 'v1' }
    const adoptVersion = vi.fn((v: string) => {
      versionRef.current = v
    })
    const onUpdated = vi.fn()
    const { result } = renderHook(() =>
      useObjectWrites({
        path: 'Projects/Launch.md',
        versionRef,
        bodyControl: { flush: async () => ({ ok: true }), resume: () => {} },
        adoptVersion,
        onConflict: () => {},
        onUpdated,
      }),
    )
    await act(async () => {
      await result.current.setReminder('deadline', null)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/tasks/reminder')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toMatchObject({ path: 'Projects/Launch.md', key: 'deadline', remind: null, baseVersion: 'v1' })
    expect(adoptVersion).toHaveBeenCalledWith('v2')
    // The whole frontmatter came back without `reminders`: the view drops the key.
    expect(onUpdated.mock.calls[0][2]).toEqual(['reminders'])
  })
})

describe('Property settings: Reminders', () => {
  const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
  const PROJECT: TypeDef = typeDef({ id: 'project', name: 'Project', revision: 'r1', propertyDefinitions: [TITLE, PLAIN, DEADLINE] })
  const TASK_DATE = propertyDef({
    id: 'date',
    key: 'date',
    name: 'Date',
    type: 'datetime',
    options: { constraints: { supportsReminders: true } },
  })
  const TASK: TypeDef = typeDef({ id: 'task', name: 'Task', basic: true, revision: 'rt', propertyDefinitions: [TITLE, TASK_DATE] })

  beforeEach(() => {
    vi.mocked(api.saveType).mockReset()
    vi.mocked(api.saveType).mockImplementation(async (t: TypeDef) => ({ type: { ...t, revision: 'r2' }, rewritten: [], skipped: [] }))
    useLinkIndex.setState({ types: [PROJECT, TASK], objects: [], loaded: true })
  })
  const saved = (id: string) =>
    (vi.mocked(api.saveType).mock.calls.at(-1)![0] as TypeDef).propertyDefinitions.find((d) => d.id === id)

  test('test reminders switch sets the constraint', async () => {
    const { unmount } = render(<PropertySettings typeId="project" propertyId="p-due" open onOpenChange={() => {}} onOpenProperty={() => {}} />)
    const sw = screen.getByRole('switch', { name: 'Reminders' })
    expect(sw).not.toBeChecked()
    await userEvent.click(sw)
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(saved('p-due')?.options.constraints?.supportsReminders).toBe(true)
    unmount()

    // Off removes the key rather than writing `false`.
    render(<PropertySettings typeId="project" propertyId="p-deadline" open onOpenChange={() => {}} onOpenProperty={() => {}} />)
    const on = screen.getByRole('switch', { name: 'Reminders' })
    expect(on).toBeChecked()
    await userEvent.click(on)
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(2))
    expect(saved('p-deadline')?.options.constraints).not.toHaveProperty('supportsReminders')
  })

  test('test the task date has no reminders switch', () => {
    render(<PropertySettings typeId="task" propertyId="date" open onOpenChange={() => {}} onOpenProperty={() => {}} />)
    expect(screen.getByText('Hide in calendar')).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Reminders' })).toBeNull()
  })
})
