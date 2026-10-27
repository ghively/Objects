// The WebGL graph: one sigma instance per mount (killed on unmount) over a graphology graph that
// is rebuilt from the visible nodes and edges, laid out by ForceAtlas2 in a worker. Hovering a
// node keeps it and its neighbours bright and dims the rest; `showMinimalNodes` hides labels.
// sigma is loaded on first use: it touches WebGL at import, and it stays out of the main bundle.
import Graph from 'graphology'
import { useEffect, useMemo, useRef, useState } from 'react'
import type Sigma from 'sigma'
import type { GraphCustomization, GraphData } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import type { VisibleGraph } from './filterGraph'
import { canvasColors, colorValue, edgeStyle, nodeColor, nodeSize, type EdgeKind } from './graphStyle'
import { runLayout } from './layout'

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
}

interface NodeAttrs {
  path: string
  label: string
  size: number
  color: string
  x: number
  y: number
  highlighted?: boolean
  forceLabel?: boolean
  zIndex?: number
}

interface EdgeAttrs {
  kind: EdgeKind
  color: string
  size: number
}

type SigmaClick = { node: string; event?: { original?: MouseEvent | TouchEvent } }

export function GraphCanvas({ data, visible, custom, onNodeClick, focusPath, fitSignal, highlightPath, onLayout }: GraphCanvasProps) {
  const container = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma<NodeAttrs, EdgeAttrs> | null>(null)
  const keyByPath = useRef(new Map<string, string>())
  const hovered = useRef<string | null>(null)
  const highlight = useRef<string | null>(highlightPath ?? null)
  const clickRef = useRef(onNodeClick)
  const layoutRef = useRef(onLayout)
  clickRef.current = onNodeClick
  layoutRef.current = onLayout
  highlight.current = highlightPath ?? null

  const types = useLinkIndex((s) => s.types)
  const objects = useLinkIndex((s) => s.objects)
  const typesById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])), [types])
  const tagColors = useMemo(() => {
    const m: Record<string, string | null> = {}
    for (const o of objects) if (o.color) m[o.path] = o.color
    return m
  }, [objects])

  // One graph and one sigma per mount.
  const [graph] = useState(() => new Graph<NodeAttrs, EdgeAttrs>({ type: 'undirected', multi: false }))
  const [sigmaReady, setSigmaReady] = useState(0)
  useEffect(() => {
    const el = container.current
    if (!el) return
    let cancelled = false
    let sigma: Sigma<NodeAttrs, EdgeAttrs> | null = null
    void import('sigma')
      .then(({ default: SigmaClass }) => {
        if (cancelled) return
        sigma = start(SigmaClass, el)
        sigmaRef.current = sigma
        setSigmaReady((n) => n + 1)
      })
      .catch((e: unknown) => console.warn('Could not load the graph renderer:', e))
    return () => {
      cancelled = true
      sigma?.kill()
      sigmaRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one renderer per mount
  }, [])

  function start(SigmaClass: typeof Sigma, el: HTMLElement): Sigma<NodeAttrs, EdgeAttrs> | null {
    const colors = canvasColors()
    let sigma: Sigma<NodeAttrs, EdgeAttrs>
    try {
      sigma = new SigmaClass<NodeAttrs, EdgeAttrs>(graph, el, {
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
            if (node === h || graph.areNeighbors(node, h)) {
              res.forceLabel = true
              res.zIndex = 1
            } else {
              res.color = colors.dim
              res.label = ''
              res.zIndex = 0
            }
          }
          if (highlight.current && attrs.path === highlight.current) {
            res.highlighted = true
            res.forceLabel = true
            res.zIndex = 2
          }
          return res
        },
        edgeReducer: (edge, attrs) => {
          const h = hovered.current
          if (!h) return attrs
          const [a, b] = graph.extremities(edge)
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
      if (!graph.hasNode(node)) return
      clickRef.current(graph.getNodeAttribute(node, 'path'), event?.original)
    })
    return sigma
  }

  // Rebuild the graph from what is visible, then lay it out.
  useEffect(() => {
    graph.clear()
    const keys = new Map<string, string>()
    for (const i of visible.nodes) {
      const node = data.nodes[i]
      if (!node) continue
      const key = String(i)
      keys.set(node.path, key)
      graph.addNode(key, {
        path: node.path,
        label: node.title || node.path,
        size: nodeSize(node.degree),
        color: colorValue(nodeColor(node, typesById, tagColors[node.path])),
        x: 0,
        y: 0,
      })
    }
    keyByPath.current = keys
    const add = (pairs: [number, number][], kind: EdgeKind) => {
      const style = edgeStyle(kind)
      for (const [a, b] of pairs) {
        const ka = String(a)
        const kb = String(b)
        if (!graph.hasNode(ka) || !graph.hasNode(kb) || graph.hasEdge(ka, kb)) continue
        graph.addEdge(ka, kb, { kind, color: style.color, size: style.size })
      }
    }
    add(visible.links, 'link')
    add(visible.tagLinks, 'tag')
    add(visible.indirect, 'indirect')

    const ctrl = new AbortController()
    layoutRef.current?.({ running: true, progress: 0 })
    void runLayout(graph, {
      signal: ctrl.signal,
      onProgress: (progress) => {
        if (!ctrl.signal.aborted) layoutRef.current?.({ running: progress < 1, progress })
      },
    }).then(() => {
      if (!ctrl.signal.aborted) layoutRef.current?.({ running: false, progress: 1 })
    })
    return () => ctrl.abort()
  }, [graph, data, visible, typesById, tagColors])

  const minimalRef = useRef(!!custom.showMinimalNodes)
  minimalRef.current = !!custom.showMinimalNodes
  useEffect(() => {
    sigmaRef.current?.setSetting('renderLabels', !custom.showMinimalNodes)
  }, [custom.showMinimalNodes, sigmaReady])

  useEffect(() => {
    sigmaRef.current?.refresh()
  }, [highlightPath])

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
      data-edge-count={visible.links.length + visible.indirect.length + visible.tagLinks.length}
      onMouseLeave={() => {
        if (hovered.current) {
          hovered.current = null
          sigmaRef.current?.refresh()
        }
      }}
    />
  )
}
