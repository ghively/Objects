import { beforeEach, describe, expect, test } from 'vitest'
import {
  addEmptyEntry,
  areaSizes,
  clampWidthFraction,
  cleanEntries,
  cleanLayout,
  closeEntry,
  isSidepanelShown,
  moveEntry,
  navigateEntry,
  openInArea,
  openEntryIn,
  stepEntry,
  visibleAreas,
  widthFraction,
} from './sidepanel'
import { activeTab, currentTarget, useTabs, type SidepanelEntry, type Target } from './tabs'

const obj = (path: string): Target => ({ kind: 'object', path })
let n = 0
const id = () => `e${++n}`
const s = useTabs.getState
const tab = () => activeTab(s())!
const open = (area: SidepanelEntry['panelArea']) => openEntryIn(tab().sidepanel ?? [], area)

beforeEach(() => {
  n = 0
  localStorage.clear()
  s().reset()
})

describe('side panel entries', () => {
  test('test open replaces a non-persistent entry and adds beside a persistent one', () => {
    let entries = openInArea([], obj('A.md'), 'area1', id)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ target: obj('A.md'), isOpen: true, panelArea: 'area1' })

    // Non-persistent: the open entry shows the new target (and remembers the old one).
    entries = openInArea(entries, obj('B.md'), 'area1', id)
    expect(entries).toHaveLength(1)
    expect(entries[0].target).toEqual(obj('B.md'))
    expect(entries[0].history).toEqual([obj('A.md'), obj('B.md')])

    // The same target again changes nothing.
    expect(openInArea(entries, obj('B.md'), 'area1', id)).toBe(entries)

    // Persistent: a new open entry beside it; the old one stays, closed.
    entries = entries.map((e) => ({ ...e, isPersistent: true }))
    entries = openInArea(entries, obj('C.md'), 'area1', id)
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => [e.target, e.isOpen])).toEqual([
      [obj('B.md'), false],
      [obj('C.md'), true],
    ])

    // Another area gets its own entry.
    entries = openInArea(entries, obj('D.md'), 'area2', id)
    expect(visibleAreas(entries)).toEqual(['area1', 'area2'])
  })

  test('test the local graph entry is revealed, not duplicated', () => {
    let entries = openInArea([], { kind: 'localGraph' }, 'area2', id)
    entries = addEmptyEntry(entries, 'area2', id)
    expect(openEntryIn(entries, 'area2')?.target).toBeNull()
    entries = openInArea(entries, { kind: 'localGraph' }, 'area1', id)
    expect(entries).toHaveLength(2)
    expect(openEntryIn(entries, 'area2')?.target).toEqual({ kind: 'localGraph' })
  })

  test('test close and move show a neighbour in the area left behind', () => {
    let entries = openInArea([], obj('A.md'), 'area1', id)
    entries = addEmptyEntry(entries, 'area1', id)
    const [a, b] = entries
    entries = closeEntry(entries, b.id)
    expect(openEntryIn(entries, 'area1')?.id).toBe(a.id)
    entries = addEmptyEntry(entries, 'area1', id)
    const c = entries[1]
    entries = moveEntry(entries, c.id, 'area3')
    expect(openEntryIn(entries, 'area1')?.id).toBe(a.id)
    expect(openEntryIn(entries, 'area3')?.id).toBe(c.id)
    expect(visibleAreas(entries)).toEqual(['area1', 'area3'])
  })

  test('test entry history steps back and forward', () => {
    let entries = openInArea([], obj('A.md'), 'area1', id)
    const e = entries[0].id
    entries = navigateEntry(entries, e, obj('B.md'))
    entries = navigateEntry(entries, e, obj('C.md'))
    entries = stepEntry(entries, e, -1)
    expect(entries[0].target).toEqual(obj('B.md'))
    entries = stepEntry(entries, e, -1)
    expect(entries[0].target).toEqual(obj('A.md'))
    expect(stepEntry(entries, e, -1)[0].target).toEqual(obj('A.md'))
    entries = stepEntry(entries, e, 1)
    expect(entries[0].target).toEqual(obj('B.md'))
    // A new link drops the forward history.
    entries = navigateEntry(entries, e, obj('D.md'))
    expect(entries[0].history).toEqual([obj('A.md'), obj('B.md'), obj('D.md')])
  })

  test('test layout helpers: width share 10 to 90 %, areas 220 px by default and 120 px at least', () => {
    expect(clampWidthFraction(0.05)).toBe(0.1)
    expect(clampWidthFraction(0.95)).toBe(0.9)
    expect(clampWidthFraction(0.3)).toBe(0.3)
    expect(widthFraction(undefined)).toBe(0.45)
    expect(widthFraction({ width: 2 })).toBe(0.9)
    expect(areaSizes(undefined, ['area1', 'area2', 'area3'])).toEqual({ area2: 220, area3: 220 })
    expect(areaSizes({ area2Size: 300 }, ['area1', 'area2'])).toEqual({ area2: 300 })
    expect(areaSizes({ area3Size: 50 }, ['area2', 'area3'])).toEqual({ area3: 120 })
    // Saved in the older shape (px width, fractional heights): dropped.
    expect(cleanLayout({ width: 500, area2Size: 0.4, area3Size: 260 })).toEqual({ area3Size: 260 })
    expect(cleanLayout({ width: 0.3 })).toEqual({ width: 0.3 })
  })

  test('test persisted entries are cleaned', () => {
    const out = cleanEntries([
      { id: 'a', target: obj('A.md'), isOpen: true, panelArea: 'area1' },
      { id: 'b', target: obj('B.md'), isOpen: true, panelArea: 'area1' },
      { id: 'c', target: null, isOpen: true, panelArea: 'area9' },
      'junk',
    ])
    expect(out!.map((e) => [e.id, e.isOpen])).toEqual([
      ['a', true],
      ['b', false],
    ])
    expect(cleanEntries('nope')).toBeUndefined()
  })
})

describe('side panel actions on the tabs store', () => {
  test('test swap exchanges side panel entry and main target', () => {
    s().open(obj('Main.md'))
    s().openInSidepanel(obj('Side.md'))
    const entry = open('area1')!
    s().swapWithMain(entry.id)
    expect(currentTarget(s())).toEqual(obj('Side.md'))
    expect(open('area1')!.target).toEqual(obj('Main.md'))
    // The main side got a new history entry: back returns to Main.md.
    expect(tab().history).toEqual([obj('Main.md'), obj('Side.md')])
    // The local graph cannot be swapped.
    s().openInSidepanel({ kind: 'localGraph' }, { area: 'area2' })
    const graph = open('area2')!
    s().swapWithMain(graph.id)
    expect(currentTarget(s())).toEqual(obj('Side.md'))
  })

  test('test toggle hides and shows the panel, adding an empty entry when there is none', () => {
    s().open(obj('A.md'))
    expect(isSidepanelShown(tab())).toBe(false)
    s().toggleSidepanel()
    expect(isSidepanelShown(tab())).toBe(true)
    expect(open('area1')!.target).toBeNull()
    s().toggleSidepanel()
    expect(isSidepanelShown(tab())).toBe(false)
    expect(tab().sidepanel).toHaveLength(1)
    // Opening content while hidden shows the panel again.
    s().openInSidepanel(obj('B.md'))
    expect(isSidepanelShown(tab())).toBe(true)
    expect(tab().sidepanel).toHaveLength(1)
  })

  test('test open in side panel without a tab makes one', () => {
    s().openInSidepanel(obj('A.md'))
    expect(s().tabs).toHaveLength(1)
    expect(currentTarget(s())).toBeNull()
    expect(open('area1')!.target).toEqual(obj('A.md'))
  })

  test('test retarget follows a moved object into side panel entries', () => {
    s().open(obj('Main.md'))
    s().openInSidepanel(obj('Old.md'))
    s().retarget('Old.md', 'New.md')
    expect(open('area1')!.target).toEqual(obj('New.md'))
    expect(open('area1')!.history).toEqual([obj('New.md')])
  })

  test('test side panel state persists with the tab', async () => {
    s().open(obj('A.md'))
    s().openInSidepanel(obj('B.md'))
    s().setSidepanelLayout({ width: 0.4, area2Size: 300 })
    const saved = JSON.parse(localStorage.getItem('object.tabs')!)
    s().reset()
    localStorage.setItem('object.tabs', JSON.stringify(saved))
    await useTabs.persist.rehydrate()
    expect(tab().sidepanelLayout).toEqual({ width: 0.4, area2Size: 300 })
    expect(open('area1')!.target).toEqual(obj('B.md'))
  })
})
