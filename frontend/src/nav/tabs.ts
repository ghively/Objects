/**
 * Navigation state: tabs, each with its own back/forward history (persisted to
 * localStorage), and the peek modal with its pager list (not persisted).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useRecent } from './recent'
import { switchStoreSpace } from './spaceStorage'

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

/** What a side-panel entry shows (Task 15): a page target, or M5's local graph of the tab's object. */
export type SidepanelTarget = Target | { kind: 'localGraph' }

/** One side-panel entry (Object's `SidepanelEntry`). `target: null` is the empty "Explore" entry. */
export interface SidepanelEntry {
  id: string
  target: SidepanelTarget | null
  isOpen: boolean
  panelArea: 'area1' | 'area2' | 'area3'
  isPersistent?: boolean
}

/** The side panel's sizes (Object's `sidepanelLayout`): width in px, area sizes as fractions. */
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
  /** Pinned tabs sort before the others and have no close button. */
  pinned?: boolean
  /** The breadcrumb trail of each history entry, parallel to `history` (Object's `breadcrumbs`). */
  crumbs: Target[][]
  /** Side-panel entries of this tab (Task 15). */
  sidepanel?: SidepanelEntry[]
  sidepanelLayout?: SidepanelLayout
  hideSidepanel?: boolean
}

export interface OpenOptions {
  newTab?: boolean
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
}

let seq = 0
function newId(): string {
  seq += 1
  return `t${Date.now().toString(36)}${seq.toString(36)}`
}

export function sameTarget(a: Target | null | undefined, b: Target | null | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false
  switch (a.kind) {
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

/** Pinned tabs first, each group keeping its order. */
export function sortPinned(tabs: Tab[]): Tab[] {
  if (!tabs.some((t) => t.pinned)) return tabs
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)]
}

function freshTab(target: Target | null): Tab {
  return target
    ? { id: newId(), history: [target], index: 0, crumbs: [[]] }
    : { id: newId(), history: [], index: -1, crumbs: [] }
}

/** A trail per history entry: pad or cut `crumbs` to the length of `history`. */
function alignCrumbs(crumbs: unknown, length: number): Target[][] {
  const list = Array.isArray(crumbs) ? crumbs : []
  return Array.from({ length }, (_, i) => (Array.isArray(list[i]) ? (list[i] as Target[]) : []))
}

/** Clean one persisted tab, or null when it is unusable. */
function cleanTab(t: unknown): Tab | null {
  if (!t || typeof t !== 'object') return null
  const x = t as Partial<Tab>
  if (typeof x.id !== 'string' || !Array.isArray(x.history) || typeof x.index !== 'number') return null
  const tab: Tab = { ...(x as Tab), crumbs: alignCrumbs(x.crumbs, x.history.length) }
  if (typeof x.persistent !== 'boolean') delete tab.persistent
  if (typeof x.pinned !== 'boolean') delete tab.pinned
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
        if (opts?.newTab || !tab) {
          const t = freshTab(target)
          set({ tabs: sortPinned([...s.tabs, t]), activeId: t.id })
          return
        }
        if (sameTarget(tabTarget(tab), target)) return
        if (tab.persistent && tab.index >= 0) {
          // A persistent tab keeps its page: the new page opens in a new tab right after it.
          const t = freshTab(target)
          const i = s.tabs.findIndex((x) => x.id === tab.id)
          set({ tabs: sortPinned([...s.tabs.slice(0, i + 1), t, ...s.tabs.slice(i + 1)]), activeId: t.id })
          return
        }
        set(
          updateActive(s, (t) => {
            const crumbs = alignCrumbs(t.crumbs, t.history.length)
            const history = [...t.history.slice(0, t.index + 1), target]
            const trails = [...crumbs.slice(0, t.index + 1), []]
            const cut = Math.max(0, history.length - HISTORY_LIMIT)
            return { ...t, history: history.slice(cut), crumbs: trails.slice(cut), index: history.length - 1 - cut }
          }),
        )
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
        const i = s.tabs.findIndex((t) => t.id === id)
        if (i < 0) return
        const tabs = s.tabs.filter((t) => t.id !== id)
        let activeId = s.activeId
        if (activeId === id) activeId = (tabs[i] ?? tabs[i - 1])?.id ?? null
        set({ tabs, activeId })
      },

      activate(id) {
        if (get().tabs.some((t) => t.id === id)) set({ activeId: id })
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
          if (s.tabs.some((t) => t.history.some(hit) || (t.crumbs ?? []).some((c) => c.some(hit)))) {
            set({
              tabs: s.tabs.map((t) => ({
                ...t,
                history: t.history.map(moved),
                crumbs: alignCrumbs(t.crumbs, t.history.length).map((c) => c.map(moved)),
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

      unpin(id) {
        const s = get()
        if (!s.tabs.some((t) => t.id === id && t.pinned)) return
        set({ tabs: sortPinned(updateTab(s, id, (t) => ({ ...t, pinned: false })).tabs!) })
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
