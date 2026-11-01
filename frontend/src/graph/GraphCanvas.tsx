// colour-literals: content palette
// The WebGL graph: one sigma instance per mount (killed on unmount) over a graphology graph that
// is rebuilt from the visible nodes and edges, laid out by ForceAtlas2 in a worker. Hovering a
// node keeps it and its neighbours bright and dims the rest; `showMinimalNodes` hides labels.
// sigma is loaded on first use: it touches WebGL at import, and it stays out of the main bundle.
// A rebuild fills a new graph, positioned from the start, away from the renderer (in slices with
// a yield between them when it is big), then hands it to sigma in one `setGraph`: no per-node
// renderer events, and the old graph stays on screen until the new one is ready. A big graph is
// laid out before it is handed over (see the build effect).
import Graph from 'graphology'
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type Sigma from 'sigma'
import type { GraphCustomization, GraphData } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import type { VisibleGraph } from './filterGraph'
import { useThemeName } from '@/theme/applyTheme'
import type { ThemeColor } from '@/theme/palette'
import type { GraphRenderer } from './exportPng'
import {
  canvasColors,
  colorValue,
  edgeStyle,
  nodeColor,
  nodeSize,
  REDUCED_NODE_COLOR,
  REDUCED_NODE_SIZE,
  type EdgeKind,
} from './graphStyle'
import { runLayout, startPosition } from './layout'

/** Above this many visible nodes the graph is built in slices of this size, yielding between them. */
export const BUILD_SLICE = 1500
const EDGE_SLICE = 10_000

/** Let the browser paint and handle input between slices. */
function yieldToBrowser(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (typeof s?.yield === 'function') return s.yield()
  return new Promise((r) => setTimeout(r, 0))
}

export interface GraphCanvasProps {
  data: GraphData
  visible: VisibleGraph
  custom: GraphCustomization
  onNodeClick(path: string, event: MouseEvent | TouchEvent | undefined): void
  /** Animate the camera to this node. */
  focusPath?: string | null
  /** Any change resets the camera ("Fit graph to view"). */
  fitSignal?: number
  /** A node always labelled and highlighted (the local graph's centre). */
  highlightPath?: string | null
  /** Layout progress, for `GraphLoading`. */
  onLayout?(state: { running: boolean; progress: number }): void
  /** Set to the sigma renderer while it runs (null before it starts and after unmount), for "Export view as PNG". */
  rendererRef?: MutableRefObject<GraphRenderer | null>
}

interface NodeAttrs {
  path: string
  label: string
  size: number
  color: string
  /** The theme colour behind `color`, re-read on a theme change. */
  themeColor: ThemeColor
  x: number
  y: number
  highlighted?: boolean
  forceLabel?: boolean
  zIndex?: number
  /** A reduced node (see `filterGraph`): labelled only around a hover. */
  reduced?: boolean
}

interface EdgeAttrs {
  kind: EdgeKind
  color: string
  size: number
}

type SigmaClick = { node: string; event?: { original?: MouseEvent | TouchEvent } }

type CanvasGraph = Graph<NodeAttrs, EdgeAttrs>
const newGraph = (): CanvasGraph => new Graph<NodeAttrs, EdgeAttrs>({ type: 'undirected', multi: false })

export function GraphCanvas({
  data,
  visible,
  custom,
  onNodeClick,
  focusPath,
  fitSignal,
  highlightPath,
  onLayout,
  rendererRef,
}: GraphCanvasProps) {
  const container = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma<NodeAttrs, EdgeAttrs> | null>(null)
  const keyByPath = useRef(new Map<string, string>())
  const hovered = useRef<string | null>(null)
  const highlight = useRef<string | null>(highlightPath ?? null)
  const clickRef = useRef(onNodeClick)
  const layoutRef = useRef(onLayout)
  const exposeRef = useRef(rendererRef)
  exposeRef.current = rendererRef
  clickRef.current = onNodeClick
  layoutRef.current = onLayout
  highlight.current = highlightPath ?? null
  // Colours sigma draws with: concrete values read from the theme's tokens, refreshed on a theme change.
  const themeName = useThemeName()
  const colorsRef = useRef<ReturnType<typeof canvasColors> | null>(null)
  if (!colorsRef.current) colorsRef.current = canvasColors()

  const types = useLinkIndex((s) => s.types)
  const objects = useLinkIndex((s) => s.objects)
  const typesById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])), [types])
  // Keyed by content: a summary refresh gives a new `objects` array, and a new map here would
  // rebuild the graph and restart the layout (up to seconds) for a save that changed no colour.
  const tagColorsRef = useRef<Record<string, string | null>>({})
  const tagColors = useMemo(() => {
    const m: Record<string, string | null> = {}
    for (const o of objects) if (o.color) m[o.path] = o.color
    const prev = tagColorsRef.current
    const prevKeys = Object.keys(prev)
    if (prevKeys.length === Object.keys(m).length && prevKeys.every((k) => prev[k] === m[k])) return prev
    tagColorsRef.current = m
    return m
  }, [objects])

  // The graph on screen (a rebuild replaces it) and one sigma per mount.
  const graphRef = useRef<CanvasGraph | null>(null)
  if (!graphRef.current) graphRef.current = newGraph()
  const [sigmaReady, setSigmaReady] = useState(0)
  useEffect(() => {
    const el = container.current
    if (!el) return
    let cancelled = false
    let sigma: Sigma<NodeAttrs, EdgeAttrs> | null = null
    const expose = exposeRef.current
    void import('sigma')
      .then(async ({ default: SigmaClass }) => {
        if (cancelled) return
        // A big graph is handed over in the next task: creating the WebGL context and compiling
        // the shaders, then indexing thousands of nodes, would otherwise be one long task.
        const big = (graphRef.current?.order ?? 0) > BUILD_SLICE
        sigma = start(SigmaClass, el, big ? newGraph() : graphRef.current!)
        sigmaRef.current = sigma
        if (expose) expose.current = sigma
        if (big && sigma) {
          await yieldToBrowser()
          if (cancelled || !sigma) return
          if (sigma.getGraph() !== graphRef.current) sigma.setGraph(graphRef.current!)
        }
        setSigmaReady((n) => n + 1)
      })
      .catch((e: unknown) => console.warn('Could not load the graph renderer:', e))
    return () => {
      cancelled = true
      if (expose && expose.current === sigma) expose.current = null
      sigma?.kill()
      sigmaRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one renderer per mount
  }, [])

  function start(SigmaClass: typeof Sigma, el: HTMLElement, initial: CanvasGraph): Sigma<NodeAttrs, EdgeAttrs> | null {
    const colors = canvasColors()
    colorsRef.current = colors
    let sigma: Sigma<NodeAttrs, EdgeAttrs>
    // The reducers read the graph sigma draws (a rebuild replaces it).
    const shown = (): CanvasGraph => sigma.getGraph()
    try {
      sigma = new SigmaClass<NodeAttrs, EdgeAttrs>(initial, el, {
        allowInvalidContainer: true,
        renderLabels: true,
        labelColor: { color: colors.label },
        labelSize: 12,
        labelFont: 'Inter, system-ui, sans-serif',
        defaultEdgeColor: colors.edge,
        zIndex: true,
        nodeReducer: (node, attrs) => {
          const res: Partial<NodeAttrs> & NodeAttrs = { ...attrs }
          const h = hovered.current
          if (h) {
            if (node === h || shown().areNeighbors(node, h)) {
              res.forceLabel = true
              res.zIndex = 1
            } else {
              res.color = colorsRef.current?.dim ?? colors.dim
              res.label = ''
              res.zIndex = 0
            }
          }
          if (highlight.current && attrs.path === highlight.current) {
            res.highlighted = true
            res.forceLabel = true
            res.zIndex = 2
          }
          if (attrs.reduced && !res.forceLabel) res.label = ''
          return res
        },
        edgeReducer: (edge, attrs) => {
          const h = hovered.current
          if (!h) return attrs
          const [a, b] = shown().extremities(edge)
          if (a === h || b === h) return { ...attrs, size: attrs.size + 0.5 }
          return { ...attrs, color: 'rgba(0,0,0,0)' }
        },
      })
    } catch (e) {
      console.warn('Could not start the graph renderer:', e)
      return null
    }
    sigma.setSetting('renderLabels', !minimalRef.current)
    sigma.on('enterNode', ({ node }: { node: string }) => {
      hovered.current = node
      sigma.refresh()
    })
    sigma.on('leaveNode', () => {
      hovered.current = null
      sigma.refresh()
    })
    sigma.on('clickNode', ({ node, event }: SigmaClick) => {
      const g = shown()
      if (!g.hasNode(node)) return
      clickRef.current(g.getNodeAttribute(node, 'path'), event?.original)
    })
    return sigma
  }

  // Rebuild the graph from what is visible, then lay it out.
  useEffect(() => {
    const ctrl = new AbortController()
    const { signal } = ctrl
    const big = visible.nodes.length > BUILD_SLICE
    void (async () => {
      const next = newGraph()
      const keys = new Map<string, string>()
      const added = new Set<string>()
      const reduced = new Set(visible.reduced)
      const order = visible.nodes.length
      // ~20 theme colours, each read from CSS once per build instead of once per node.
      const colorCache = new Map<ThemeColor, string>()
      const color = (c: ThemeColor): string => {
        let v = colorCache.get(c)
        if (v === undefined) colorCache.set(c, (v = colorValue(c)))
        return v
      }
      const nodes: { key: string; attributes: NodeAttrs }[] = []
      for (let n = 0; n < visible.nodes.length; n++) {
        const i = visible.nodes[n]
        const node = data.nodes[i]
        const key = String(i)
        if (node && !added.has(key)) {
          added.add(key)
          keys.set(node.path, key)
          // Reduced nodes (kept by a filter only to carry links): smallest size, gray, unlabelled.
          const isReduced = reduced.has(i)
          const themeColor = isReduced ? REDUCED_NODE_COLOR : nodeColor(node, typesById, tagColors[node.path])
          const p = startPosition(node.path, order)
          const attributes: NodeAttrs = {
            path: node.path,
            label: node.title || node.path,
            size: isReduced ? REDUCED_NODE_SIZE : nodeSize(node.degree),
            color: color(themeColor),
            themeColor,
            x: p.x,
            y: p.y,
          }
          if (isReduced) attributes.reduced = true
          nodes.push({ key, attributes })
        }
        if (nodes.length >= BUILD_SLICE || n === visible.nodes.length - 1) {
          next.import({ nodes: nodes.splice(0) })
          if (big) {
            await yieldToBrowser()
            if (signal.aborted) return
          }
        }
      }
      const seen = new Set<string>()
      const edges: { source: string; target: string; attributes: EdgeAttrs }[] = []
      const add = async (pairs: [number, number][], kind: EdgeKind) => {
        const style = edgeStyle(kind)
        for (const [a, b] of pairs) {
          const ka = String(a)
          const kb = String(b)
          const pair = a < b ? `${a}-${b}` : `${b}-${a}`
          if (ka !== kb && next.hasNode(ka) && next.hasNode(kb) && !seen.has(pair)) {
            seen.add(pair)
            edges.push({ source: ka, target: kb, attributes: { kind, color: style.color, size: style.size } })
          }
          if (edges.length >= EDGE_SLICE) {
            next.import({ edges: edges.splice(0) })
            if (big) {
              await yieldToBrowser()
              if (signal.aborted) return
            }
          }
        }
      }
      await add(visible.links, 'link')
      await add(visible.tagLinks, 'tag')
      if (signal.aborted) return
      if (edges.length) next.import({ edges })

      // On screen in one step: sigma indexes the whole graph once.
      const show = () => {
        graphRef.current = next
        keyByPath.current = keys
        const sigma = sigmaRef.current
        if (sigma && sigma.getGraph() !== next) sigma.setGraph(next)
      }
      // A small graph is shown at once and moves while it settles. A big one is laid out before
      // it is shown ("Arranging the layout", then "Drawing the graph"): with sigma listening, each
      // ForceAtlas2 step re-indexes every node (~100 ms at 5,000), so the page would stay busy
      // for the whole layout; away from sigma a step costs a few ms.
      if (!big) show()
      layoutRef.current?.({ running: true, progress: 0 })
      await runLayout(next, {
        signal,
        seeded: true,
        onProgress: (progress) => {
          if (!signal.aborted) layoutRef.current?.({ running: progress < 1, progress })
        },
      })
      if (signal.aborted) return
      if (big) show()
      layoutRef.current?.({ running: false, progress: 1 })
    })()
    return () => ctrl.abort()
  }, [data, visible, typesById, tagColors])

  const minimalRef = useRef(!!custom.showMinimalNodes)
  minimalRef.current = !!custom.showMinimalNodes
  useEffect(() => {
    sigmaRef.current?.setSetting('renderLabels', !custom.showMinimalNodes)
  }, [custom.showMinimalNodes, sigmaReady])

  useEffect(() => {
    sigmaRef.current?.refresh()
  }, [highlightPath])

  // A theme change (Light, Dark, …): re-read the token colours and repaint, keeping the layout.
  const firstTheme = useRef(themeName)
  useEffect(() => {
    if (themeName === firstTheme.current) return
    firstTheme.current = themeName
    const colors = canvasColors()
    colorsRef.current = colors
    const values = new Map<ThemeColor, string>()
    graphRef.current!.updateEachNodeAttributes(
      (_key, attrs) => {
        let v = values.get(attrs.themeColor)
        if (v === undefined) values.set(attrs.themeColor, (v = colorValue(attrs.themeColor)))
        return { ...attrs, color: v }
      },
      { attributes: ['color'] },
    )
    const sigma = sigmaRef.current
    if (!sigma) return
    sigma.setSetting('labelColor', { color: colors.label })
    sigma.setSetting('defaultEdgeColor', colors.edge)
    sigma.refresh()
  }, [themeName])

  useEffect(() => {
    const sigma = sigmaRef.current
    if (!sigma || !focusPath) return
    const key = keyByPath.current.get(focusPath)
    if (!key) return
    const d = sigma.getNodeDisplayData(key)
    if (!d) return
    hovered.current = key
    sigma.refresh()
    void sigma.getCamera().animate({ x: d.x, y: d.y, ratio: 0.35 }, { duration: 500 })
  }, [focusPath, sigmaReady])

  const firstFit = useRef(fitSignal)
  useEffect(() => {
    if (fitSignal === firstFit.current) return
    firstFit.current = fitSignal
    void sigmaRef.current?.getCamera().animatedReset({ duration: 400 })
  }, [fitSignal])

  return (
    <div
      ref={container}
      className="graph-canvas"
      data-testid="graph-canvas"
      data-node-count={visible.nodes.length}
      data-edge-count={visible.links.length + visible.tagLinks.length}
      data-reduced-count={visible.reduced.length}
      onMouseLeave={() => {
        if (hovered.current) {
          hovered.current = null
          sigmaRef.current?.refresh()
        }
      }}
    />
  )
}
