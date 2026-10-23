/**
 * Navigation state: tabs, each with its own back/forward history (persisted to
 * localStorage), and the peek modal with its pager list (not persisted).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type Target = { kind: 'type'; typeId: string } | { kind: 'object'; path: string }

export interface Tab {
  id: string
  /** Every target visited in this tab, oldest first. */
  history: Target[]
  /** Position of the current target in `history`. */
  index: number
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
}

let seq = 0
function newId(): string {
  seq += 1
  return `t${Date.now().toString(36)}${seq.toString(36)}`
}

export function sameTarget(a: Target | null | undefined, b: Target | null | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false
  return a.kind === 'type' ? a.typeId === (b as typeof a).typeId : a.path === (b as typeof a).path
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

const HISTORY_LIMIT = 100

function updateActive(s: TabsState, fn: (t: Tab) => Tab): Partial<TabsState> {
  return { tabs: s.tabs.map((t) => (t.id === s.activeId ? fn(t) : t)) }
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,

      open(target, opts) {
        const s = get()
        const tab = activeTab(s)
        if (opts?.newTab || !tab) {
          const t: Tab = { id: newId(), history: [target], index: 0 }
          set({ tabs: [...s.tabs, t], activeId: t.id })
          return
        }
        if (sameTarget(tabTarget(tab), target)) return
        set(
          updateActive(s, (t) => {
            const history = [...t.history.slice(0, t.index + 1), target].slice(-HISTORY_LIMIT)
            return { ...t, history, index: history.length - 1 }
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
        const t: Tab = { id: newId(), history: target ? [target] : [], index: target ? 0 : -1 }
        set({ tabs: [...s.tabs, t], activeId: t.id })
      },

      reset() {
        set({ tabs: [], activeId: null })
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
        const tabs = p.tabs.filter(
          (t): t is Tab => !!t && typeof t.id === 'string' && Array.isArray(t.history) && typeof t.index === 'number',
        )
        const activeId = tabs.some((t) => t.id === p.activeId) ? p.activeId! : (tabs[0]?.id ?? null)
        return { ...current, tabs, activeId }
      },
    },
  ),
)

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
}

export const usePeek = create<PeekState>()((set, get) => ({
  path: null,
  list: [],
  index: 0,

  peek(path, list) {
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
}))
