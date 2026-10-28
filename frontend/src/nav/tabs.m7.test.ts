import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { setRecentSpace, useRecent } from './recent'
import { activeTab, crumbIndex, currentTarget, HISTORY_LIMIT, setTabsSpace, usePeek, useTabs, type Target } from './tabs'

const typeT = (typeId: string): Target => ({ kind: 'type', typeId })
const objT = (path: string): Target => ({ kind: 'object', path })
const s = useTabs.getState

beforeEach(async () => {
  await setTabsSpace(null)
  await setRecentSpace(null)
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useRecent.getState().clear()
})

afterEach(async () => {
  await setTabsSpace(null)
  await setRecentSpace(null)
})

describe('persistent tabs', () => {
  test('test persistent tab opens new pages in a new tab', () => {
    s().open(typeT('task'))
    s().open(objT('Tasks/A.md'))
    const first = s().activeId!
    s().open(typeT('person'), { newTab: true })
    const last = s().activeId!
    s().activate(first)
    s().togglePersistent(first)

    s().open(objT('Tasks/B.md'))
    expect(s().tabs.map((t) => t.id)).toEqual([first, expect.any(String), last])
    const inserted = s().tabs[1]
    expect(s().activeId).toBe(inserted.id)
    expect(inserted.persistent).toBeFalsy()
    expect(currentTarget(s())).toEqual(objT('Tasks/B.md'))
    // The persistent tab kept its page, and back and forward stay in it.
    expect(s().tabs[0].history).toEqual([typeT('task'), objT('Tasks/A.md')])
    s().activate(first)
    s().back()
    expect(currentTarget(s())).toEqual(typeT('task'))
    expect(s().tabs).toHaveLength(3)
    s().forward()
    expect(currentTarget(s())).toEqual(objT('Tasks/A.md'))
    // Opening the page it already shows is a no-op.
    s().open(objT('Tasks/A.md'))
    expect(s().tabs).toHaveLength(3)
  })

  test('test non-persistent tab navigates in place', () => {
    s().open(typeT('task'))
    s().open(objT('Tasks/A.md'))
    expect(s().tabs).toHaveLength(1)
    expect(activeTab(s())!.history).toEqual([typeT('task'), objT('Tasks/A.md')])
  })

  test('togglePersistent flips back', () => {
    s().open(typeT('task'))
    const id = s().activeId!
    s().togglePersistent(id)
    expect(activeTab(s())!.persistent).toBe(true)
    s().togglePersistent(id)
    expect(activeTab(s())!.persistent).toBe(false)
    s().open(objT('Tasks/A.md'))
    expect(s().tabs).toHaveLength(1)
  })
})

describe('pinned tabs', () => {
  test('pin moves a tab to the end of the pinned group; unpin to the start of the rest', () => {
    s().open(typeT('a'))
    s().open(typeT('b'), { newTab: true })
    s().open(typeT('c'), { newTab: true })
    const [a, b, c] = s().tabs.map((t) => t.id)
    s().pin(c)
    expect(s().tabs.map((t) => t.id)).toEqual([c, a, b])
    s().pin(b)
    expect(s().tabs.map((t) => t.id)).toEqual([c, b, a])
    // New tabs go after the pinned ones.
    s().newTab()
    expect(s().tabs.slice(0, 2).map((t) => t.id)).toEqual([c, b])
    s().unpin(c)
    expect(s().tabs.slice(0, 2).map((t) => t.id)).toEqual([b, c])
    expect(s().tabs.find((t) => t.id === c)!.pinned).toBe(false)
  })

  test('persisted tabs come back pinned first', () => {
    localStorage.setItem(
      'object.tabs',
      JSON.stringify({
        state: {
          tabs: [
            { id: 'x', history: [typeT('a')], index: 0 },
            { id: 'y', history: [typeT('b')], index: 0, pinned: true },
          ],
          activeId: 'x',
        },
        version: 1,
      }),
    )
    void useTabs.persist.rehydrate()
    expect(s().tabs.map((t) => t.id)).toEqual(['y', 'x'])
    // Old tabs without trails get one empty trail per history entry.
    expect(s().tabs[1].crumbs).toEqual([[]])
  })
})

describe('crumbs', () => {
  test('test crumbs stay parallel to history through open, back, forward and trimming', () => {
    s().open(typeT('a'))
    s().open(objT('A.md'))
    s().open(objT('B.md'))
    let t = activeTab(s())!
    expect(t.crumbs).toHaveLength(t.history.length)
    s().back()
    s().back()
    expect(activeTab(s())!.crumbs).toHaveLength(3)
    s().forward()
    s().open(objT('C.md')) // drops the forward entry
    t = activeTab(s())!
    expect(t.history).toEqual([typeT('a'), objT('A.md'), objT('C.md')])
    expect(t.crumbs).toHaveLength(3)

    for (let i = 0; i < HISTORY_LIMIT + 5; i++) s().open(objT(`N${i}.md`))
    t = activeTab(s())!
    expect(t.history).toHaveLength(HISTORY_LIMIT)
    expect(t.crumbs).toHaveLength(HISTORY_LIMIT)
    expect(t.index).toBe(HISTORY_LIMIT - 1)
    expect(currentTarget(s())).toEqual(objT(`N${HISTORY_LIMIT + 4}.md`))

    // New tabs start with one trail per entry; an empty tab has none.
    s().open(typeT('b'), { newTab: true })
    expect(activeTab(s())!.crumbs).toEqual([[]])
    s().reset()
    s().newTab()
    expect(activeTab(s())!.crumbs).toEqual([])
  })

  test('retarget rewrites trails too', () => {
    s().open(objT('Old.md'))
    useTabs.setState({
      tabs: s().tabs.map((t) => ({ ...t, history: [...t.history, typeT('x')], index: 1, crumbs: [[], [objT('Old.md')]] })),
    })
    s().retarget('Old.md', 'New.md')
    expect(activeTab(s())!.crumbs).toEqual([[], [objT('New.md')]])
  })
})

describe('per-space storage', () => {
  test('test tabs are stored per space root', async () => {
    await setTabsSpace('/spaces/a')
    await setRecentSpace('/spaces/a')
    s().open(objT('A.md'))
    expect(localStorage.getItem('object.tabs:/spaces/a')).toContain('A.md')

    await setTabsSpace('/spaces/b')
    await setRecentSpace('/spaces/b')
    expect(s().tabs).toEqual([])
    s().open(objT('B.md'))
    expect(localStorage.getItem('object.tabs:/spaces/b')).toContain('B.md')
    expect(localStorage.getItem('object.tabs:/spaces/a')).not.toContain('B.md')

    await setTabsSpace('/spaces/a')
    expect(currentTarget(s())).toEqual(objT('A.md'))
    expect(localStorage.getItem('object.tabs')).toBeNull()

    // Recent items are per space as well.
    expect(useRecent.getState().paths).toEqual(['B.md'])
    await setRecentSpace('/spaces/a')
    expect(useRecent.getState().paths).toEqual(['A.md'])
  })

  test('test old global tabs key migrates to the current space once', async () => {
    s().open(objT('Legacy.md')) // written under the old global key
    useRecent.getState().add('Legacy.md')
    expect(localStorage.getItem('object.tabs')).toContain('Legacy.md')

    await setTabsSpace('/spaces/a')
    await setRecentSpace('/spaces/a')
    expect(currentTarget(s())).toEqual(objT('Legacy.md'))
    expect(localStorage.getItem('object.tabs')).toBeNull()
    expect(localStorage.getItem('object.recent')).toBeNull()
    expect(localStorage.getItem('object.tabs:/spaces/a')).toContain('Legacy.md')
    expect(localStorage.getItem('object.recent:/spaces/a')).toContain('Legacy.md')

    // A second space does not get the legacy tabs.
    await setTabsSpace('/spaces/b')
    await setRecentSpace('/spaces/b')
    expect(s().tabs).toEqual([])
    expect(useRecent.getState().paths).toEqual([])
  })
})

describe('breadcrumb trails (Task 14)', () => {
  const trail = () => activeTab(s())!.crumbs[activeTab(s())!.index]

  test('test link navigation extends the trail and sidebar navigation resets it', () => {
    s().open(typeT('page'))
    s().open(objT('A.md'), { via: 'link' })
    expect(trail()).toEqual([typeT('page')])
    s().open(objT('B.md'), { via: 'link' })
    expect(trail()).toEqual([typeT('page'), objT('A.md')])
    // Back to a page already on the trail cuts it there.
    s().open(objT('A.md'), { via: 'link' })
    expect(trail()).toEqual([typeT('page')])
    // Sidebar, palette, tab menu: the default 'nav' starts an empty trail.
    s().open(objT('C.md'))
    expect(trail()).toEqual([])
    s().open(objT('D.md'), { via: 'nav' })
    expect(trail()).toEqual([])
    // A link opened in a new tab carries the trail into it.
    s().open(objT('E.md'), { via: 'link', newTab: true })
    expect(s().tabs).toHaveLength(2)
    expect(activeTab(s())!.crumbs).toEqual([[objT('D.md')]])
  })

  test('test a link from a persistent tab carries the trail into the new tab', () => {
    s().open(objT('A.md'))
    s().togglePersistent(s().activeId!)
    s().open(objT('B.md'), { via: 'link' })
    expect(s().tabs).toHaveLength(2)
    expect(activeTab(s())!.crumbs).toEqual([[objT('A.md')]])
  })

  test('test back and forward show each entry trail', () => {
    s().open(objT('A.md'))
    s().open(objT('B.md'), { via: 'link' })
    s().open(objT('C.md'), { via: 'link' })
    expect(trail()).toEqual([objT('A.md'), objT('B.md')])
    s().back()
    expect(trail()).toEqual([objT('A.md')])
    s().back()
    expect(trail()).toEqual([])
    s().forward()
    s().forward()
    expect(trail()).toEqual([objT('A.md'), objT('B.md')])
  })

  test('test clicking a crumb goes back to it', () => {
    s().open(objT('A.md'))
    s().open(objT('B.md'), { via: 'link' })
    s().open(objT('C.md'), { via: 'link' })
    expect(crumbIndex(activeTab(s()), 0)).toBe(0)
    expect(crumbIndex(activeTab(s()), 1)).toBe(1)
    s().goToCrumb(0)
    // The index moves; no new entry.
    expect(activeTab(s())!.history).toEqual([objT('A.md'), objT('B.md'), objT('C.md')])
    expect(activeTab(s())!.index).toBe(0)
    expect(currentTarget(s())).toEqual(objT('A.md'))
    // Forward still reaches C with its trail.
    s().forward()
    s().forward()
    expect(trail()).toEqual([objT('A.md'), objT('B.md')])
    // Out of range is a no-op.
    s().goToCrumb(5)
    expect(currentTarget(s())).toEqual(objT('C.md'))
  })

  test('test a crumb whose entry is gone opens in place with the trail before it', () => {
    s().open(objT('A.md'))
    s().open(objT('B.md'), { via: 'link' })
    s().open(objT('C.md'), { via: 'link', newTab: true })
    expect(trail()).toEqual([objT('A.md'), objT('B.md')])
    s().goToCrumb(1)
    const t = activeTab(s())!
    expect(t.history).toEqual([objT('C.md'), objT('B.md')])
    expect(t.crumbs).toEqual([[objT('A.md'), objT('B.md')], [objT('A.md')]])
    expect(t.index).toBe(1)
  })
})
