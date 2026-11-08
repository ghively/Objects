import { describe, expect, test } from 'vitest'
import type { Views } from '@/api/types'
import { collection, defaultViews, objectSummary, propertyDef, query, row, typeDef } from '@/test/mockApi'
import {
  addableSections,
  appendSection,
  buildSections,
  canHaveBacklinks,
  canRemoveSection,
  hiddenSections,
  moveSection,
  noBacklinksRows,
  removeSection,
  sectionInFullView,
  SECTION_TEXT,
  showSection,
  tabSections,
  unreviewedRows,
  visibleSections,
} from './dashboardSections'

const TAGS = propertyDef({ id: 'tags', key: 'tags', name: 'Tags', type: 'entity_tags' })
const NOTE = typeDef({ id: 'note', name: 'Note', propertyDefinitions: [TAGS] })
const PLAIN = typeDef({ id: 'plain', name: 'Plain' })

/** The initial sections (the server's `default_views`). */
const DEFAULTS = ['recentlyAccessed', 'collections', 'queries'] as const
/** The older default set: still what older saved views hold. */
const OLD = ['recentlyAccessed', 'collections', 'queries', 'inNoCollection', 'notTagged'] as const

function views(keys: readonly string[] = DEFAULTS, removed: string[] = []): Views {
  const v = defaultViews()
  return {
    ...v,
    dashboard: {
      sections: keys.map((key) => ({ key: key as never, collapsed: false })),
      removedSections: removed,
    },
  }
}

const ctx = (over: Partial<{ collections: ReturnType<typeof collection>[]; queries: ReturnType<typeof query>[] }> = {}) => ({
  collections: [],
  queries: [],
  ...over,
})

describe('buildSections', () => {
  test('test buildSections default order and notTagged only with tags', () => {
    expect(buildSections(NOTE, views(), ctx()).map((s) => s.key)).toEqual([...DEFAULTS])
    expect(buildSections(NOTE, views(OLD), ctx()).map((s) => s.key)).toEqual([...OLD])
    expect(buildSections(PLAIN, views(OLD), ctx()).map((s) => s.key)).toEqual(OLD.filter((k) => k !== 'notTagged'))
  })

  test('labels, icons and the full-view flag come from the kind', () => {
    const s = buildSections(NOTE, views(OLD), ctx())
    expect(s.map((x) => [x.key, x.label, x.icon, x.inFullView])).toEqual([
      ['recentlyAccessed', 'Recently Opened', 'ph-clock-clockwise', false],
      ['collections', 'Collections', 'ph-cards-three', false],
      ['queries', 'Queries', 'ph-list-magnifying-glass', false],
      ['inNoCollection', 'Not in any collection', 'ph-placeholder', true],
      ['notTagged', 'Not tagged', 'ph-tag', true],
    ])
    expect(sectionInFullView('query:q1')).toBe(true)
    expect(sectionInFullView('collection:c1')).toBe(true)
    expect(sectionInFullView('collections')).toBe(false)
  })

  test('an uncustomised query section is labelled with its automatic title, as on its page', () => {
    const q = query({
      id: 'q1',
      name: 'New Query',
      titleIsCustom: false,
      definition: { structures: [{ id: 'note' }], filterGroup: { type: 'filterGroup', operator: 'and', elements: [] }, sorts: [], groupBy: null },
    })
    const titleCtx = { types: [{ id: 'note', pluralName: 'Notes' }], tagIdsToTitles: {} }
    const [s] = buildSections(NOTE, views(['query:q1']), { ...ctx({ queries: [q] }), titleCtx })
    expect(s.label).toBe('Notes')
    const custom = buildSections(NOTE, views(['query:q1']), { ...ctx({ queries: [{ ...q, name: 'Mine', titleIsCustom: true }] }), titleCtx })
    expect(custom[0].label).toBe('Mine')
  })

  test('a collection of the type is appended unless removed; other types and unknown ids are dropped', () => {
    const c = collection({ id: 'c1', name: 'Reading', typeIds: ['note'] })
    const other = collection({ id: 'c2', name: 'Other', typeIds: ['plain'] })
    expect(buildSections(NOTE, views(['inNoCollection']), ctx({ collections: [c, other] })).map((s) => s.key)).toEqual([
      'inNoCollection',
      'collection:c1',
    ])
    expect(buildSections(NOTE, views(['inNoCollection'], ['collection:c1']), ctx({ collections: [c] })).map((s) => [s.key, s.hidden])).toEqual([
      ['inNoCollection', false],
      ['collection:c1', true],
    ])
    // pinned and a deleted query have nothing to show
    expect(buildSections(NOTE, views(['pinned', 'query:gone']), ctx()).map((s) => s.key)).toEqual([])
  })

  test('a section title replaces the label', () => {
    const v = views(['inNoCollection'])
    v.dashboard.sections[0].title = 'Loose notes'
    const [s] = buildSections(NOTE, v, ctx())
    expect(s.label).toBe('Loose notes')
    expect(s.defaultLabel).toBe('Not in any collection')
  })

  test('full-view sections become header tabs; dashboard-only ones do not', () => {
    const q = query({ id: 'q1', name: 'Open', definition: { ...query({ id: 'x' }).definition, structures: [{ id: 'note' }] } })
    const c = collection({ id: 'c1', name: 'Reading', typeIds: ['note'] })
    const all = buildSections(NOTE, views([...OLD, 'query:q1']), ctx({ collections: [c], queries: [q] }))
    expect(tabSections(all).map((s) => s.key)).toEqual(['inNoCollection', 'notTagged', 'query:q1', 'collection:c1'])
  })
})

describe('section edits', () => {
  const all = () => buildSections(NOTE, views(OLD), ctx())

  test('removeSection moves the key to removedSections and showSection brings it back', () => {
    const v = views(OLD)
    const removed = removeSection(v, all(), 'recentlyAccessed')
    expect(removed.dashboard.sections.map((s) => s.key)).toEqual(['collections', 'queries', 'inNoCollection', 'notTagged'])
    expect(removed.dashboard.removedSections).toEqual(['recentlyAccessed'])

    const after = buildSections(NOTE, removed, ctx())
    expect(hiddenSections(after).map((s) => s.key)).toEqual(['recentlyAccessed'])
    expect(visibleSections(after)).toHaveLength(4)

    const back = showSection(removed, after, hiddenSections(after)[0])
    expect(back.dashboard.removedSections).toEqual([])
    expect(back.dashboard.sections.map((s) => s.key)).toEqual(['collections', 'queries', 'inNoCollection', 'notTagged', 'recentlyAccessed'])
  })

  test('Collections and Queries cannot be removed', () => {
    expect(canRemoveSection('collections')).toBe(false)
    expect(canRemoveSection('queries')).toBe(false)
    expect(canRemoveSection('recentlyAccessed')).toBe(true)
    expect(canRemoveSection('inNoCollection')).toBe(true)
    const v = views()
    expect(removeSection(v, buildSections(NOTE, v, ctx()), 'collections')).toBe(v)
    expect(removeSection(v, buildSections(NOTE, v, ctx()), 'queries')).toBe(v)
  })

  test('Not in any collection and Not tagged are offered in Add a section, not shown by default', () => {
    const v = views()
    const built = buildSections(NOTE, v, ctx())
    expect(addableSections(NOTE, built, ctx()).map((s) => s.key)).toEqual(['inNoCollection', 'notTagged', 'noBacklinks'])
    // A type without tags is not offered "Not tagged".
    expect(addableSections(PLAIN, buildSections(PLAIN, v, ctx()), ctx()).map((s) => s.key)).toEqual(['inNoCollection', 'noBacklinks'])
    // Added, it is a section and a header tab, and no longer offered.
    const add = addableSections(NOTE, built, ctx())[0]
    const next = showSection(v, built, add)
    const after = buildSections(NOTE, next, ctx())
    expect(visibleSections(after).map((s) => s.key)).toEqual([...DEFAULTS, 'inNoCollection'])
    expect(tabSections(after).map((s) => s.key)).toEqual(['inNoCollection'])
    expect(addableSections(NOTE, after, ctx()).map((s) => s.key)).toEqual(['notTagged', 'noBacklinks'])
  })

  test('moveSection reorders and keeps collapse state', () => {
    const v = views(OLD)
    v.dashboard.sections[1].collapsed = true
    const moved = moveSection(v, buildSections(NOTE, v, ctx()), 'notTagged', 'recentlyAccessed')
    expect(moved.dashboard.sections.map((s) => s.key)).toEqual(['notTagged', 'recentlyAccessed', 'collections', 'queries', 'inNoCollection'])
    expect(moved.dashboard.sections.find((s) => s.key === 'collections')?.collapsed).toBe(true)
  })

  test('appendSection adds a query section at the end and un-removes it', () => {
    const v = views(DEFAULTS, ['query:q1'])
    const q = query({ id: 'q1', name: 'Open', definition: { ...query({ id: 'x' }).definition, structures: [{ id: 'note' }] } })
    const next = appendSection(v, buildSections(NOTE, v, ctx({ queries: [q] })), 'query:q1')
    expect(next.dashboard.sections.at(-1)).toEqual({ key: 'query:q1', collapsed: false })
    expect(next.dashboard.removedSections).toEqual([])
  })

  test('addableSections offers removed built-ins, collections and the queries of the type', () => {
    const q1 = query({ id: 'q1', name: 'Mine', definition: { ...query({ id: 'x' }).definition, structures: [{ id: 'note' }] } })
    const q2 = query({ id: 'q2', name: 'Theirs', definition: { ...query({ id: 'x' }).definition, structures: [{ id: 'plain' }] } })
    const c = collection({ id: 'c1', name: 'Reading', typeIds: ['note'] })
    const v = views(['inNoCollection'], ['collections'])
    const c2 = ctx({ collections: [c], queries: [q1, q2] })
    const built = buildSections(NOTE, v, c2)
    // the collection is already a visible section (auto-appended), the query is not; "Not tagged" and "No backlinks" are offered while not shown
    expect(addableSections(NOTE, built, c2).map((s) => s.key)).toEqual(['collections', 'notTagged', 'noBacklinks', 'query:q1'])
  })
})

describe('DailyNote Unreviewed section', () => {
  const DAILY = typeDef({
    id: 'dailynote',
    name: 'DailyNote',
    basic: true,
    propertyDefinitions: [propertyDef({ id: 'reviewed', key: 'reviewed', name: 'Reviewed', type: 'boolean' })],
  })

  test('test DailyNote Overview gets Unreviewed section appended, removable and re-addable', () => {
    const v = views(['recentlyAccessed', 'collections', 'queries', 'inNoCollection'])
    const all = buildSections(DAILY, v, ctx())
    expect(all.map((s) => s.key)).toEqual(['recentlyAccessed', 'collections', 'queries', 'inNoCollection', 'unreviewed'])
    const u = all.find((s) => s.key === 'unreviewed')
    expect([u?.label, u?.inFullView, u?.hidden]).toEqual(['Unreviewed', false, false])
    // Dashboard only: no header tab.
    expect(tabSections(all).map((s) => s.key)).toEqual(['inNoCollection'])
    // Other types never get it, even when it is saved.
    expect(buildSections(NOTE, views(['unreviewed']), ctx()).map((s) => s.key)).toEqual([])
    expect(buildSections(typeDef({ id: 'dailynote', name: 'DailyNote' }), views([]), ctx())).toEqual([])

    const removed = removeSection(v, all, 'unreviewed')
    expect(removed.dashboard.removedSections).toEqual(['unreviewed'])
    const after = buildSections(DAILY, removed, ctx())
    expect(visibleSections(after).map((s) => s.key)).not.toContain('unreviewed')
    expect(hiddenSections(after).map((s) => s.key)).toEqual(['unreviewed'])
    expect(addableSections(DAILY, after, ctx()).map((s) => s.key)).toEqual(['unreviewed'])

    const back = showSection(removed, after, addableSections(DAILY, after, ctx())[0])
    expect(back.dashboard.removedSections).toEqual([])
    expect(back.dashboard.sections.at(-1)).toEqual({ key: 'unreviewed', collapsed: false })
    expect(visibleSections(buildSections(DAILY, back, ctx())).map((s) => s.key).at(-1)).toBe('unreviewed')

    // Hidden reviewing: no section, nothing to add.
    const hiding = { ...DAILY, hideReviewing: true }
    expect(buildSections(hiding, v, ctx()).map((s) => s.key)).not.toContain('unreviewed')
    expect(addableSections(hiding, buildSections(hiding, removed, ctx()), ctx())).toEqual([])
  })

  test('test unreviewed lists notes with reviewed not true, newest first', () => {
    const note = (path: string, values: Record<string, unknown>, title?: string) =>
      row({ summary: objectSummary({ path, type: 'dailynote', title: title ?? path }), values })
    const rows = [
      note('DailyNotes/2026-10-20.md', { reviewed: false, date: { start: '2026-10-20', resolution: 'day' } }),
      note('DailyNotes/2026-10-22.md', { reviewed: true, date: { start: '2026-10-22', resolution: 'day' } }),
      note('DailyNotes/2026-10-24.md', { reviewed: null, date: { start: '2026-10-24', resolution: 'day' } }),
      // No date: the title, else the file stem, gives the day.
      note('DailyNotes/x.md', {}, '2026-10-23'),
      note('DailyNotes/2026-10-21.md', { reviewed: false, date: null }, 'Untitled'),
    ]
    expect(unreviewedRows(rows).map((r) => r.summary.path)).toEqual([
      'DailyNotes/2026-10-24.md',
      'DailyNotes/x.md',
      'DailyNotes/2026-10-21.md',
      'DailyNotes/2026-10-20.md',
    ])
  })
})

describe('No backlinks section (M5)', () => {
  const BL = propertyDef({ id: 'backlinks', key: 'backlinks', name: 'Backlinks', type: 'entity_backlinks' })
  const PERSON = typeDef({ id: 'person', name: 'Person', propertyDefinitions: [TAGS, BL] })

  test('test no backlinks section addable, lists unlinked objects, title and description match the catalog', () => {
    // Not in the default set; offered in "Add a section".
    const all = buildSections(PERSON, views(OLD), ctx())
    expect(all.map((s) => s.key)).toEqual([...OLD])
    const add = addableSections(PERSON, all, ctx())
    expect(add.map((s) => s.key)).toEqual(['noBacklinks'])
    expect(add[0]).toMatchObject({
      label: 'No backlinks',
      icon: 'ph-line-segment',
      inFullView: true,
      description: 'Objects that nothing else links to.',
    })
    expect(SECTION_TEXT.noBacklinks).toBe('No backlinks')
    expect(SECTION_TEXT.noBacklinksDescription).toBe('Objects that nothing else links to.')

    // Added: a visible section and a header tab; buildSections keeps it.
    const v = showSection(views(OLD), all, add[0])
    const after = buildSections(PERSON, v, ctx())
    expect(visibleSections(after).map((s) => s.key).at(-1)).toBe('noBacklinks')
    expect(tabSections(after).map((s) => s.key)).toContain('noBacklinks')
    expect(addableSections(PERSON, after, ctx())).toEqual([])
    // Removed: hidden, and offered again.
    const removed = removeSection(v, after, 'noBacklinks')
    const hid = buildSections(PERSON, removed, ctx())
    expect(hiddenSections(hid).map((s) => s.key)).toEqual(['noBacklinks'])
    expect(addableSections(PERSON, hid, ctx()).map((s) => s.key)).toEqual(['noBacklinks'])

    // Roles that can't have backlinks (DailyNote, Video) never get it, even when saved.
    const DAILY = typeDef({ id: 'dailynote', name: 'DailyNote', basic: true, propertyDefinitions: [BL] })
    const VIDEO = typeDef({ id: 'video', name: 'Video', basic: true, propertyDefinitions: [BL] })
    expect(canHaveBacklinks(DAILY)).toBe(false)
    expect(canHaveBacklinks(VIDEO)).toBe(false)
    expect(canHaveBacklinks(typeDef({ id: 'page', name: 'Page', basic: true }))).toBe(true)
    expect(canHaveBacklinks(typeDef({ id: 'video2', name: 'Video' }))).toBe(true)
    expect(buildSections(VIDEO, views(['noBacklinks']), ctx())).toEqual([])
    expect(addableSections(VIDEO, buildSections(VIDEO, views(OLD), ctx()), ctx())).toEqual([])
    // Every row carries its backlinks (M5 Task 13), so a type without the backlinks definition lists them too.
    expect(buildSections(NOTE, views(['noBacklinks']), ctx()).map((s) => s.key)).toEqual(['noBacklinks'])

    // The rows: those no object links to.
    const P = (path: string, backlinks?: unknown) =>
      row({ summary: objectSummary({ path, type: 'person' }), values: backlinks === undefined ? {} : { backlinks } })
    const rows = [P('a', [{ target: 'B', path: 'b' }]), P('b', []), P('c', null), P('d')]
    expect(noBacklinksRows(rows).map((r) => r.summary.path)).toEqual(['b', 'c', 'd'])
  })
})
