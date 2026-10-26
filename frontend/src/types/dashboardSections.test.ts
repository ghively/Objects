import { describe, expect, test } from 'vitest'
import type { Views } from '@/api/types'
import { collection, defaultViews, propertyDef, query, typeDef } from '@/test/mockApi'
import {
  addableSections,
  appendSection,
  buildSections,
  hiddenSections,
  moveSection,
  removeSection,
  sectionInFullView,
  showSection,
  tabSections,
  visibleSections,
} from './dashboardSections'

const TAGS = propertyDef({ id: 'tags', key: 'tags', name: 'Tags', type: 'entity_tags' })
const NOTE = typeDef({ id: 'note', name: 'Note', propertyDefinitions: [TAGS] })
const PLAIN = typeDef({ id: 'plain', name: 'Plain' })

const DEFAULTS = ['recentlyAccessed', 'collections', 'queries', 'inNoCollection', 'notTagged'] as const

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
    expect(buildSections(PLAIN, views(), ctx()).map((s) => s.key)).toEqual(DEFAULTS.filter((k) => k !== 'notTagged'))
  })

  test('labels, icons and the full-view flag come from the kind', () => {
    const s = buildSections(NOTE, views(), ctx())
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
    // pinned, noBacklinks and a deleted query have nothing to show
    expect(buildSections(NOTE, views(['pinned', 'noBacklinks', 'query:gone']), ctx()).map((s) => s.key)).toEqual([])
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
    const all = buildSections(NOTE, views([...DEFAULTS, 'query:q1']), ctx({ collections: [c], queries: [q] }))
    expect(tabSections(all).map((s) => s.key)).toEqual(['inNoCollection', 'notTagged', 'query:q1', 'collection:c1'])
  })
})

describe('section edits', () => {
  const all = () => buildSections(NOTE, views(), ctx())

  test('removeSection moves the key to removedSections and showSection brings it back', () => {
    const v = views()
    const removed = removeSection(v, all(), 'collections')
    expect(removed.dashboard.sections.map((s) => s.key)).toEqual(['recentlyAccessed', 'queries', 'inNoCollection', 'notTagged'])
    expect(removed.dashboard.removedSections).toEqual(['collections'])

    const after = buildSections(NOTE, removed, ctx())
    expect(hiddenSections(after).map((s) => s.key)).toEqual(['collections'])
    expect(visibleSections(after)).toHaveLength(4)

    const back = showSection(removed, after, hiddenSections(after)[0])
    expect(back.dashboard.removedSections).toEqual([])
    expect(back.dashboard.sections.map((s) => s.key)).toEqual(['recentlyAccessed', 'queries', 'inNoCollection', 'notTagged', 'collections'])
  })

  test('moveSection reorders and keeps collapse state', () => {
    const v = views()
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
    // the collection is already a visible section (auto-appended), the query is not
    expect(addableSections(NOTE, built, c2).map((s) => s.key)).toEqual(['collections', 'query:q1'])
  })
})
