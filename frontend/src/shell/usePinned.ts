// Pinned items and custom sidebar sections, kept in `ui.json`. One shared store so the sidebar,
// the `…` menus and the pin dialogs agree. Edits are optimistic and saved in order with the
// latest `baseRevision`; on a 409 the fresh state is fetched, the same edit is re-applied to it
// once and saved again (never a blind overwrite).
import { useEffect } from 'react'
import { create } from 'zustand'
import { api, CLIENT_ID, ConflictError } from '@/api/client'
import type { Icon, PinRef, SidebarSection, UiState } from '@/api/types'
import { showToast } from '@/editor/media/upload'

/** The toast after a `ui.json` save of the sidebar failed (Object's "Could not save …" form). */
export const SIDEBAR_SAVE_FAILED = 'Could not save the sidebar'

interface UiStore {
  ui: UiState
  revision: string
  loaded: boolean
}

const EMPTY: UiState = { pinned: [], sections: [], allNotesLayout: 'list' }

export const useUiStore = create<UiStore>()(() => ({ ui: EMPTY, revision: '', loaded: false }))

type UiPatch = Partial<Pick<UiState, 'pinned' | 'sections' | 'allNotesLayout'>>
type Op = (ui: UiState) => UiPatch | null

/** Only well-formed `{kind, id}` refs: a hand-edited ui.json must not break the sidebar. */
const pinRefs = (v: unknown): PinRef[] =>
  Array.isArray(v)
    ? v.filter((r): r is PinRef => !!r && typeof r === 'object' && typeof (r as PinRef).kind === 'string' && typeof (r as PinRef).id === 'string')
    : []

const norm = (ui: Partial<UiState> | undefined | null): UiState => ({
  ...EMPTY,
  ...(ui ?? {}),
  pinned: pinRefs(ui?.pinned),
  sections: Array.isArray(ui?.sections)
    ? ui.sections
        .filter((s) => !!s && typeof s === 'object')
        .map((s) => ({ ...s, name: typeof s.name === 'string' ? s.name : '', icon: s.icon ?? null, items: pinRefs(s.items) }))
    : [],
})

const same = (a: PinRef, b: PinRef) => a.kind === b.kind && a.id === b.id

let pending = 0
let queue: Promise<void> = Promise.resolve()
let loading: Promise<void> | null = null

export function resetPinned(): void {
  pending = 0
  queue = Promise.resolve()
  loading = null
  useUiStore.setState({ ui: EMPTY, revision: '', loaded: false })
}

/** Fetch `ui.json` (the first mount, and `ui` events from elsewhere). */
export async function reloadUi(): Promise<void> {
  try {
    const res = await api.ui()
    if (pending === 0) useUiStore.setState({ ui: norm(res?.ui), revision: res?.revision ?? '', loaded: true })
    else useUiStore.setState({ loaded: true })
  } catch (e) {
    console.warn('Could not load the sidebar state:', e)
    useUiStore.setState({ loaded: true })
  }
}

/**
 * The first load of `ui.json`, shared by everyone asking while one is in flight (the sidebar, the
 * calendar's week start, the graph settings, the Notifications section), so mounting them before
 * the first answer makes one request. A `ui` event from elsewhere still reloads with `reloadUi`.
 */
export function loadUi(): Promise<void> {
  if (loading) return loading
  const p = reloadUi().finally(() => {
    if (loading === p) loading = null
  })
  loading = p
  return p
}

/**
 * Take from `from` (the server's whole `ui.json` after a save, or the fresh copy after a 409) only
 * the keys `patch` sent. The rest of the local `ui` may hold another writer's unsaved edit (the
 * graph's, the calendar's, the Reminders switch's), which a whole-file replace would revert on screen.
 */
function adopt(ui: UiState, from: Partial<UiState> | undefined | null, patch: Partial<UiState>): UiState {
  if (!from) return ui
  const fresh = norm(from)
  const next: UiState = { ...ui }
  for (const k of Object.keys(patch)) next[k] = fresh[k]
  return next
}

async function save(patch: UiPatch, op: Op): Promise<void> {
  try {
    const res = await api.patchUi(patch, { baseRevision: useUiStore.getState().revision })
    const s = useUiStore.getState()
    useUiStore.setState({ revision: res?.revision ?? s.revision, ...(pending === 1 ? { ui: adopt(s.ui, res?.ui, patch) } : {}) })
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e
    const fresh = await api.ui()
    const base = norm(fresh?.ui)
    const again = op(base)
    if (!again) {
      // Already so on the server: show its copy of what this edit touched.
      const s = useUiStore.getState()
      useUiStore.setState({ revision: fresh?.revision ?? '', ...(pending === 1 ? { ui: adopt(s.ui, base, patch) } : {}) })
      return
    }
    const res = await api.patchUi(again, { baseRevision: fresh?.revision ?? '' })
    const s = useUiStore.getState()
    useUiStore.setState({
      revision: res?.revision ?? fresh?.revision ?? '',
      ...(pending === 1 ? { ui: res?.ui ? adopt(s.ui, res.ui, again) : { ...s.ui, ...again } } : {}),
    })
  }
}

/**
 * Run `save` after every `ui.json` save queued before it (the sidebar's, the calendar's, the Tasks
 * page's), so each sends the revision the one before it returned. While more than one edit is
 * unsaved (`pendingUiSaves`), no answer may replace the whole local `ui`.
 */
export function enqueueUiSave<T>(save: () => Promise<T>): Promise<T> {
  pending += 1
  const done = queue.then(save).finally(() => {
    pending -= 1
  })
  queue = done.then(
    () => undefined,
    () => undefined,
  )
  return done
}

/** Unsaved `ui.json` edits, the one being saved included. */
export const pendingUiSaves = (): number => pending

/** Apply `op` now and save it after the edits before it. */
function run(op: Op): Promise<void> {
  const cur = useUiStore.getState().ui
  const patch = op(cur)
  if (!patch) return Promise.resolve()
  useUiStore.setState({ ui: { ...cur, ...patch } })
  pending += 1
  const done = queue.then(async () => {
    let failed = false
    try {
      await save(patch, op)
    } catch (e) {
      failed = true
      console.warn('Could not save the sidebar state:', e)
    } finally {
      pending -= 1
    }
    // The edit is rolled back by the reload: say so, or the pin just vanishes.
    if (failed) {
      showToast(SIDEBAR_SAVE_FAILED)
      await reloadUi()
    }
  })
  queue = done
  return done
}

function newSectionId(): string {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let t = Date.now()
  let time = ''
  for (let i = 0; i < 10; i++) {
    time = A[t % 32] + time
    t = Math.floor(t / 32)
  }
  let rand = ''
  for (let i = 0; i < 16; i++) rand += A[Math.floor(Math.random() * 32)]
  return time + rand
}

const withItems = (ui: UiState, sectionId: string, fn: (items: PinRef[]) => PinRef[]): SidebarSection[] =>
  ui.sections.map((s) => (s.id === sectionId ? { ...s, items: fn(s.items) } : s))

export type PinTarget = PinRef | { kind: 'object'; path: string; id?: string | null }

export interface UsePinned {
  pinned: PinRef[]
  sections: SidebarSection[]
  loaded: boolean
  /** In the Pinned section (`sectionId` null/omitted) or in a custom section. */
  isPinned(ref: PinRef, sectionId?: string | null): boolean
  /** An object without an `id` gets one first (`ensureId`), and is pinned by it. */
  pin(ref: PinTarget, sectionId?: string | null): Promise<void>
  unpin(ref: PinRef, sectionId?: string | null): Promise<void>
  /** Reorder within a section (`null` = Pinned). */
  move(sectionId: string | null, from: number, to: number): Promise<void>
  addSection(name: string): Promise<string>
  renameSection(id: string, name: string): Promise<void>
  updateSection(id: string, patch: { name?: string; icon?: Icon | null }): Promise<void>
  deleteSection(id: string): Promise<void>
}

const moveItem = <T,>(list: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

export const pinnedActions: Omit<UsePinned, 'pinned' | 'sections' | 'loaded' | 'isPinned'> = {
  async pin(target, sectionId = null) {
    let ref: PinRef
    if ('path' in target) {
      let id = target.id ?? ''
      if (!id) id = (await api.ensureId(target.path)).id
      ref = { kind: 'object', id }
    } else ref = target
    await run((ui) => {
      if (sectionId === null) return ui.pinned.some((p) => same(p, ref)) ? null : { pinned: [...ui.pinned, ref] }
      const s = ui.sections.find((x) => x.id === sectionId)
      if (!s || s.items.some((p) => same(p, ref))) return null
      return { sections: withItems(ui, sectionId, (items) => [...items, ref]) }
    })
  },
  unpin(ref, sectionId = null) {
    return run((ui) => {
      if (sectionId === null) return ui.pinned.some((p) => same(p, ref)) ? { pinned: ui.pinned.filter((p) => !same(p, ref)) } : null
      const s = ui.sections.find((x) => x.id === sectionId)
      if (!s || !s.items.some((p) => same(p, ref))) return null
      return { sections: withItems(ui, sectionId, (items) => items.filter((p) => !same(p, ref))) }
    })
  },
  move(sectionId, from, to) {
    return run((ui) => {
      if (sectionId === null) {
        const next = moveItem(ui.pinned, from, to)
        return next === ui.pinned ? null : { pinned: next }
      }
      const s = ui.sections.find((x) => x.id === sectionId)
      if (!s) return null
      const next = moveItem(s.items, from, to)
      return next === s.items ? null : { sections: withItems(ui, sectionId, () => next) }
    })
  },
  async addSection(name) {
    const id = newSectionId()
    await run((ui) => ({ sections: [...ui.sections, { id, name: name.trim() || 'Section', icon: null, items: [] }] }))
    return id
  },
  renameSection(id, name) {
    return pinnedActions.updateSection(id, { name })
  },
  updateSection(id, patch) {
    return run((ui) =>
      ui.sections.some((s) => s.id === id)
        ? { sections: ui.sections.map((s) => (s.id === id ? { ...s, ...patch, name: patch.name?.trim() || s.name } : s)) }
        : null,
    )
  },
  deleteSection(id) {
    return run((ui) => (ui.sections.some((s) => s.id === id) ? { sections: ui.sections.filter((s) => s.id !== id) } : null))
  },
}

/** All notes' layout, saved to `ui.allNotesLayout`. */
export function saveAllNotesLayout(layout: UiState['allNotesLayout']): Promise<void> {
  return run((ui) => (ui.allNotesLayout === layout ? null : { allNotesLayout: layout }))
}

let refs = 0
let off: (() => void) | null = null

/** Pinned items and custom sections; loads `ui.json` and follows `ui` events from other windows. */
export function usePinned(): UsePinned {
  const ui = useUiStore((s) => s.ui)
  const loaded = useUiStore((s) => s.loaded)
  useEffect(() => {
    refs += 1
    if (refs === 1) {
      void loadUi()
      off = api.onChange((e) => {
        if (e.kind === 'ui' && e.origin !== CLIENT_ID) void reloadUi()
      })
    }
    return () => {
      refs -= 1
      if (refs === 0) {
        off?.()
        off = null
      }
    }
  }, [])
  return {
    pinned: ui.pinned,
    sections: ui.sections,
    loaded,
    isPinned: (ref, sectionId = null) =>
      sectionId === null ? ui.pinned.some((p) => same(p, ref)) : !!ui.sections.find((s) => s.id === sectionId)?.items.some((p) => same(p, ref)),
    ...pinnedActions,
  }
}
