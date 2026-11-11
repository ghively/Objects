import { describe, expect, test } from 'vitest'
import type { QueryDefinition } from '@/api/types'
import { emptyFilterGroup } from '@/views/model'
import { autoTitle, queryTitle, titleIsCustom } from './autoTitle'

const ctx = {
  types: [
    { id: 'server', pluralName: 'Servers' },
    { id: 'page', pluralName: 'Pages' },
  ],
  tagIdsToTitles: { t1: 'urgent', t2: 'old' },
}
const def = (over: Partial<QueryDefinition> = {}): QueryDefinition => ({
  types: [],
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
  ...over,
})

describe('autoTitle type names (M32)', () => {
  test('test the built-in Page and DailyNote read Notes and Daily notes; a renamed type keeps its plural', () => {
    const named = {
      types: [
        { id: 'page', name: 'Page', pluralName: 'Pages', basic: true },
        { id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true },
        { id: 'server', name: 'Server', pluralName: 'Servers', basic: false },
      ],
      tagIdsToTitles: { t1: 'urgent' },
    }
    expect(autoTitle(def({ types: [{ id: 'page' }, { id: 'dailynote' }, { id: 'server' }] }), named)).toBe('Notes, Daily notes, Servers')
    expect(autoTitle(def({ types: [{ id: 'page' }], tags: { ids: ['t1'], operator: 'or' } }), named)).toBe('Notes tagged urgent')
    const renamed = { ...named, types: [{ id: 'page', name: 'Doc', pluralName: 'Docs', basic: true }] }
    expect(autoTitle(def({ types: [{ id: 'page' }] }), renamed)).toBe('Docs')
  })
})

describe('autoTitle', () => {
  test('test autoTitle types and tags, All notes without types; custom title sticks; absent titleIsCustom with a name counts as custom', () => {
    expect(autoTitle(def(), ctx)).toBe('All notes')
    expect(autoTitle(def({ types: [{ id: 'server' }, { id: 'page' }] }), ctx)).toBe('Servers, Pages')
    expect(
      autoTitle(
        def({
          types: [{ id: 'page' }],
          tags: { ids: ['t1'], operator: 'or' },
          excludeTags: { ids: ['t2'] },
          search: { searchTerms: [{ text: 'plan' }], searchMode: 'auto' },
        }),
        ctx,
      ),
    ).toBe('Pages tagged urgent not tagged old "plan"')

    const d = def({ types: [{ id: 'page' }] })
    expect(queryTitle({ name: 'Mine', titleIsCustom: true, definition: d }, ctx)).toBe('Mine')
    expect(queryTitle({ name: 'Stale', titleIsCustom: false, definition: d }, ctx)).toBe('Pages')
    expect(titleIsCustom({ name: 'Named' } as { name: string; titleIsCustom: boolean })).toBe(true)
    expect(titleIsCustom({ name: '' } as { name: string; titleIsCustom: boolean })).toBe(false)
  })
})
