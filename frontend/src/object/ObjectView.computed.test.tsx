// M12 review fix: the object panel's formula and rollup values (`computed`) are refreshed after a
// property write, a change to the object's type and, with a rollup, a change to any other object.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, ComputedValue, ObjectDetail, SpaceInfo, TypeDef, UpdateResult } from '@/api/types'
import { counterpartRow, objectDetail, objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { useFind } from '@/find/useFind'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectPage } from './ObjectPage'

const mocked = vi.mocked(api)

const STAGE = propertyDef({
  id: 'p-stage',
  key: 'stage',
  name: 'Stage',
  type: 'label',
  options: { isArray: false, set: [{ id: 'o1', text: 'Idea', color: 'gray', icon: null }, { id: 'o2', text: 'Doing', color: 'blue', icon: null }] },
})
const MEMBERS = propertyDef({ id: 'p-members', key: 'members', name: 'Members', type: 'entity', options: { isArray: true, allowedTypes: ['member'] } })
const DOUBLE = propertyDef({ id: 'p-double', key: 'double', name: 'Double', type: 'formula', options: { expression: 'prop("Budget") * 2' } })
const HOURS = propertyDef({ id: 'p-hours', key: 'hours', name: 'Hours', type: 'rollup', options: { relationId: 'p-members', targetId: 'm-hours', calc: 'sum' } })

const PATH = 'Projects/Apollo.md'
let project: TypeDef
let listeners: ((e: ChangeEvent) => void)[] = []
let onDisk: ObjectDetail

function detail(version: string, computed: Record<string, ComputedValue>): ObjectDetail {
  return objectDetail({
    summary: objectSummary({ path: PATH, type: 'project', title: 'Apollo' }),
    frontmatter: { type: 'Project', title: 'Apollo', stage: 'Idea' },
    body: 'Text.\n',
    version,
    computed,
  })
}
const num = (value: number): ComputedValue => ({ type: 'number', value })

function setup(defs = [STAGE, MEMBERS, DOUBLE, HOURS]) {
  project = typeDef({ id: 'project', name: 'Project', pluralName: 'Projects', revision: 'r1', propertyDefinitions: defs })
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [project] } satisfies SpaceInfo)
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  useFind.getState().close()
  listeners = []
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  setup()
  onDisk = detail('v1', { double: num(8), hours: num(5) })
  mocked.objects.mockResolvedValue([onDisk.summary])
  mocked.object.mockImplementation(async () => onDisk)
  mocked.resolve.mockResolvedValue(null)
  mocked.updateProperties.mockImplementation(
    async (_p: string, updates: Record<string, unknown>): Promise<UpdateResult> => ({ version: 'v2', frontmatter: { ...updates }, links: {}, synced: [], skipped: [] }),
  )
  mocked.onChange.mockImplementation((cb: (e: ChangeEvent) => void) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
})

const emit = (e: ChangeEvent) => act(() => listeners.forEach((l) => l(e)))

async function openPage() {
  render(<ObjectPage path={PATH} />)
  await screen.findByRole('heading', { level: 1, name: 'Apollo' })
  await screen.findByRole('button', { name: 'Edit Stage' })
  await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
  expect(screen.getByText('8')).toBeInTheDocument()
  mocked.object.mockClear()
}

describe('ObjectView: computed values stay fresh', () => {
  test('a property write reads the computed values again (and only those)', async () => {
    await openPage()
    onDisk = { ...detail('v2', { double: num(16), hours: num(5) }), body: 'Not taken.\n' }
    fireEvent.click(screen.getByRole('button', { name: 'Edit Stage' }))
    const list = await screen.findByRole('listbox', { name: 'Stage' })
    fireEvent.click(within(list).getByRole('option', { name: /Doing/ }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('16')).toBeInTheDocument()
    expect(mocked.object).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Not taken.')).not.toBeInTheDocument()
  })

  test('a change to another object refreshes a rollup', async () => {
    await openPage()
    onDisk = detail('v1', { double: num(8), hours: num(12) })
    emit({ kind: 'changed', path: 'Members/Ann.md', version: 'm2' })
    emit({ kind: 'changed', path: 'Members/Bob.md', version: 'm3' })
    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(mocked.object).toHaveBeenCalledTimes(1) // both events in one read
  })

  test("a change to this object's type refreshes its formulas", async () => {
    await openPage()
    onDisk = detail('v1', { double: num(24), hours: num(5) })
    emit({ kind: 'types', path: 'project', version: null })
    expect(await screen.findByText('24')).toBeInTheDocument()
  })

  // Fix pass H (M5#5): another object gaining a link to this one updates the Backlinks chips.
  test('a change to another object refreshes the backlinks property', async () => {
    const BACKLINKS = propertyDef({ id: 'p-back', key: 'backlinks', name: 'Backlinks', type: 'entity_backlinks' })
    setup([STAGE, DOUBLE, BACKLINKS])
    onDisk = { ...detail('v1', { double: num(8) }), backlinks: [] }
    await openPage()
    expect(screen.queryAllByTestId('backlink-chip')).toHaveLength(0)
    mocked.objects.mockResolvedValue([onDisk.summary, objectSummary({ path: 'Pages/Notes.md', title: 'Notes' })])
    onDisk = { ...detail('v1', { double: num(8) }), body: 'Not taken.\n', backlinks: [{ target: 'Notes', path: 'Pages/Notes.md' }] }
    emit({ kind: 'changed', path: 'Pages/Notes.md', version: 'n2' })
    await waitFor(() => expect(screen.getAllByTestId('backlink-chip')).toHaveLength(1))
    expect(screen.queryByText('Not taken.')).not.toBeInTheDocument()
  })

  // M28 review #8: a type that only receives an other side from an "any type" source (Command or
  // Runbook "Covers") has no `counterparts` of its own, yet its object has counterpart rows.
  test('a change to another object refreshes counterpart rows from an any-type source', async () => {
    setup([STAGE, DOUBLE])
    const row = counterpartRow({ key: 'documentedIn', name: 'Documented in', sourceTypeId: 'runbook', sourcePropertyKey: 'covers', paths: ['Runbooks/Patching.md'] })
    onDisk = { ...detail('v1', { double: num(8) }), counterparts: [row] }
    await openPage()
    onDisk = { ...onDisk, counterparts: [{ ...row, paths: ['Runbooks/Patching.md', 'Runbooks/Restart.md'] }] }
    emit({ kind: 'changed', path: 'Runbooks/Restart.md', version: 'r2' })
    await waitFor(() => expect(mocked.object).toHaveBeenCalledTimes(1))
  })

  test('without a rollup, other objects changing read nothing', async () => {
    setup([STAGE, DOUBLE])
    onDisk = detail('v1', { double: num(8) })
    await openPage()
    emit({ kind: 'changed', path: 'Members/Ann.md', version: 'm2' })
    emit({ kind: 'types', path: 'member', version: null })
    await new Promise((r) => setTimeout(r, 300))
    expect(mocked.object).not.toHaveBeenCalled()
  })
})
