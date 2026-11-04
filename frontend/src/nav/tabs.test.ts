import { beforeEach, describe, expect, test } from 'vitest'
import { useRecent } from './recent'
import { activeTab, currentTarget, sameTarget, usePeek, useTabs, type Target } from './tabs'

const typeT = (typeId: string): Target => ({ kind: 'type', typeId })
const objT = (path: string): Target => ({ kind: 'object', path })

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useRecent.getState().clear()
})

describe('useTabs', () => {
  test('back/forward history per tab', () => {
    const s = useTabs.getState
    s().open(typeT('task'))
    s().open(objT('Tasks/Fix printer.md'))
    s().open(objT('Tasks/Write docs.md'))
    expect(currentTarget(s())).toEqual(objT('Tasks/Write docs.md'))

    s().back()
    expect(currentTarget(s())).toEqual(objT('Tasks/Fix printer.md'))
    s().back()
    expect(currentTarget(s())).toEqual(typeT('task'))
    s().back() // at the start: no-op
    expect(currentTarget(s())).toEqual(typeT('task'))
    s().forward()
    expect(currentTarget(s())).toEqual(objT('Tasks/Fix printer.md'))

    // A second tab keeps its own history; the first is untouched.
    const firstId = s().activeId
    s().open(typeT('person'), { newTab: true })
    s().open(objT('People/Ada Lovelace.md'))
    s().back()
    expect(currentTarget(s())).toEqual(typeT('person'))
    s().activate(firstId!)
    expect(currentTarget(s())).toEqual(objT('Tasks/Fix printer.md'))

    // Opening after going back drops the forward entries.
    s().open(objT('Pages/Notes.md'))
    s().forward()
    expect(currentTarget(s())).toEqual(objT('Pages/Notes.md'))
    expect(activeTab(s())!.history).toEqual([typeT('task'), objT('Tasks/Fix printer.md'), objT('Pages/Notes.md')])
  })

  test('open newTab adds tab', () => {
    const s = useTabs.getState
    s().open(typeT('task'))
    expect(s().tabs).toHaveLength(1)
    s().open(objT('Tasks/Fix printer.md'), { newTab: true })
    expect(s().tabs).toHaveLength(2)
    expect(s().activeId).toBe(s().tabs[1].id)
    expect(currentTarget(s())).toEqual(objT('Tasks/Fix printer.md'))

    // Opening without newTab navigates the active tab instead.
    s().open(objT('Tasks/Write docs.md'))
    expect(s().tabs).toHaveLength(2)

    // Closing the active tab activates the most recently opened one.
    s().close(s().tabs[1].id)
    expect(s().tabs).toHaveLength(1)
    expect(currentTarget(s())).toEqual(typeT('task'))
  })

  test('closing the active tab activates the most recently opened tab, not a neighbour', () => {
    const s = useTabs.getState
    s().open(typeT('a'))
    s().open(typeT('b'), { newTab: true })
    s().open(typeT('c'), { newTab: true })
    const [a, b, c] = s().tabs.map((t) => t.id)
    s().activate(a)
    s().activate(c)
    s().close(c)
    expect(s().activeId).toBe(a)
    s().activate(b)
    s().close(b)
    expect(s().activeId).toBe(a)
  })

  test('a pinned tab is never closed, by any path', () => {
    const s = useTabs.getState
    s().open(typeT('a'))
    s().open(typeT('b'), { newTab: true })
    const pinned = s().tabs[1].id
    s().pin(pinned)
    s().close(pinned)
    expect(s().tabs.map((t) => t.id)).toContain(pinned)
    expect(s().activeId).toBe(pinned)
  })

  test('opening with no tabs creates one', () => {
    const s = useTabs.getState
    expect(s().tabs).toHaveLength(0)
    s().open(typeT('page'))
    expect(s().tabs).toHaveLength(1)
    expect(currentTarget(s())).toEqual(typeT('page'))
  })

  test('persists to localStorage', () => {
    useTabs.getState().open(typeT('server'))
    const raw = localStorage.getItem('object.tabs')
    expect(raw).toBeTruthy()
    expect(raw).toContain('server')
  })
})

describe('usePeek', () => {
  test('steps through the list and clamps at the ends', () => {
    const p = usePeek.getState
    p().peek('b.md', ['a.md', 'b.md', 'c.md'])
    expect(p().path).toBe('b.md')
    expect(p().index).toBe(1)
    p().next()
    expect(p().path).toBe('c.md')
    p().next()
    expect(p().path).toBe('c.md')
    p().prev()
    p().prev()
    expect(p().path).toBe('a.md')
    p().close()
    expect(p().path).toBeNull()
  })

  test('peek without a list is a list of one', () => {
    usePeek.getState().peek('x.md')
    expect(usePeek.getState().list).toEqual(['x.md'])
    expect(usePeek.getState().index).toBe(0)
  })
})

describe('retarget', () => {
  test('test retarget rewrites history and peek list', () => {
    const s = useTabs.getState
    s().open(objT('Pages/Old.md'))
    s().open(typeT('page'))
    s().open(objT('Pages/Other.md'), { newTab: true })
    s().open(objT('Pages/Old.md'))
    usePeek.getState().peek('Pages/Old.md', ['Pages/A.md', 'Pages/Old.md', 'Pages/B.md'])

    s().retarget('Pages/Old.md', 'Pages/New.md')

    expect(s().tabs[0].history).toEqual([objT('Pages/New.md'), typeT('page')])
    expect(s().tabs[1].history).toEqual([objT('Pages/Other.md'), objT('Pages/New.md')])
    expect(currentTarget(s())).toEqual(objT('Pages/New.md'))
    expect(usePeek.getState().path).toBe('Pages/New.md')
    expect(usePeek.getState().list).toEqual(['Pages/A.md', 'Pages/New.md', 'Pages/B.md'])
    expect(usePeek.getState().index).toBe(1)

    // Unrelated paths and a second call are no-ops.
    const before = s().tabs
    s().retarget('Pages/Missing.md', 'Pages/X.md')
    expect(s().tabs).toBe(before)
  })
})

describe('collection, query, queries and allNotes targets', () => {
  test('test collection, query, queries and allNotes targets open and go back', () => {
    const s = useTabs.getState
    s().open(typeT('task'))
    for (const t of [
      { kind: 'collection', id: 'reading' },
      { kind: 'query', id: 'open-tasks' },
      { kind: 'queries' },
      { kind: 'allNotes' },
    ] as Target[]) {
      s().open(t)
      expect(currentTarget(s())).toEqual(t)
    }
    s().back()
    expect(currentTarget(s())).toEqual({ kind: 'queries' })
    s().back()
    expect(currentTarget(s())).toEqual({ kind: 'query', id: 'open-tasks' })
    s().back()
    expect(currentTarget(s())).toEqual({ kind: 'collection', id: 'reading' })
    s().back()
    expect(currentTarget(s())).toEqual(typeT('task'))
  })

  test('sameTarget compares ids, and the singleton targets are always equal', () => {
    expect(sameTarget({ kind: 'collection', id: 'a' }, { kind: 'collection', id: 'a' })).toBe(true)
    expect(sameTarget({ kind: 'collection', id: 'a' }, { kind: 'query', id: 'a' })).toBe(false)
    expect(sameTarget({ kind: 'query', id: 'a' }, { kind: 'query', id: 'b' })).toBe(false)
    expect(sameTarget({ kind: 'queries' }, { kind: 'queries' })).toBe(true)
    expect(sameTarget({ kind: 'allNotes' }, { kind: 'allNotes' })).toBe(true)
    // Re-opening the same target is a no-op.
    useTabs.getState().open({ kind: 'queries' })
    useTabs.getState().open({ kind: 'queries' })
    expect(activeTab(useTabs.getState())?.history).toHaveLength(1)
  })
})

describe('calendar and tasks targets', () => {
  test('test calendar and tasks targets open, go back, same target dedupes', () => {
    const s = useTabs.getState
    s().open({ kind: 'allNotes' })
    s().open({ kind: 'calendar' })
    expect(currentTarget(s())).toEqual({ kind: 'calendar' })
    s().open({ kind: 'calendar' })
    expect(activeTab(s())?.history).toHaveLength(2)
    s().open({ kind: 'tasks' })
    s().open({ kind: 'tasks' })
    expect(activeTab(s())?.history).toHaveLength(3)
    expect(currentTarget(s())).toEqual({ kind: 'tasks' })
    s().back()
    expect(currentTarget(s())).toEqual({ kind: 'calendar' })
    s().back()
    expect(currentTarget(s())).toEqual({ kind: 'allNotes' })
    expect(sameTarget({ kind: 'calendar' }, { kind: 'calendar' })).toBe(true)
    expect(sameTarget({ kind: 'tasks' }, { kind: 'tasks' })).toBe(true)
    expect(sameTarget({ kind: 'calendar' }, { kind: 'tasks' })).toBe(false)
  })
})

describe('graph target', () => {
  test('test graph target opens, goes back, dedupes; tab label Graph', () => {
    // The tab label itself is App's (`App.m5.test.tsx`); here the target's navigation.
    const s = useTabs.getState
    s().open({ kind: 'allNotes' })
    s().open({ kind: 'graph' })
    expect(currentTarget(s())).toEqual({ kind: 'graph' })
    s().open({ kind: 'graph' })
    expect(activeTab(s())?.history).toHaveLength(2)
    s().back()
    expect(currentTarget(s())).toEqual({ kind: 'allNotes' })
    s().forward()
    expect(currentTarget(s())).toEqual({ kind: 'graph' })
    s().open({ kind: 'graph' }, { newTab: true })
    expect(s().tabs).toHaveLength(2)
    expect(sameTarget({ kind: 'graph' }, { kind: 'graph' })).toBe(true)
    expect(sameTarget({ kind: 'graph' }, { kind: 'calendar' })).toBe(false)
    expect(useRecent.getState().paths).toEqual([])
  })
})

describe('useRecent', () => {
  test('objects opened in a tab or the peek are recorded, newest first, without duplicates', () => {
    useTabs.getState().open(objT('Tasks/A.md'))
    useTabs.getState().open(typeT('task'))
    usePeek.getState().peek('Tasks/B.md')
    useTabs.getState().open(objT('Tasks/A.md'))
    expect(useRecent.getState().paths).toEqual(['Tasks/A.md', 'Tasks/B.md'])
  })

  test('keeps at most 50 and follows a rename', () => {
    for (let i = 0; i < 60; i++) useRecent.getState().add(`P/${i}.md`)
    expect(useRecent.getState().paths).toHaveLength(50)
    expect(useRecent.getState().paths[0]).toBe('P/59.md')
    useTabs.getState().retarget('P/59.md', 'P/renamed.md')
    expect(useRecent.getState().paths[0]).toBe('P/renamed.md')
  })
})
