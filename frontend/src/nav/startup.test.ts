// "When this space opens" (audit 2026-11-01): a specific object reuses a tab already showing it,
// and never stacks a new tab per start behind a persistent active tab.
import { beforeEach, describe, expect, test } from 'vitest'
import { useCalendar } from '@/calendar/useCalendar'
import { applyOpenOnStart } from './startup'
import { currentTarget, useTabs } from './tabs'

const B = { kind: 'object', path: 'Pages/B.md' } as const

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
})

describe('applyOpenOnStart', () => {
  test('specific object: a tab already showing it is activated, not duplicated', () => {
    const t = useTabs.getState()
    t.open({ kind: 'object', path: 'Pages/A.md' })
    t.open(B, { newTab: true })
    const bId = useTabs.getState().activeId!
    t.open({ kind: 'trash' }, { newTab: true })
    applyOpenOnStart({ mode: 'specificObject', path: B.path })
    expect(useTabs.getState().tabs).toHaveLength(3)
    expect(useTabs.getState().activeId).toBe(bId)
    expect(currentTarget(useTabs.getState())).toEqual(B)
  })

  test('specific object behind a persistent active tab: the same tab count after every start', () => {
    const t = useTabs.getState()
    t.open({ kind: 'object', path: 'Pages/A.md' })
    const aId = useTabs.getState().activeId!
    t.togglePersistent(aId)
    applyOpenOnStart({ mode: 'specificObject', path: B.path })
    // Start-up navigates the active tab even though it is persistent: no second tab.
    expect(currentTarget(useTabs.getState())).toEqual(B)
    expect(useTabs.getState().activeId).toBe(aId)
    expect(useTabs.getState().tabs).toHaveLength(1)
    // The user quits with B open and starts twice more.
    applyOpenOnStart({ mode: 'specificObject', path: B.path })
    applyOpenOnStart({ mode: 'specificObject', path: B.path })
    expect(useTabs.getState().tabs).toHaveLength(1)
    expect(useTabs.getState().tabs[0].persistent).toBe(true)
  })

  test('today and calendar open the Calendar; last opened page keeps the tabs', () => {
    const t = useTabs.getState()
    t.open({ kind: 'object', path: 'Pages/A.md' })
    applyOpenOnStart({ mode: 'lastOpenedPage' })
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Pages/A.md' })
    applyOpenOnStart({ mode: 'today' })
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'calendar' })
    expect(useCalendar.getState().view).toBe('day')
  })

  // M32: "Home" shows Home (an empty tab) in the active tab; "Where I left off" with nothing to
  // restore is Home too.
  test('test home shows Home in the active tab and stacks no tab per start', () => {
    const t = useTabs.getState()
    t.open({ kind: 'object', path: 'Pages/A.md' })
    const aId = useTabs.getState().activeId!
    applyOpenOnStart({ mode: 'home' })
    expect(currentTarget(useTabs.getState())).toBeNull()
    expect(useTabs.getState().activeId).toBe(aId)
    expect(useTabs.getState().tabs).toHaveLength(1)
    applyOpenOnStart({ mode: 'home' })
    expect(useTabs.getState().tabs).toHaveLength(1)
  })

  test('test home leaves a persistent or pinned tab alone and uses an empty tab, a new one only when none is', () => {
    const t = useTabs.getState()
    t.open({ kind: 'object', path: 'Pages/A.md' })
    const aId = useTabs.getState().activeId!
    t.togglePersistent(aId)
    applyOpenOnStart({ mode: 'home' })
    expect(useTabs.getState().tabs).toHaveLength(2)
    expect(currentTarget(useTabs.getState())).toBeNull()
    expect(useTabs.getState().tabs[0].history).toEqual([{ kind: 'object', path: 'Pages/A.md' }])
    // The next start, with the persistent tab active again: the empty tab is reused.
    useTabs.getState().activate(aId)
    applyOpenOnStart({ mode: 'home' })
    expect(useTabs.getState().tabs).toHaveLength(2)
    expect(currentTarget(useTabs.getState())).toBeNull()
  })

  test('test where I left off with nothing to restore is Home: no tab, no target, nothing opened', () => {
    applyOpenOnStart({ mode: 'lastOpenedPage' })
    expect(useTabs.getState().tabs).toHaveLength(0)
    expect(currentTarget(useTabs.getState())).toBeNull()
    applyOpenOnStart(undefined)
    expect(currentTarget(useTabs.getState())).toBeNull()
  })
})
