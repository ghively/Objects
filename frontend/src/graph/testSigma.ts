// Test doubles for sigma and the ForceAtlas2 worker (jsdom has no WebGL or workers). Used with
// `vi.mock('sigma', () => sigmaModule())` and `vi.mock('graphology-layout-forceatlas2/worker', () => fa2Module())`.
import { vi } from 'vitest'

export interface FakeSigma {
  graph: { order: number; size: number; hasNode(k: string): boolean; getNodeAttribute(k: string, a: string): unknown; forEachNode(cb: (k: string, a: Record<string, unknown>) => void): void }
  settings: Record<string, unknown>
  handlers: Record<string, (payload: unknown) => void>
  camera: { animate: ReturnType<typeof vi.fn>; animatedReset: ReturnType<typeof vi.fn> }
  killed: boolean
  /** Fire a sigma event, as a click or hover on the canvas would. */
  emit(event: string, payload: unknown): void
}

export const sigmaInstances: FakeSigma[] = []

export function sigmaModule() {
  class Sigma {
    graph: FakeSigma['graph']
    settings: Record<string, unknown>
    handlers: Record<string, (payload: unknown) => void> = {}
    camera = { animate: vi.fn(async () => undefined), animatedReset: vi.fn(async () => undefined) }
    killed = false
    constructor(graph: FakeSigma['graph'], _container: HTMLElement, settings: Record<string, unknown>) {
      this.graph = graph
      this.settings = { ...settings }
      sigmaInstances.push(this as unknown as FakeSigma)
    }
    on(event: string, fn: (payload: unknown) => void) {
      this.handlers[event] = fn
      return this
    }
    emit(event: string, payload: unknown) {
      this.handlers[event]?.(payload)
    }
    setSetting(key: string, value: unknown) {
      this.settings[key] = value
    }
    refresh() {}
    kill() {
      this.killed = true
    }
    getCamera() {
      return this.camera
    }
    getNodeDisplayData(key: string) {
      return this.graph.hasNode(key) ? { x: 0.5, y: 0.25 } : undefined
    }
  }
  return { default: Sigma }
}

export function fa2Module() {
  class FA2Layout {
    start() {}
    stop() {}
    kill() {}
    isRunning() {
      return false
    }
  }
  return { default: FA2Layout }
}

/** The node keys of the latest sigma graph, by `path` attribute. */
export function latestPaths(): string[] {
  const s = sigmaInstances[sigmaInstances.length - 1]
  const out: string[] = []
  s?.graph.forEachNode((_k, a) => out.push(a.path as string))
  return out
}
