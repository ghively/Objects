// M33, choice 3: a typed note's own properties come first in the properties pane, in their own
// order; the built-in rows (Collections, Description, Created at, Last updated, Tags, Icon,
// Aliases and the other system ones) follow in the order they have. An order arranged by hand
// (Type settings: drag) is kept. Display only: no type file is written.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectDetail, PropertyDef, PropertyType, SpaceInfo, TypeDef } from '@/api/types'
import { counterpartDef, counterpartRow, objectDetail, objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { ObjectPeek } from './ObjectPeek'
import { ObjectView } from './ObjectView'
import { ownFirst, paneOrder } from './paneOrder'
import { PropertyPanel } from './PropertyPanel'

const mocked = vi.mocked(api)

const def = (key: string, type: PropertyType, name: string, extra: Partial<PropertyDef> = {}): PropertyDef =>
  propertyDef({ id: key, key, name, type, ...extra })

const TITLE = def('title', 'entity_title', 'Title')
const COLLECTIONS = def('collections', 'entity_collections', 'Collections')
const DESCRIPTION = def('description', 'entity_description', 'Description')
const CREATED = def('createdAt', 'entity_createdAt', 'Created at')
const UPDATED = def('lastUpdated', 'entity_lastUpdated', 'Last updated')
const TAGS = def('tags', 'entity_tags', 'Tags')
const ICON = def('icon', 'entity_icon', 'Icon')
const ALIASES = def('aliases', 'entity_aliases', 'Aliases')
/** The built-in rows every type is saved with, in the order it is saved with them. */
const SYSTEM = [TITLE, COLLECTIONS, DESCRIPTION, CREATED, UPDATED, TAGS, ICON, ALIASES]
const BACKLINKS = def('backlinks', 'entity_backlinks', 'Backlinks')
const COVER = def('coverImage', 'coverImage', 'Cover image')
const TYPE_ROW = def('type', 'entity_type', 'Object type')

const STATUS = def('status', 'label', 'Status', { options: { isStatus: true, set: [] } })
const PRIORITY = def('priority', 'label', 'Priority', { options: { set: [] } })
const DATE = def('date', 'datetime', 'Date')
const DEADLINE = def('deadline', 'datetime', 'Deadline')
const OWN = [STATUS, PRIORITY, DATE, DEADLINE]

/** The system rows as the pane names them (the title is the page's own header, never a row). */
const SYSTEM_NAMES = ['Collections', 'Description', 'Created at', 'Last updated', 'Tags', 'Icon', 'Aliases']
const OWN_NAMES = ['Status', 'Priority', 'Date', 'Deadline']

const task = (propertyDefinitions: PropertyDef[], extra: Partial<TypeDef> = {}): TypeDef =>
  typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true, revision: 'r1', propertyDefinitions, ...extra })

const TASK = task([...SYSTEM, ...OWN])
const PATH = 'Tasks/Fix printer.md'
const SUMMARY = objectSummary({ id: 'id-task', path: PATH, type: 'task', title: 'Fix printer' })
const FRONTMATTER = { type: 'Task', title: 'Fix printer', status: 'In Progress', createdAt: '2026-03-05T09:00:00.000Z' }

const keys = (defs: readonly PropertyDef[]) => defs.map((d) => d.key)

/** The pane's rows, top to bottom, as a person reads them. */
function rowNames(scope: ParentNode = document): string[] {
  return [...scope.querySelectorAll('[aria-label="Properties"] [data-property-row]')].map((el) => el.getAttribute('data-property-row') ?? '')
}

beforeEach(() => {
  localStorage.clear()
  resetLinkIndex()
  resetSpaceInfo()
  useTabs.getState().reset()
  usePeek.getState().close()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.resolve.mockResolvedValue(null)
})

describe('the order of the pane (ownFirst, paneOrder)', () => {
  test('a type as it is saved: its own properties first, in their own order, then the built-in rows in theirs', () => {
    const stored = [...SYSTEM, ...OWN]
    expect(keys(paneOrder(stored))).toEqual([...keys(OWN), ...keys(SYSTEM)])
    // The stored list itself is left as it is.
    expect(keys(stored)).toEqual([...keys(SYSTEM), ...keys(OWN)])
  })

  test('a plain Note has no properties of its own: nothing changes', () => {
    expect(ownFirst(SYSTEM)).toBeNull()
    expect(paneOrder(SYSTEM)).toEqual(SYSTEM)
    // Nor a Tag, whose only extra row is the Color system row.
    const tag = [...SYSTEM, def('color', 'color', 'Color')]
    expect(ownFirst(tag)).toBeNull()
  })

  test('own properties arranged among themselves keep that order', () => {
    const stored = [...SYSTEM, DEADLINE, STATUS, DATE, PRIORITY]
    expect(keys(paneOrder(stored))).toEqual(['deadline', 'status', 'date', 'priority', ...keys(SYSTEM)])
  })

  test('built-in rows added later (after the own ones) stay last; ones saved right after the block stay with it', () => {
    expect(keys(paneOrder([...SYSTEM, ...OWN, BACKLINKS]))).toEqual([...keys(OWN), ...keys(SYSTEM), 'backlinks'])
    expect(keys(paneOrder([...SYSTEM, TYPE_ROW, COVER, ...OWN, BACKLINKS]))).toEqual([...keys(OWN), ...keys(SYSTEM), 'type', 'coverImage', 'backlinks'])
  })

  test('a built-in row that sits between own rows keeps its place among them', () => {
    expect(keys(paneOrder([...SYSTEM, STATUS, BACKLINKS, PRIORITY]))).toEqual(['status', 'backlinks', 'priority', ...keys(SYSTEM)])
  })

  test.each([
    ['an own property dragged above a built-in row', [TITLE, STATUS, COLLECTIONS, DESCRIPTION, CREATED, UPDATED, TAGS, ICON, ALIASES, PRIORITY]],
    ['an own property dragged to the very top', [STATUS, ...SYSTEM, PRIORITY]],
    ['an own property dragged into the block', [TITLE, COLLECTIONS, DESCRIPTION, CREATED, STATUS, UPDATED, TAGS, ICON, ALIASES, PRIORITY]],
    ['the built-in rows rearranged (Tags first)', [TITLE, TAGS, COLLECTIONS, DESCRIPTION, CREATED, UPDATED, ICON, ALIASES, ...OWN]],
    ['a built-in row dragged below the own ones', [TITLE, COLLECTIONS, DESCRIPTION, CREATED, UPDATED, ICON, ALIASES, ...OWN, TAGS]],
    ['a built-in row dragged among the own ones', [TITLE, COLLECTIONS, DESCRIPTION, CREATED, UPDATED, TAGS, ICON, STATUS, ALIASES, PRIORITY]],
  ])('an order arranged by hand is kept: %s', (_name, stored) => {
    expect(ownFirst(stored)).toBeNull()
    expect(paneOrder(stored)).toEqual(stored)
  })

  test('a list with no built-in rows at its top (a type read without them) is left as it is', () => {
    expect(ownFirst(OWN)).toBeNull()
    expect(ownFirst([])).toBeNull()
  })
})

describe('the properties pane of a typed note', () => {
  test('a Task shows Status, Priority, Date, Deadline first, then the built-in rows as before', () => {
    render(<PropertyPanel type={TASK} frontmatter={FRONTMATTER} summary={SUMMARY} onChange={vi.fn()} onTypeChange={vi.fn()} />)
    expect(rowNames()).toEqual([...OWN_NAMES, ...SYSTEM_NAMES])
  })

  test('a plain Note is unchanged', () => {
    const page = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, propertyDefinitions: SYSTEM })
    render(<PropertyPanel type={page} frontmatter={{ title: 'Alpha' }} summary={objectSummary({ path: 'Pages/Alpha.md', type: 'page' })} onChange={vi.fn()} />)
    expect(rowNames()).toEqual(SYSTEM_NAMES)
  })

  test('a type with a hand-arranged order is untouched', () => {
    const arranged = task([TITLE, STATUS, COLLECTIONS, DESCRIPTION, CREATED, UPDATED, TAGS, ICON, ALIASES, PRIORITY, DATE, DEADLINE])
    render(<PropertyPanel type={arranged} frontmatter={FRONTMATTER} summary={SUMMARY} onChange={vi.fn()} onTypeChange={vi.fn()} />)
    expect(rowNames()).toEqual(['Status', 'Collections', 'Description', 'Created at', 'Last updated', 'Tags', 'Icon', 'Aliases', 'Priority', 'Date', 'Deadline'])
  })

  test('showing the pane writes nothing: no type is saved and no property is changed', () => {
    const onChange = vi.fn()
    const onChangeMany = vi.fn()
    const onTypeChange = vi.fn()
    render(
      <PropertyPanel type={TASK} frontmatter={FRONTMATTER} summary={SUMMARY} onChange={onChange} onChangeMany={onChangeMany} onTypeChange={onTypeChange} />,
    )
    expect(rowNames().slice(0, 4)).toEqual(OWN_NAMES)
    expect(onTypeChange).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(onChangeMany).not.toHaveBeenCalled()
    expect(mocked.saveType).not.toHaveBeenCalled()
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    // The type the pane was given is as it was: its own list still opens with the built-in rows.
    expect(keys(TASK.propertyDefinitions)).toEqual([...keys(SYSTEM), ...keys(OWN)])
  })

  test('"hide when empty" and the "Hidden" group behave as before, in the same order', async () => {
    const user = userEvent.setup()
    const type = task([
      TITLE,
      COLLECTIONS,
      { ...DESCRIPTION, visibility: 'hideWhenEmpty' },
      CREATED,
      UPDATED,
      TAGS,
      { ...ICON, visibility: 'hidden' },
      ALIASES,
      STATUS,
      { ...PRIORITY, visibility: 'hideWhenEmpty' },
      { ...DATE, visibility: 'hidden' },
      DEADLINE,
    ])
    render(<PropertyPanel type={type} frontmatter={FRONTMATTER} summary={SUMMARY} onChange={vi.fn()} onTypeChange={vi.fn()} />)
    // Empty Description and Priority are left out; Icon and Date wait under "Hidden (2)".
    expect(rowNames()).toEqual(['Status', 'Deadline', 'Collections', 'Created at', 'Last updated', 'Tags', 'Aliases'])
    await user.click(screen.getByRole('button', { name: 'Hidden (2)' }))
    expect(rowNames()).toEqual(['Status', 'Deadline', 'Collections', 'Created at', 'Last updated', 'Tags', 'Aliases', 'Date', 'Icon'])
  })

  test('a computed other side stays right after the type\'s own properties, before the built-in rows', () => {
    const runs = counterpartDef({ key: 'runs', name: 'Runs', visibility: 'alwaysShow' })
    const host = typeDef({ id: 'host', name: 'Host', propertyDefinitions: [...SYSTEM, def('cores', 'number', 'Cores')], counterparts: [runs] })
    render(
      <PropertyPanel
        type={host}
        frontmatter={{ title: 'APP01', cores: 4 }}
        summary={objectSummary({ path: 'Hosts/APP01.md', type: 'host' })}
        counterparts={[counterpartRow({ key: 'runs', name: 'Runs', paths: [] })]}
        onChange={vi.fn()}
      />,
    )
    expect(rowNames()).toEqual(['Cores', 'Runs', ...SYSTEM_NAMES])
  })

  test('and still before Backlinks, where a type has that row', () => {
    const runs = counterpartDef({ key: 'runs', name: 'Runs', visibility: 'alwaysShow' })
    const host = typeDef({
      id: 'host',
      name: 'Host',
      propertyDefinitions: [...SYSTEM, def('cores', 'number', 'Cores'), BACKLINKS],
      counterparts: [runs],
    })
    render(
      <PropertyPanel
        type={host}
        frontmatter={{ title: 'APP01', cores: 4 }}
        summary={objectSummary({ path: 'Hosts/APP01.md', type: 'host' })}
        counterparts={[counterpartRow({ key: 'runs', name: 'Runs', paths: [] })]}
        backlinks={[]}
        onChange={vi.fn()}
      />,
    )
    expect(rowNames()).toEqual(['Cores', 'Runs', ...SYSTEM_NAMES, 'Backlinks'])
  })
})

describe('on the note page and in the peek', () => {
  function serve(type: TypeDef) {
    const detail: ObjectDetail = objectDetail({ summary: SUMMARY, frontmatter: FRONTMATTER, body: 'The printer on floor 2 jams.\n', version: 'v1' })
    mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [type] } satisfies SpaceInfo)
    mocked.objects.mockResolvedValue([SUMMARY])
    mocked.object.mockResolvedValue(detail)
    useLinkIndex.setState({ types: [type], objects: [SUMMARY], loaded: true })
  }

  test('a Task\'s page lists its own properties first, and opening it writes nothing', async () => {
    serve(TASK)
    const { container } = render(<ObjectView path={PATH} mode="page" />)
    await waitFor(() => expect(rowNames(container)).toHaveLength(OWN_NAMES.length + SYSTEM_NAMES.length))
    expect(rowNames(container)).toEqual([...OWN_NAMES, ...SYSTEM_NAMES])
    expect(mocked.saveType).not.toHaveBeenCalled()
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    expect(mocked.saveBody).not.toHaveBeenCalled()
  })

  test('the peek too', async () => {
    serve(TASK)
    usePeek.getState().show(PATH)
    render(<ObjectPeek />)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(rowNames(dialog)).toHaveLength(OWN_NAMES.length + SYSTEM_NAMES.length))
    expect(rowNames(dialog)).toEqual([...OWN_NAMES, ...SYSTEM_NAMES])
    expect(within(dialog).getByRole('complementary', { name: 'Properties' })).toBeInTheDocument()
    expect(mocked.saveType).not.toHaveBeenCalled()
  })

  test('a hand-arranged type shows its stored order on the page', async () => {
    serve(task([TITLE, TAGS, COLLECTIONS, DESCRIPTION, CREATED, UPDATED, ICON, ALIASES, ...OWN]))
    const { container } = render(<ObjectView path={PATH} mode="page" />)
    await waitFor(() => expect(rowNames(container)).toHaveLength(OWN_NAMES.length + SYSTEM_NAMES.length))
    expect(rowNames(container)).toEqual(['Tags', 'Collections', 'Description', 'Created at', 'Last updated', 'Icon', 'Aliases', ...OWN_NAMES])
  })
})
