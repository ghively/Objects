// ForceAtlas2 in a web worker, so laying out thousands of nodes never blocks the UI. New nodes
// start at a position derived from a hash of their path (deterministic), nodes seen before keep
// their last position, and the layout stops once nodes barely move or after 4 s.
import type Graph from 'graphology'
import { inferSettings } from 'graphology-layout-forceatlas2'
import FA2Layout from 'graphology-layout-forceatlas2/worker'

export const LAYOUT_MAX_MS = 4000
export const LAYOUT_SAMPLE_MS = 200
/** Stop when the mean displacement per sample falls below this (graph units). */
export const LAYOUT_STILL = 0.05
export const BARNES_HUT_ABOVE = 500

/** Last known positions by path, so a reload or a filter change doesn't scatter the graph. */
const positions = new Map<string, { x: number; y: number }>()

export function forgetPositions(): void {
  positions.clear()
}

/** FNV-1a 32-bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A deterministic start position for `path` inside a disc whose size grows with the graph. */
export function initialPosition(path: string, order: number): { x: number; y: number } {
  const h = hashString(path)
  const angle = ((h & 0xffff) / 0x10000) * Math.PI * 2
  const radius = Math.sqrt(((h >>> 16) + 1) / 0x10000) * Math.max(10, Math.sqrt(order) * 10)
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

/** Give every node `x`/`y`: its last position, or one from the hash of its `path` attribute. */
export function seedPositions(graph: Graph): void {
  const order = graph.order
  graph.forEachNode((key, attrs) => {
    const path = (attrs.path as string | undefined) ?? key
    const p = positions.get(path) ?? initialPosition(path, order)
    graph.mergeNodeAttributes(key, { x: p.x, y: p.y })
  })
}

function remember(graph: Graph): void {
  graph.forEachNode((key, attrs) => {
    const path = (attrs.path as string | undefined) ?? key
    if (Number.isFinite(attrs.x) && Number.isFinite(attrs.y)) positions.set(path, { x: attrs.x, y: attrs.y })
  })
}

export interface LayoutOptions {
  signal?: AbortSignal
  /** 0–1 while running. */
  onProgress?: (progress: number) => void
}

export function runLayout(graph: Graph, { signal, onProgress }: LayoutOptions = {}): Promise<void> {
  seedPositions(graph)
  if (graph.order < 2 || graph.size === 0 || signal?.aborted) {
    remember(graph)
    onProgress?.(1)
    return Promise.resolve()
  }
  const settings = { ...inferSettings(graph), barnesHutOptimize: graph.order > BARNES_HUT_ABOVE }
  return new Promise<void>((resolve) => {
    let layout: FA2Layout | null = null
    let interval: ReturnType<typeof setInterval> | null = null
    const started = Date.now()
    let last = new Map<string, [number, number]>()
    const snapshot = () => {
      const m = new Map<string, [number, number]>()
      graph.forEachNode((key, a) => m.set(key, [a.x as number, a.y as number]))
      return m
    }
    const finish = () => {
      if (interval) clearInterval(interval)
      interval = null
      signal?.removeEventListener('abort', finish)
      if (layout) {
        layout.kill()
        layout = null
      }
      remember(graph)
      onProgress?.(1)
      resolve()
    }
    try {
      layout = new FA2Layout(graph, { settings })
      layout.start()
    } catch (e) {
      // No worker support: keep the seeded positions.
      console.warn('Could not run the graph layout:', e)
      finish()
      return
    }
    signal?.addEventListener('abort', finish)
    last = snapshot()
    interval = setInterval(() => {
      const elapsed = Date.now() - started
      const now = snapshot()
      let moved = 0
      for (const [key, [x, y]] of now) {
        const p = last.get(key)
        if (p) moved += Math.hypot(x - p[0], y - p[1])
      }
      last = now
      const mean = now.size ? moved / now.size : 0
      onProgress?.(Math.min(0.99, elapsed / LAYOUT_MAX_MS))
      if (elapsed >= LAYOUT_MAX_MS || (elapsed >= LAYOUT_SAMPLE_MS * 2 && mean < LAYOUT_STILL)) finish()
    }, LAYOUT_SAMPLE_MS)
  })
}
