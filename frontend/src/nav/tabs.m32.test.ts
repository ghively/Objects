// M32, "click opens a full page": `usePeek().peek` is what a plain click on a note calls (list
// rows, links, chips, graph nodes). With "Open notes as a full page" on (the default) it opens the
// note in the current tab; explicit peeks (`show`, Alt+Shift on the click) still peek.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { useRecent } from './recent'
import { activeTab, currentTarget, opensAsFullPage, tabCrumbs, usePeek, useTabs, type Target } from './tabs'

const typeT = (typeId: string): Target => ({ kind: 'type', typeId })
const objT = (path: string): Target => ({ kind: 'object', path })
const LIST = ['Pages/A.md', 'Pages/B.md', 'Pages/C.md']

const setFullPage = (on: boolean) => useSettings.setState({ settings: { ...settingsDefaults, alwaysOpenAsFullPage: on } })
const tick = () => new Promise((r) => setTimeout(r, 5))

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useRecent.getState().clear()
  useSettings.setState({ settings: settingsDefaults })
})

afterEach(async () => {
  // Let a noted modifier be forgotten before the next test.
  await tick()
})

describe('a plain click opens a full page (M32)', () => {
  test('test the setting starts on', () => {
    expect(settingsDefaults.alwaysOpenAsFullPage).toBe(true)
    expect(opensAsFullPage()).toBe(true)
  })

  test('test peek opens the note in the current tab, with the page it came from on the trail', () => {
    useTabs.getState().open(typeT('page'))
    usePeek.getState().peek('Pages/B.md', LIST)
    expect(usePeek.getState().path).toBeNull()
    expect(currentTarget(useTabs.getState())).toEqual(objT('Pages/B.md'))
    expect(useTabs.getState().tabs).toHaveLength(1)
    expect(tabCrumbs(activeTab(useTabs.getState()))).toEqual([typeT('page')])
    expect(useRecent.getState().paths[0]).toBe('Pages/B.md')
    // Back returns to the list.
    useTabs.getState().back()
    expect(currentTarget(useTabs.getState())).toEqual(typeT('page'))
  })

  test('test with the setting off a plain click peeks, stepping through the list', () => {
    setFullPage(false)
    useTabs.getState().open(typeT('page'))
    usePeek.getState().peek('Pages/B.md', LIST)
    expect(usePeek.getState().path).toBe('Pages/B.md')
    expect(usePeek.getState().list).toEqual(LIST)
    expect(usePeek.getState().index).toBe(1)
    expect(currentTarget(useTabs.getState())).toEqual(typeT('page'))
  })

  test('test show peeks whatever the setting says', () => {
    useTabs.getState().open(typeT('page'))
    usePeek.getState().show('Pages/B.md', LIST)
    expect(usePeek.getState().path).toBe('Pages/B.md')
    expect(usePeek.getState().index).toBe(1)
    expect(currentTarget(useTabs.getState())).toEqual(typeT('page'))
    usePeek.getState().next()
    expect(usePeek.getState().path).toBe('Pages/C.md')
  })

  test('test Alt+Shift on the click asks for the peek; the next plain click opens a page again', async () => {
    useTabs.getState().open(typeT('page'))
    window.dispatchEvent(new MouseEvent('click', { altKey: true, shiftKey: true }))
    usePeek.getState().peek('Pages/A.md')
    expect(usePeek.getState().path).toBe('Pages/A.md')
    expect(currentTarget(useTabs.getState())).toEqual(typeT('page'))
    usePeek.getState().close()
    // The modifier belongs to that click only.
    await tick()
    usePeek.getState().peek('Pages/B.md')
    expect(usePeek.getState().path).toBeNull()
    expect(currentTarget(useTabs.getState())).toEqual(objT('Pages/B.md'))
  })

  test('test a plain click with Shift or Alt alone is not an ask for the peek', () => {
    useTabs.getState().open(typeT('page'))
    window.dispatchEvent(new MouseEvent('click', { shiftKey: true }))
    usePeek.getState().peek('Pages/A.md')
    expect(usePeek.getState().path).toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true }))
    usePeek.getState().peek('Pages/B.md')
    expect(usePeek.getState().path).toBeNull()
    expect(currentTarget(useTabs.getState())).toEqual(objT('Pages/B.md'))
  })

  test('test a link clicked inside a popped-out note opens the page and closes the peek', () => {
    useTabs.getState().open(typeT('page'))
    usePeek.getState().show('DailyNotes/2026-11-11.md')
    usePeek.getState().peek('Pages/A.md')
    expect(usePeek.getState().path).toBeNull()
    expect(currentTarget(useTabs.getState())).toEqual(objT('Pages/A.md'))
  })

  test('test a persistent tab keeps its page: the note opens in a new tab beside it', () => {
    useTabs.getState().open(typeT('page'))
    useTabs.getState().togglePersistent(useTabs.getState().activeId!)
    usePeek.getState().peek('Pages/A.md')
    expect(useTabs.getState().tabs).toHaveLength(2)
    expect(currentTarget(useTabs.getState())).toEqual(objT('Pages/A.md'))
  })
})

describe('a new tab is Home (M32)', () => {
  test('test newTab opens an empty tab beside the others, whatever page was in view', () => {
    useTabs.getState().open(objT('Pages/A.md'))
    const first = useTabs.getState().activeId
    useTabs.getState().newTab()
    expect(useTabs.getState().tabs).toHaveLength(2)
    expect(useTabs.getState().activeId).not.toBe(first)
    // No page: the shell shows Home there.
    expect(currentTarget(useTabs.getState())).toBeNull()
    expect(activeTab(useTabs.getState())?.history).toEqual([])
    // The first page is still in its own tab; opening something fills the new one.
    useTabs.getState().open(objT('Pages/B.md'))
    expect(useTabs.getState().tabs.map((t) => t.history.at(-1))).toEqual([objT('Pages/A.md'), objT('Pages/B.md')])
  })
})
