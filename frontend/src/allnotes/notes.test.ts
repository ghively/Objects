// M32: what the notes lists (Home's "Recent", the Notes view) hold and how they are ordered.
import { describe, expect, test } from 'vitest'
import { objectSummary, typeDef } from '@/test/mockApi'
import { editedAt, editedGroup, isListedNote, NOTES_GROUPS, recentNotes } from './notes'

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true })
const TAG = typeDef({ id: 'tag', name: 'Tag', pluralName: 'Tags', basic: true })
const DAILY = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true })
const TYPES = { page: PAGE, task: TASK, tag: TAG, dailynote: DAILY }

describe('notes lists (M32)', () => {
  test('test a note is listed unless it is a task, a tag or a template; daily notes are listed', () => {
    expect(isListedNote(objectSummary({ path: 'Pages/A.md', type: 'page' }), TYPES)).toBe(true)
    expect(isListedNote(objectSummary({ path: 'DailyNotes/2026-11-11.md', type: 'dailynote' }), TYPES)).toBe(true)
    expect(isListedNote(objectSummary({ path: 'Tasks/T.md', type: 'task' }), TYPES)).toBe(false)
    expect(isListedNote(objectSummary({ path: 'Tags/x.md', type: 'tag' }), TYPES)).toBe(false)
    expect(isListedNote(objectSummary({ path: 'Pages/T.md', type: 'page', template: 'Meeting' }), TYPES)).toBe(false)
    // A type the index doesn't know yet is read by its id.
    expect(isListedNote(objectSummary({ path: 'Tasks/T.md', type: 'task' }), {})).toBe(false)
  })

  test('test editedAt is the last update, else the creation time', () => {
    expect(editedAt(objectSummary({ path: 'a.md', lastUpdated: '2026-11-10T09:00:00.000Z', createdAt: '2026-11-01T09:00:00.000Z' }))).toBe(
      '2026-11-10T09:00:00.000Z',
    )
    expect(editedAt(objectSummary({ path: 'a.md', lastUpdated: null, createdAt: '2026-11-01T09:00:00.000Z' }))).toBe('2026-11-01T09:00:00.000Z')
    expect(editedAt(objectSummary({ path: 'a.md', lastUpdated: null, createdAt: null }))).toBe('')
  })

  test('test recentNotes: the last 12 edited, newest first, daily notes in, tasks and tags out', () => {
    const at = (n: number) => `2026-11-${String(n).padStart(2, '0')}T10:00:00.000Z`
    const pages = Array.from({ length: 14 }, (_, i) => objectSummary({ path: `Pages/P${i + 1}.md`, type: 'page', lastUpdated: at(i + 1) }))
    const list = recentNotes(
      [
        ...pages,
        objectSummary({ path: 'DailyNotes/2026-11-20.md', type: 'dailynote', lastUpdated: at(20) }),
        objectSummary({ path: 'Tasks/T.md', type: 'task', lastUpdated: at(25) }),
        objectSummary({ path: 'Tags/x.md', type: 'tag', lastUpdated: at(26) }),
        objectSummary({ path: 'Pages/Never.md', type: 'page', lastUpdated: null, createdAt: null }),
      ],
      [PAGE, TASK, TAG, DAILY],
    )
    expect(list).toHaveLength(12)
    expect(list[0].path).toBe('DailyNotes/2026-11-20.md')
    expect(list[1].path).toBe('Pages/P14.md')
    expect(list.at(-1)?.path).toBe('Pages/P4.md')
    expect(list.some((o) => o.type === 'task' || o.type === 'tag')).toBe(false)
  })

  test('test editedGroup: Today, Yesterday, This week (the five days before), Earlier', () => {
    const today = '2026-11-11'
    expect(NOTES_GROUPS.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'This week', 'Earlier'])
    expect(editedGroup('2026-11-11', today)).toBe('today')
    expect(editedGroup('2026-11-10', today)).toBe('yesterday')
    expect(editedGroup('2026-11-09', today)).toBe('thisWeek')
    expect(editedGroup('2026-11-05', today)).toBe('thisWeek')
    expect(editedGroup('2026-11-04', today)).toBe('earlier')
    expect(editedGroup('2025-01-01', today)).toBe('earlier')
    // Nothing known about when: Earlier. A clock that ran ahead: Today.
    expect(editedGroup('', today)).toBe('earlier')
    expect(editedGroup('2026-11-12', today)).toBe('today')
  })
})
