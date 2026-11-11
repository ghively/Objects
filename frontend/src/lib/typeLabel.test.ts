import { describe, expect, test } from 'vitest'
import { typeDef } from '@/test/mockApi'
import { isBuiltInDailyNote, isBuiltInPage, typeLabel, typePlural } from './typeLabel'

describe('typeLabel / typePlural (M32: display names of types)', () => {
  test('test the built-in Page reads Note / Notes', () => {
    const page = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
    expect(typeLabel(page)).toBe('Note')
    expect(typePlural(page)).toBe('Notes')
    expect(isBuiltInPage(page)).toBe(true)
    // The stored names are not changed.
    expect(page.name).toBe('Page')
    expect(page.pluralName).toBe('Pages')
  })

  test('test the built-in DailyNote reads Daily note / Daily notes', () => {
    const daily = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true })
    expect(typeLabel(daily)).toBe('Daily note')
    expect(typePlural(daily)).toBe('Daily notes')
    expect(isBuiltInDailyNote(daily)).toBe(true)
  })

  test('test a built-in type is known by its id or its basic flag', () => {
    // A fixture or an older answer without `basic`: the id says it is the built-in one.
    expect(typeLabel({ id: 'page', name: 'Page', pluralName: 'Pages' })).toBe('Note')
    expect(typeLabel({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes' })).toBe('Daily note')
    // A basic type under another id (a hand-made type file named Page).
    expect(typeLabel({ id: 'p1', name: 'Page', pluralName: 'Pages', basic: true })).toBe('Note')
    expect(typePlural({ id: 'd1', name: 'DailyNote', pluralName: 'DailyNotes', basic: true })).toBe('Daily notes')
  })

  test('test a renamed built-in type keeps the name the user gave it', () => {
    const renamed = typeDef({ id: 'page', name: 'Document', pluralName: 'Documents', basic: true })
    expect(typeLabel(renamed)).toBe('Document')
    expect(typePlural(renamed)).toBe('Documents')
    expect(isBuiltInPage(renamed)).toBe(false)
    const journal = typeDef({ id: 'dailynote', name: 'Journal', pluralName: 'Journal', basic: true })
    expect(typeLabel(journal)).toBe('Journal')
    expect(typePlural(journal)).toBe('Journal')
  })

  test('test a plural the user changed is kept on its own', () => {
    const page = typeDef({ id: 'page', name: 'Page', pluralName: 'Writings', basic: true })
    expect(typeLabel(page)).toBe('Note')
    expect(typePlural(page)).toBe('Writings')
    const daily = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'Days', basic: true })
    expect(typeLabel(daily)).toBe('Daily note')
    expect(typePlural(daily)).toBe('Days')
  })

  test('test every other type shows its own name and plural', () => {
    const task = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true })
    expect(typeLabel(task)).toBe('Task')
    expect(typePlural(task)).toBe('Tasks')
    const person = typeDef({ id: 'person', name: 'Person', pluralName: 'People' })
    expect(typeLabel(person)).toBe('Person')
    expect(typePlural(person)).toBe('People')
    // A user type that happens to be called Page, neither basic nor the built-in id.
    const own = typeDef({ id: 'web-page', name: 'Page', pluralName: 'Pages', basic: false })
    expect(typeLabel(own)).toBe('Page')
    expect(typePlural(own)).toBe('Pages')
    // The exact stored name only: "page" or "Daily Note" is a name someone typed.
    expect(typeLabel({ id: 'page', name: 'page', pluralName: 'pages', basic: true })).toBe('page')
    expect(typeLabel({ id: 'x', name: 'Daily Note', pluralName: 'Daily Notes', basic: true })).toBe('Daily Note')
  })

  test('test no type gives the fallback', () => {
    expect(typeLabel(undefined)).toBe('')
    expect(typeLabel(null, 'page')).toBe('page')
    expect(typePlural(undefined)).toBe('')
    expect(typePlural(null, 'Pages')).toBe('Pages')
  })
})
