// The graph payload, shared by the global graph and the local graph panel: one `api.graph()`,
// reloaded (debounced 500 ms) when objects or types change.
import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '@/api/client'
import type { ChangeKind, GraphData } from '@/api/types'

export interface GraphDataState {
  data: GraphData | null
  loading: boolean
  reload(): Promise<void>
}

export const RELOAD_DELAY_MS = 500
const RELOAD_ON = new Set<ChangeKind>(['created', 'deleted', 'renamed', 'changed', 'types'])

let seq = 0

export const useGraphDataStore = create<GraphDataState>()((set) => ({
  data: null,
  loading: false,
  async reload() {
    const n = ++seq
    set({ loading: true })
    try {
      const data = await api.graph()
      if (n === seq) set({ data: data ?? { nodes: [], links: [], tagged: [] }, loading: false })
    } catch (e) {
      console.warn('Could not load the graph:', e)
      if (n === seq) set({ loading: false })
    }
  },
}))

let refs = 0
let off: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function acquire(): void {
  refs += 1
  if (refs > 1) return
  void useGraphDataStore.getState().reload()
  off = api.onChange((e) => {
    if (!RELOAD_ON.has(e.kind)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void useGraphDataStore.getState().reload()
    }, RELOAD_DELAY_MS)
  })
}

function release(): void {
  refs = Math.max(0, refs - 1)
  if (refs > 0) return
  off?.()
  off = null
  if (timer) clearTimeout(timer)
  timer = null
}

/** Forget everything (tests). */
export function resetGraphData(): void {
  refs = 0
  off?.()
  off = null
  if (timer) clearTimeout(timer)
  timer = null
  seq += 1
  useGraphDataStore.setState({ data: null, loading: false })
}

/** The graph payload; the first mounted user loads it and listens for changes. */
export function useGraphData(): GraphDataState {
  useEffect(() => {
    acquire()
    return release
  }, [])
  return useGraphDataStore()
}
