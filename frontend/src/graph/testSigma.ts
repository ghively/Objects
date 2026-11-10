// Test doubles for sigma and the ForceAtlas2 worker (jsdom has no WebGL or workers). Used with
// `vi.mock('sigma', () => sigmaModule())` and `vi.mock('graphology-layout-forceatlas2/worker', () => fa2Module())`.
import { vi, type Mock } from 'vitest'

export interface FakeSigma {
  graph: { order: number; size: number; hasNode(k: string): boolean; getNodeAttribute(k: string, a: string): unknown; forEachNode(cb: (k: string, a: Record<string, unknown>) => void): void }
  settings: Record<string, unknown>
  handlers: Record<string, (payload: unknown) => void>
  camera: FakeCamera
  killed: boolean
  /** Times `refresh()` ran. */
  refreshes: number
  /** Times `setGraph()` handed it a graph (each one a full re-index in sigma). */
  graphsSet: number
  /** The layer canvases `getCanvases()` returns (sized like sigma's, at a pixel ratio of 2). */
  canvases: Record<string, HTMLCanvasElement>
  /** Fire a sigma event, as a click or hover on the canvas would. */
  emit(event: string, payload: unknown): void
}

export const sigmaInstances: FakeSigma[] = []

export interface FakeCamera {
  ratio: number
  animate: Mock<(state: { x?: number; y?: number; ratio?: number }, opts?: unknown) => Promise<void>>
  animatedReset: Mock<(opts?: unknown) => Promise<void>>
  on(event: string, fn: (state: { ratio: number }) => void): FakeCamera
}

function makeCamera(): FakeCamera {
  const listeners: ((state: { ratio: number }) => void)[] = []
  const camera: FakeCamera = {
    ratio: 1,
    animate: vi.fn(async (state: { x?: number; y?: number; ratio?: number }, _opts?: unknown) => {
      if (typeof state?.ratio === 'number') camera.ratio = state.ratio
      for (const fn of listeners) fn({ ratio: camera.ratio })
    }),
    animatedReset: vi.fn(async (_opts?: unknown) => {
      camera.ratio = 1
      for (const fn of listeners) fn({ ratio: camera.ratio })
    }),
    on(event, fn) {
      if (event === 'updated') listeners.push(fn)
      return camera
    },
  }
  return camera
}

type Reducer = (key: string, attrs: Record<string, unknown>) => unknown
interface EdgeWalk {
  forEachEdge(cb: (key: string, attrs: Record<string, unknown>) => void): void
}

export function sigmaModule() {
  class Sigma {
    graph: FakeSigma['graph']
    settings: Record<string, unknown>
    handlers: Record<string, (payload: unknown) => void> = {}
    // The camera keeps its ratio and tells its `updated` listeners, as sigma's does (M31 zoom).
    camera = makeCamera()
    killed = false
    refreshes = 0
    graphsSet = 0
    canvases: Record<string, HTMLCanvasElement> = Object.fromEntries(
      ['edges', 'nodes', 'labels', 'hovers', 'hoverNodes', 'mouse'].map((name) => {
        const c = document.createElement('canvas')
        c.width = 800
        c.height = 600
        c.className = `sigma-${name}`
        return [name, c]
      }),
    )
    constructor(graph: FakeSigma['graph'], _container: HTMLElement, settings: Record<string, unknown>) {
      this.graph = graph
      this.settings = { ...settings }
      // Real sigma processes (runs the reducers over) the graph inside its constructor, before
      // the caller has the instance; a reducer that reaches for it then throws, as it does here.
      this.process()
      sigmaInstances.push(this as unknown as FakeSigma)
    }
    /** Run the node and edge reducers over the graph, as sigma does on every render. */
    process() {
      const g = this.graph as FakeSigma['graph'] & Partial<EdgeWalk>
      const nodeReducer = this.settings.nodeReducer as Reducer | undefined
      const edgeReducer = this.settings.edgeReducer as Reducer | undefined
      if (nodeReducer) g.forEachNode((k, a) => nodeReducer(k, a))
      if (edgeReducer) g.forEachEdge?.((k, a) => edgeReducer(k, a))
    }
    on(event: string, fn: (payload: unknown) => void) {
      this.handlers[event] = fn
      return this
    }
    emit(event: string, payload: unknown) {
      this.handlers[event]?.(payload)
    }
    getGraph() {
      return this.graph
    }
    setGraph(graph: FakeSigma['graph']) {
      this.graph = graph
      this.graphsSet++
      this.process()
    }
    setSetting(key: string, value: unknown) {
      this.settings[key] = value
    }
    refresh() {
      this.refreshes++
      this.process()
    }
    getCanvases() {
      return this.canvases
    }
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
