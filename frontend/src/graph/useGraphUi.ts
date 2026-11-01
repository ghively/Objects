// `ui.graph`: the saved `GraphViewCustomization`. Edits are optimistic and saved debounced 400 ms
// as the whole merged value (the server replaces top-level keys), through the one `ui.json` save
// queue (`enqueueUiSave`) so a pin or calendar save never lands between a graph edit and its
// save with a stale revision. On a 409 the fresh `ui.json` is fetched, the pending edits are
// re-applied to its `graph` once and saved again (M3's `useViewState` pattern; never a blind
// overwrite). A failed save says so and reloads.
import { useCallback, useEffect } from 'react'
import { api, ConflictError } from '@/api/client'
import type { GraphCustomization } from '@/api/types'
import { showToast } from '@/editor/media/upload'
import { enqueueUiSave, reloadUi, useUiStore } from '@/shell/usePinned'

export const SAVE_DELAY_MS = 400
/** The toast after a `ui.json` save of the graph settings failed (Object's "Could not save …" form). */
export const GRAPH_SAVE_FAILED = 'Could not save the graph settings'

const EMPTY: GraphCustomization = {}

let pending: Partial<GraphCustomization>[] = []
/** The merged value the pending edits produced (survives a `ui.json` reload in between). */
let latest: GraphCustomization | null = null
let timer: ReturnType<typeof setTimeout> | null = null

const graphOf = (ui: { graph?: unknown } | null | undefined): GraphCustomization =>
  ui?.graph && typeof ui.graph === 'object' && !Array.isArray(ui.graph) ? (ui.graph as GraphCustomization) : EMPTY

function setGraph(graph: GraphCustomization, revision?: string): void {
  const s = useUiStore.getState()
  useUiStore.setState({ ui: { ...s.ui, graph }, ...(revision !== undefined ? { revision } : {}) })
}

/** One save of `next`, after the `ui.json` saves queued before it. Returns false when it failed. */
async function saveGraph(next: GraphCustomization, patches: Partial<GraphCustomization>[]): Promise<boolean> {
  const { revision } = useUiStore.getState()
  try {
    const res = await api.patchUi({ graph: next }, { baseRevision: revision })
    useUiStore.setState({ revision: res?.revision ?? useUiStore.getState().revision })
    return true
  } catch (e) {
    if (!(e instanceof ConflictError)) {
      console.warn('Could not save the graph settings:', e)
      return false
    }
    try {
      const fresh = await api.ui()
      const again = patches.reduce<GraphCustomization>((g, p) => ({ ...g, ...p }), graphOf(fresh?.ui))
      const res = await api.patchUi({ graph: again }, { baseRevision: fresh?.revision ?? '' })
      // Only `graph` is ours to replace: the rest of the local ui may hold another writer's unsaved edit.
      useUiStore.setState({ ui: { ...useUiStore.getState().ui, graph: again }, revision: res?.revision ?? fresh?.revision ?? '' })
      return true
    } catch (e2) {
      console.warn('Could not save the graph settings:', e2)
      return false
    }
  }
}

async function flush(): Promise<void> {
  timer = null
  const patches = pending
  const next = latest ?? graphOf(useUiStore.getState().ui)
  pending = []
  latest = null
  if (patches.length === 0) return
  setGraph(next)
  const saved = await enqueueUiSave(() => saveGraph(next, patches))
  if (!saved) {
    showToast(GRAPH_SAVE_FAILED)
    await reloadUi()
  }
}

/** Save any pending edit now (tests, unload). */
export function flushGraphUi(): Promise<void> {
  if (timer) clearTimeout(timer)
  return flush()
}

/** Forget pending edits (tests). */
export function resetGraphUi(): void {
  if (timer) clearTimeout(timer)
  timer = null
  pending = []
  latest = null
}

/** Merge `partial` into `ui.graph` now and save it after a short pause. */
export function patchGraphUi(partial: Partial<GraphCustomization>): void {
  latest = { ...(latest ?? graphOf(useUiStore.getState().ui)), ...partial }
  setGraph(latest)
  pending.push(partial)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flush(), SAVE_DELAY_MS)
}

export function useGraphUi(): { custom: GraphCustomization; patch(partial: Partial<GraphCustomization>): void } {
  const custom = useUiStore((s) => graphOf(s.ui))
  const loaded = useUiStore((s) => s.loaded)
  useEffect(() => {
    if (!loaded) void reloadUi()
  }, [loaded])
  const patch = useCallback((partial: Partial<GraphCustomization>) => patchGraphUi(partial), [])
  return { custom, patch }
}
