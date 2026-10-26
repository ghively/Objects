import { beforeEach, describe, expect, test } from 'vitest'
import { activeTab, currentTarget, usePeek, useTabs, type Target } from './tabs'

const typeT = (typeId: string): Target => ({ kind: 'type', typeId })
const objT = (path: string): Target => ({ kind: 'object', path })

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
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

    // Closing the active tab activates its neighbour.
    s().close(s().tabs[1].id)
    expect(s().tabs).toHaveLength(1)
    expect(currentTarget(s())).toEqual(typeT('task'))
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
