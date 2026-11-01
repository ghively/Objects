/**
 * Navigation state: tabs, each with its own back/forward history (persisted to
 * localStorage), and the peek modal with its pager list (not persisted).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useRecent } from './recent'
import {
  activateEntry,
  addEmptyEntry,
  cleanEntries,
  cleanLayout,
  closeEntry,
  entriesOf,
  isSidepanelShown,
  moveEntry,
  navigateEntry,
  openInArea,
  retargetEntries,
  stepEntry,
  togglePersistentEntry,
  visibleAreas,
  type PanelArea,
} from './sidepanel'
import { followStorage, switchStoreSpace } from './spaceStorage'

export type Target =
  | { kind: 'type'; typeId: string }
  | { kind: 'object'; path: string }
  /** Object Type Settings for one type. */
  | { kind: 'typeSettings'; typeId: string }
  /** The app's own Trash (not the Windows Recycle Bin). */
  | { kind: 'trash' }
  /** A collection's page. */
  | { kind: 'collection'; id: string }
  /** A query's page. */
  | { kind: 'query'; id: string }
  /** The page listing every query. */
  | { kind: 'queries' }
  /** The All notes view. */
  | { kind: 'allNotes' }
  /** The Calendar page (M4). */
  | { kind: 'calendar' }
  /** The Tasks page (M4). */
  | { kind: 'tasks' }
  /** The global graph (M5). */
  | { kind: 'graph' }
  /** M8: the extended search page ("Search", `LocalSpaceQuery.heading`), with what was typed. */
  | { kind: 'search'; q?: string; textOnly?: boolean }

/**
 * What a side-panel entry shows (Task 15): a page target, M5's local graph of the tab's object, or
 * (M8) the tab's object's backlinks.
 */
export type SidepanelTarget = Target | { kind: 'localGraph' } | { kind: 'backlinks' }

/** One side-panel entry (Object's `SidepanelEntry`). `target: null` is the empty "Explore" entry. */
export interface SidepanelEntry {
  id: string
  target: SidepanelTarget | null
  isOpen: boolean
  panelArea: 'area1' | 'area2' | 'area3'
  /** A persistent entry keeps its page: content opened into its area gets a new entry. */
  isPersistent?: boolean
  /** The entry's own back/forward history (links followed inside it); `target` is `history[index]`. */
  history?: SidepanelTarget[]
  index?: number
}

/**
 * The side panel's sizes (Object's `sidepanelLayout`): area 2 and 3 heights in px, and the width
 * as a share (0.1 to 0.9) of the main column plus the panel (Object's `sidepanelWidth`).
 */
export interface SidepanelLayout {
  width?: number
  area2Size?: number
  area3Size?: number
}

/** One tab (Object's `TabEntry`). */
export interface Tab {
  id: string
  /** Every target visited in this tab, oldest first. */
  history: Target[]
  /** Position of the current target in `history`. */
  index: number
  /**
   * A persistent tab (shown upright) keeps its page: any new page opens in a new tab. A
   * non-persistent tab (the default, shown in italic) navigates in place.
   */
  persistent?: boolean
  /** Pinned tabs sort before the others and can never be closed (Object refuses on every path). */
  pinned?: boolean
  /** When the tab was last made active (Object's `lastOpened`): closing the active tab activates the latest. */
  lastOpened?: number
  /** The breadcrumb trail of each history entry, parallel to `history` (Object's `breadcrumbs`). */
  crumbs: Target[][]
  /** Side-panel entries of this tab (Task 15). */
  sidepanel?: SidepanelEntry[]
  sidepanelLayout?: SidepanelLayout
  hideSidepanel?: boolean
}

export interface OpenOptions {
  newTab?: boolean
  /**
   * How the open was asked for. `'link'` (a wikilink, an embedded object, the peek's "Open as
   * page") extends the breadcrumb trail with the current page; `'nav'` (the default: sidebar, tab
   * menu, palette, start-up, calendar) starts an empty trail.
   */
  via?: 'link' | 'nav'
  /** Navigate the active tab even when it is persistent (start-up's "When this space opens"). */
  inPlace?: boolean
}

export interface TabsState {
  tabs: Tab[]
  activeId: string | null
  open(target: Target, opts?: OpenOptions): void
  back(): void
  forward(): void
  close(id: string): void
  /** Make `id` the active tab. */
  activate(id: string): void
  /** Open a new tab showing the active tab's current target (or nothing). */
  newTab(): void
  /** Drop every tab (tests, and recovery from bad persisted state). */
  reset(): void
  /** An object moved (renamed or retyped): point every tab's history and the peek at its new path. */
  retarget(oldPath: string, newPath: string): void
  /** Double click on a tab: persistent ⇄ not persistent. */
  togglePersistent(id: string): void
  pin(id: string): void
  unpin(id: string): void
  /**
   * Click on crumb `k` of the active entry's trail: go back to the history entry it stands for (the
   * tab's index moves, no new entry). When that entry is gone (trimmed, or the trail came from
   * another tab), the crumb opens in place with the trail before it.
   */
  goToCrumb(k: number): void

  // ---- the side panel (Task 15); every action works on the active tab ----
  /**
   * Show `target` in the side panel, area 1 unless `area` says otherwise: the area's open
   * non-persistent entry shows it, else a new open entry is added. A hidden panel is shown.
   */
  openInSidepanel(target: SidepanelTarget, opts?: { area?: PanelArea }): void
  /** "New Sidepanel Tab": an empty "Explore" entry in `area`. */
  newSidepanelEntry(area: PanelArea): void
  closeSidepanelEntry(id: string): void
  activateSidepanelEntry(id: string): void
  moveSidepanelEntry(id: string, area: PanelArea): void
  /** The entry's target and the tab's current target exchange places (the main side gets a new history entry). */
  swapWithMain(id: string): void
  setSidepanelLayout(patch: SidepanelLayout): void
  /** Hide the panel, or show it (with an empty entry when no area has one). */
  toggleSidepanel(): void
  /** A link followed inside entry `id` (the entry keeps its own history). */
  navigateSidepanelEntry(id: string, target: SidepanelTarget | null): void
  sidepanelBack(id: string): void
  sidepanelForward(id: string): void
  toggleSidepanelEntryPersistent(id: string): void
}

let seq = 0
function newId(): string {
  seq += 1
  return `t${Date.now().toString(36)}${seq.toString(36)}`
}

export function sameTarget(a: SidepanelTarget | null | undefined, b: SidepanelTarget | null | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false
  switch (a.kind) {
    case 'search': {
      // Our choice: another query (or toggle) is another page, so opening it from the palette applies it.
      const o = b as typeof a
      return (a.q ?? '') === (o.q ?? '') && !!a.textOnly === !!o.textOnly
    }
    case 'localGraph':
    case 'backlinks':
      return true
    case 'type':
    case 'typeSettings':
      return a.typeId === (b as typeof a).typeId
    case 'object':
      return a.path === (b as typeof a).path
    case 'collection':
    case 'query':
      return a.id === (b as typeof a).id
    case 'trash':
    case 'queries':
    case 'allNotes':
    case 'calendar':
    case 'tasks':
    case 'graph':
      return true
  }
}

export function activeTab(s: Pick<TabsState, 'tabs' | 'activeId'>): Tab | null {
  return s.tabs.find((t) => t.id === s.activeId) ?? null
}

export function tabTarget(tab: Tab | null | undefined): Target | null {
  return tab && tab.index >= 0 ? (tab.history[tab.index] ?? null) : null
}

export function currentTarget(s: Pick<TabsState, 'tabs' | 'activeId'>): Target | null {
  return tabTarget(activeTab(s))
}

export function canGoBack(s: Pick<TabsState, 'tabs' | 'activeId'>): boolean {
  return (activeTab(s)?.index ?? 0) > 0
}

export function canGoForward(s: Pick<TabsState, 'tabs' | 'activeId'>): boolean {
  const t = activeTab(s)
  return !!t && t.index < t.history.length - 1
}

export const HISTORY_LIMIT = 100

function updateActive(s: TabsState, fn: (t: Tab) => Tab): Partial<TabsState> {
  return { tabs: s.tabs.map((t) => (t.id === s.activeId ? fn(t) : t)) }
}

function updateTab(s: TabsState, id: string, fn: (t: Tab) => Tab): Partial<TabsState> {
  return { tabs: s.tabs.map((t) => (t.id === id ? fn(t) : t)) }
}

/**
 * Apply `fn` to the active tab. With `create`, a space with no tab gets an empty one first (the
 * side panel can open before any page does).
 */
function withPanel(
  set: (p: Partial<TabsState>) => void,
  get: () => TabsState,
  create: boolean,
  fn: (t: Tab) => Tab,
): void {
  const s = get()
  if (activeTab(s)) {
    set(updateActive(s, fn))
    return
  }
  if (!create) return
  const t = fn(freshTab(null))
  set({ tabs: sortPinned([...s.tabs, t]), activeId: t.id })
}

/** Pinned tabs first, each group keeping its order. */
export function sortPinned(tabs: Tab[]): Tab[] {
  if (!tabs.some((t) => t.pinned)) return tabs
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)]
}

let lastStamp = 0
/** A `lastOpened` stamp, strictly increasing within the session. */
function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1)
  return lastStamp
}

function freshTab(target: Target | null, trail: Target[] = []): Tab {
  return target
    ? { id: newId(), history: [target], index: 0, crumbs: [trail], lastOpened: stamp() }
    : { id: newId(), history: [], index: -1, crumbs: [], lastOpened: stamp() }
}

/** The tab to activate once `tabs` lost the active one: the most recently opened (Object's `Jk(tabs)[0]`). */
export function mostRecentTab(tabs: Tab[]): Tab | null {
  let best: Tab | null = null
  for (const t of tabs) if (!best || (t.lastOpened ?? 0) > (best.lastOpened ?? 0)) best = t
  return best
}

/** The active entry's breadcrumb trail (empty when it has none). */
export function tabCrumbs(tab: Tab | null | undefined): Target[] {
  if (!tab || tab.index < 0) return []
  return tab.crumbs?.[tab.index] ?? []
}

/** The trail a new page gets when opened from `tab` by `via`. */
function trailFrom(tab: Tab | null | undefined, target: Target, via: OpenOptions['via']): Target[] {
  const from = tabTarget(tab)
  if (via !== 'link' || !from) return []
  const trail = [...tabCrumbs(tab), from]
  // Back to a page already on the trail: cut the trail there (A › B › A reads as just A).
  const j = trail.findIndex((t) => sameTarget(t, target))
  return j >= 0 ? trail.slice(0, j) : trail
}

function sameTrail(a: Target[] | undefined, b: Target[]): boolean {
  return !!a && a.length === b.length && a.every((t, i) => sameTarget(t, b[i]))
}

/**
 * The history index crumb `k` of the active entry stands for: the latest earlier entry showing that
 * target with the trail before it, or -1.
 */
export function crumbIndex(tab: Tab | null | undefined, k: number): number {
  const trail = tabCrumbs(tab)
  if (!tab || k < 0 || k >= trail.length) return -1
  const before = trail.slice(0, k)
  for (let i = tab.index - 1; i >= 0; i--) {
    if (sameTarget(tab.history[i], trail[k]) && sameTrail(tab.crumbs?.[i], before)) return i
  }
  return -1
}

/** A trail per history entry: pad or cut `crumbs` to the length of `history`. */
function alignCrumbs(crumbs: unknown, length: number): Target[][] {
  const list = Array.isArray(crumbs) ? crumbs : []
  return Array.from({ length }, (_, i) => (Array.isArray(list[i]) ? (list[i] as Target[]) : []))
}

/** `target` becomes the tab's new current entry (forward history dropped, oldest trimmed). */
function pushEntry(t: Tab, target: Target, trail: Target[]): Tab {
  const crumbs = alignCrumbs(t.crumbs, t.history.length)
  const history = [...t.history.slice(0, t.index + 1), target]
  const trails = [...crumbs.slice(0, t.index + 1), trail]
  const cut = Math.max(0, history.length - HISTORY_LIMIT)
  return { ...t, history: history.slice(cut), crumbs: trails.slice(cut), index: history.length - 1 - cut }
}

/** Clean one persisted tab, or null when it is unusable. */
function cleanTab(t: unknown): Tab | null {
  if (!t || typeof t !== 'object') return null
  const x = t as Partial<Tab>
  if (typeof x.id !== 'string' || !Array.isArray(x.history) || typeof x.index !== 'number') return null
  const tab: Tab = { ...(x as Tab), crumbs: alignCrumbs(x.crumbs, x.history.length) }
  if (typeof x.persistent !== 'boolean') delete tab.persistent
  if (typeof x.pinned !== 'boolean') delete tab.pinned
  if (typeof x.lastOpened !== 'number' || !Number.isFinite(x.lastOpened)) delete tab.lastOpened
  const sidepanel = cleanEntries(x.sidepanel)
  if (sidepanel) tab.sidepanel = sidepanel
  else delete tab.sidepanel
  const layout = cleanLayout(x.sidepanelLayout)
  if (layout) tab.sidepanelLayout = layout
  else delete tab.sidepanelLayout
  if (typeof x.hideSidepanel !== 'boolean') delete tab.hideSidepanel
  return tab
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,

      open(target, opts) {
        if (target.kind === 'object') useRecent.getState().add(target.path)
        const s = get()
        const tab = activeTab(s)
        const trail = trailFrom(tab, target, opts?.via)
        if (opts?.newTab || !tab) {
          const t = freshTab(target, trail)
          set({ tabs: sortPinned([...s.tabs, t]), activeId: t.id })
          return
        }
        if (sameTarget(tabTarget(tab), target)) return
        if (tab.persistent && tab.index >= 0 && !opts?.inPlace) {
          // A persistent tab keeps its page: the new page opens in a new tab right after it.
          const t = freshTab(target, trail)
          const i = s.tabs.findIndex((x) => x.id === tab.id)
          set({ tabs: sortPinned([...s.tabs.slice(0, i + 1), t, ...s.tabs.slice(i + 1)]), activeId: t.id })
          return
        }
        set(updateActive(s, (t) => pushEntry(t, target, trail)))
      },

      back() {
        const s = get()
        if (!canGoBack(s)) return
        set(updateActive(s, (t) => ({ ...t, index: t.index - 1 })))
      },

      forward() {
        const s = get()
        if (!canGoForward(s)) return
        set(updateActive(s, (t) => ({ ...t, index: t.index + 1 })))
      },

      close(id) {
        const s = get()
        const gone = s.tabs.find((t) => t.id === id)
        // A pinned tab is never closed (Object's close returns false for it).
        if (!gone || gone.pinned) return
        const tabs = s.tabs.filter((t) => t.id !== id)
        let activeId = s.activeId
        if (activeId === id) activeId = mostRecentTab(tabs)?.id ?? null
        set({ tabs, activeId })
      },

      activate(id) {
        const s = get()
        if (!s.tabs.some((t) => t.id === id)) return
        if (s.activeId === id) return
        set({ ...updateTab(s, id, (t) => ({ ...t, lastOpened: stamp() })), activeId: id })
      },

      newTab() {
        const s = get()
        const target = currentTarget(s)
        const t = freshTab(target)
        set({ tabs: sortPinned([...s.tabs, t]), activeId: t.id })
      },

      reset() {
        set({ tabs: [], activeId: null })
      },

      retarget(oldPath, newPath) {
        if (oldPath !== newPath) {
          const moved = (t: Target): Target => (t.kind === 'object' && t.path === oldPath ? { kind: 'object', path: newPath } : t)
          const s = get()
          const hit = (h: Target) => h.kind === 'object' && h.path === oldPath
          const panelHit = (t: Tab) => !!t.sidepanel && retargetEntries(t.sidepanel, oldPath, newPath) !== t.sidepanel
          if (s.tabs.some((t) => t.history.some(hit) || (t.crumbs ?? []).some((c) => c.some(hit)) || panelHit(t))) {
            set({
              tabs: s.tabs.map((t) => ({
                ...t,
                history: t.history.map(moved),
                crumbs: alignCrumbs(t.crumbs, t.history.length).map((c) => c.map(moved)),
                ...(t.sidepanel ? { sidepanel: retargetEntries(t.sidepanel, oldPath, newPath) } : {}),
              })),
            })
          }
        }
        useRecent.getState().retarget(oldPath, newPath)
        usePeek.getState().retarget(oldPath, newPath)
      },

      togglePersistent(id) {
        set(updateTab(get(), id, (t) => ({ ...t, persistent: !t.persistent })))
      },

      pin(id) {
        const s = get()
        if (!s.tabs.some((t) => t.id === id && !t.pinned)) return
        // Taken out and put at the end of the pinned group.
        const tab = { ...s.tabs.find((t) => t.id === id)!, pinned: true }
        const rest = s.tabs.filter((t) => t.id !== id)
        const n = rest.filter((t) => t.pinned).length
        set({ tabs: [...rest.slice(0, n), tab, ...rest.slice(n)] })
      },

      goToCrumb(k) {
        const s = get()
        const tab = activeTab(s)
        const trail = tabCrumbs(tab)
        if (!tab || k < 0 || k >= trail.length) return
        const i = crumbIndex(tab, k)
        if (i >= 0) {
          set(updateActive(s, (t) => ({ ...t, index: i })))
          return
        }
        const target = trail[k]
        if (target.kind === 'object') useRecent.getState().add(target.path)
        set(updateActive(s, (t) => pushEntry(t, target, trail.slice(0, k))))
      },

      unpin(id) {
        const s = get()
        if (!s.tabs.some((t) => t.id === id && t.pinned)) return
        set({ tabs: sortPinned(updateTab(s, id, (t) => ({ ...t, pinned: false })).tabs!) })
      },

      openInSidepanel(target, opts) {
        if (target.kind === 'object') useRecent.getState().add(target.path)
        withPanel(set, get, true, (t) => ({
          ...t,
          sidepanel: openInArea(entriesOf(t), target, opts?.area ?? 'area1', newId),
          hideSidepanel: false,
        }))
      },

      newSidepanelEntry(area) {
        withPanel(set, get, true, (t) => ({ ...t, sidepanel: addEmptyEntry(entriesOf(t), area, newId), hideSidepanel: false }))
      },

      closeSidepanelEntry(id) {
        withPanel(set, get, false, (t) => ({ ...t, sidepanel: closeEntry(entriesOf(t), id) }))
      },

      activateSidepanelEntry(id) {
        withPanel(set, get, false, (t) => ({ ...t, sidepanel: activateEntry(entriesOf(t), id) }))
      },

      moveSidepanelEntry(id, area) {
        withPanel(set, get, false, (t) => ({ ...t, sidepanel: moveEntry(entriesOf(t), id, area) }))
      },

      swapWithMain(id) {
        withPanel(set, get, false, (t) => {
          const entry = entriesOf(t).find((e) => e.id === id)
          const side = entry?.target
          if (!entry || !side || side.kind === 'localGraph' || side.kind === 'backlinks') return t
          const main = tabTarget(t)
          if (side.kind === 'object') useRecent.getState().add(side.path)
          const swapped = sameTarget(main, side) ? t : pushEntry(t, side, [])
          return { ...swapped, sidepanel: navigateEntry(entriesOf(t), id, main) }
        })
      },

      setSidepanelLayout(patch) {
        withPanel(set, get, false, (t) => ({ ...t, sidepanelLayout: { ...t.sidepanelLayout, ...patch } }))
      },

      toggleSidepanel() {
        withPanel(set, get, true, (t) => {
          if (isSidepanelShown(t)) return { ...t, hideSidepanel: true }
          const entries = entriesOf(t)
          return {
            ...t,
            hideSidepanel: false,
            sidepanel: visibleAreas(entries).length > 0 ? entries : addEmptyEntry(entries, 'area1', newId),
          }
        })
      },

      navigateSidepanelEntry(id, target) {
        if (target?.kind === 'object') useRecent.getState().add(target.path)
        withPanel(set, get, false, (t) => ({ ...t, sidepanel: navigateEntry(entriesOf(t), id, target) }))
      },

      sidepanelBack(id) {
        withPanel(set, get, false, (t) => ({ ...t, sidepanel: stepEntry(entriesOf(t), id, -1) }))
      },

      sidepanelForward(id) {
        withPanel(set, get, false, (t) => ({ ...t, sidepanel: stepEntry(entriesOf(t), id, 1) }))
      },

      toggleSidepanelEntryPersistent(id) {
        withPanel(set, get, false, (t) => ({ ...t, sidepanel: togglePersistentEntry(entriesOf(t), id) }))
      },
    }),
    {
      name: 'object.tabs',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ tabs: s.tabs, activeId: s.activeId }),
      merge: (persisted, current) => {
        const p = persisted as Partial<TabsState> | undefined
        if (!p || !Array.isArray(p.tabs)) return current
        const tabs = sortPinned(p.tabs.map(cleanTab).filter((t): t is Tab => t !== null))
        const activeId = tabs.some((t) => t.id === p.activeId) ? p.activeId! : (tabs[0]?.id ?? null)
        return { ...current, tabs, activeId }
      },
    },
  ),
)

/**
 * Store this space's tabs under `object.tabs:<root>` and load them (App calls it once the space is
 * known, before rendering content). The old global `object.tabs` is migrated into the first space
 * once and deleted. `null` goes back to the global key (tests).
 */
export function setTabsSpace(root: string | null): Promise<void> {
  return switchStoreSpace(useTabs, 'object.tabs', root, { tabs: [], activeId: null })
}

/**
 * Another window of this space wrote its tabs: merge them into ours instead of letting the next
 * navigation here overwrite them (each window writes the whole `{tabs, activeId}`). Tabs by id:
 * one it closed (in `previous`, gone from `incoming`) closes here too unless it is our active tab;
 * a shared tab takes its newer copy, again except our active tab; its new tabs are appended; our
 * `activeId` stays ours.
 */
export function mergeTabsFromStorage(incoming: unknown, previous: unknown, current: Pick<TabsState, 'tabs' | 'activeId'>): Pick<TabsState, 'tabs' | 'activeId'> | null {
  const inc = incoming as Partial<TabsState> | null
  if (!inc || !Array.isArray(inc.tabs)) return null
  const theirs = inc.tabs.map(cleanTab).filter((t): t is Tab => t !== null)
  const theirIds = new Set(theirs.map((t) => t.id))
  const prev = previous as Partial<TabsState> | null
  const closed = new Set<string>()
  if (prev && Array.isArray(prev.tabs)) {
    for (const t of prev.tabs as Partial<Tab>[]) if (typeof t?.id === 'string' && !theirIds.has(t.id)) closed.add(t.id)
  }
  const ours = new Set(current.tabs.map((t) => t.id))
  const merged: Tab[] = []
  for (const t of current.tabs) {
    if (t.id === current.activeId) merged.push(t)
    else if (closed.has(t.id)) continue
    else merged.push(theirs.find((x) => x.id === t.id) ?? t)
  }
  for (const t of theirs) if (!ours.has(t.id)) merged.push(t)
  const tabs = sortPinned(merged)
  const activeId = tabs.some((t) => t.id === current.activeId) ? current.activeId : (tabs[0]?.id ?? null)
  return { tabs, activeId }
}

followStorage(useTabs, mergeTabsFromStorage)

export interface PeekState {
  /** The object shown in the peek, or null when closed. */
  path: string | null
  /** The list the peek was opened from; the pager steps through it. */
  list: string[]
  index: number
  peek(path: string, list?: string[]): void
  close(): void
  next(): void
  prev(): void
  /** An object moved: replace `oldPath` in the peek and its pager list. */
  retarget(oldPath: string, newPath: string): void
}

export const usePeek = create<PeekState>()((set, get) => ({
  path: null,
  list: [],
  index: 0,

  peek(path, list) {
    useRecent.getState().add(path)
    const l = list && list.includes(path) ? [...list] : [path]
    set({ path, list: l, index: l.indexOf(path) })
  },

  close() {
    set({ path: null, list: [], index: 0 })
  },

  next() {
    const { list, index, path } = get()
    if (path === null || index >= list.length - 1) return
    set({ index: index + 1, path: list[index + 1] })
  },

  prev() {
    const { list, index, path } = get()
    if (path === null || index <= 0) return
    set({ index: index - 1, path: list[index - 1] })
  },

  retarget(oldPath, newPath) {
    const { list, path } = get()
    if (oldPath === newPath || (path !== oldPath && !list.includes(oldPath))) return
    set({ path: path === oldPath ? newPath : path, list: list.map((p) => (p === oldPath ? newPath : p)) })
  },
}))
