// Two windows of one space share `object.tabs:<root>` and `object.recent:<root>`: each one's
// writes must merge into the other instead of being overwritten at the next navigation
// (audit 2026-11-01 #16).
import { beforeEach, describe, expect, test } from 'vitest'
import { setRecentSpace, useRecent } from './recent'
import { currentTarget, setTabsSpace, useTabs, type Tab, type Target } from './tabs'

const objT = (path: string): Target => ({ kind: 'object', path })
const tab = (id: string, target: Target, extra: Partial<Tab> = {}): Tab => ({ id, history: [target], index: 0, crumbs: [[]], ...extra })

interface Persisted<T> {
  state: T
  version: number
}

function stored<T>(key: string): Persisted<T> {
  return JSON.parse(localStorage.getItem(key)!) as Persisted<T>
}

/** What the browser does in this window when another window of the same origin wrote `key`. */
function otherWindowWrote(key: string, next: Persisted<unknown>) {
  const oldValue = localStorage.getItem(key)
  const newValue = JSON.stringify(next)
  localStorage.setItem(key, newValue)
  window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage }))
}

beforeEach(async () => {
  localStorage.clear()
  useTabs.getState().reset()
  useRecent.getState().clear()
  await setTabsSpace('/s')
  await setRecentSpace('/s')
})

describe('tabs in two windows', () => {
  const key = 'object.tabs:/s'

  test("another window's new tabs join ours; our active tab stays active", () => {
    const s = useTabs.getState
    s().open(objT('Projects/P1.md'))
    const mineId = s().activeId!
    const mine = stored<{ tabs: Tab[]; activeId: string }>(key)
    expect(mine.state.tabs).toHaveLength(1)

    // Window B (same space) opened two more tabs, made one active, and persisted the lot.
    otherWindowWrote(key, { ...mine, state: { tabs: [...mine.state.tabs, tab('tB1', { kind: 'trash' }), tab('tB2', { kind: 'tasks' })], activeId: 'tB2' } })
    expect(s().tabs.map((t) => t.id)).toEqual([mineId, 'tB1', 'tB2'])
    expect(s().activeId).toBe(mineId)

    // Our next navigation writes the union, not just our own tabs.
    s().open(objT('Projects/P2.md'))
    const after = stored<{ tabs: Tab[] }>(key)
    expect(after.state.tabs.map((t) => t.id)).toEqual([mineId, 'tB1', 'tB2'])
    expect(currentTarget(s())).toEqual(objT('Projects/P2.md'))
  })

  test('a tab the other window closed is closed here too, but never our active one', () => {
    const s = useTabs.getState
    s().open(objT('Projects/P1.md'))
    const mineId = s().activeId!
    const mine = stored<{ tabs: Tab[]; activeId: string }>(key)
    otherWindowWrote(key, { ...mine, state: { tabs: [...mine.state.tabs, tab('tB1', { kind: 'trash' }), tab('tB2', { kind: 'tasks' })], activeId: 'tB2' } })
    expect(s().tabs).toHaveLength(3)

    // B closes tB1, and our tab (which it also sees).
    const before = stored<{ tabs: Tab[]; activeId: string }>(key)
    otherWindowWrote(key, { ...before, state: { tabs: [tab('tB2', { kind: 'tasks' })], activeId: 'tB2' } })
    expect(s().tabs.map((t) => t.id)).toEqual([mineId, 'tB2'])
    expect(s().activeId).toBe(mineId)
  })

  test("the other window's navigation in a shared, non-active tab is taken over", () => {
    const s = useTabs.getState
    s().open(objT('Projects/P1.md'))
    const mineId = s().activeId!
    const mine = stored<{ tabs: Tab[]; activeId: string }>(key)
    otherWindowWrote(key, { ...mine, state: { tabs: [...mine.state.tabs, tab('tB1', { kind: 'trash' })], activeId: 'tB1' } })
    const before = stored<{ tabs: Tab[]; activeId: string }>(key)
    otherWindowWrote(key, {
      ...before,
      state: { tabs: [...mine.state.tabs, tab('tB1', { kind: 'tasks' }, { persistent: true })], activeId: 'tB1' },
    })
    const b = s().tabs.find((t) => t.id === 'tB1')!
    expect(b.history).toEqual([{ kind: 'tasks' }])
    expect(b.persistent).toBe(true)
    // Our active tab is ours alone: the other window's stale copy of it changes nothing.
    expect(s().tabs.find((t) => t.id === mineId)!.history).toEqual([objT('Projects/P1.md')])
  })

  test('writes to another key, another space or garbage are ignored', () => {
    const s = useTabs.getState
    s().open(objT('Projects/P1.md'))
    const mine = stored<{ tabs: Tab[]; activeId: string }>(key)
    otherWindowWrote('object.tabs:/other', { ...mine, state: { tabs: [tab('tX', { kind: 'trash' })], activeId: 'tX' } })
    localStorage.setItem(key, 'not json')
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue: JSON.stringify(mine), newValue: 'not json', storageArea: localStorage }))
    expect(s().tabs).toHaveLength(1)
  })
})

describe('recent in two windows', () => {
  const key = 'object.recent:/s'

  test("the other window's newest entries come first, ours are kept", () => {
    const r = useRecent.getState
    r().add('A.md')
    r().add('B.md')
    const mine = stored<{ paths: string[] }>(key)
    expect(mine.state.paths).toEqual(['B.md', 'A.md'])
    // Window B last read ['B.md', 'A.md'] and then opened C and A.
    otherWindowWrote(key, { ...mine, state: { paths: ['A.md', 'C.md', 'B.md'] } })
    expect(r().paths).toEqual(['C.md', 'B.md', 'A.md'])
    r().add('D.md')
    expect(stored<{ paths: string[] }>(key).state.paths).toEqual(['D.md', 'C.md', 'B.md', 'A.md'])
  })
})
