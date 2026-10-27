// The open object's local graph in the right panel ("Graph View"): the breadth-first neighbourhood
// of the object, 1 hop by default and 2 at most ("Maximum distance", "Show more" / "Show less",
// remembered in localStorage), the same filters as the global graph except that the centre is
// never hidden, and the same clicks (peek with the visible nodes; Ctrl/Cmd+click opens a tab).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLinkIndex } from '@/links/linkIndex'
import { useTabs, type OpenOptions, type Target } from '@/nav/tabs'
import { GraphCanvas } from './GraphCanvas'
import { GraphCustomization } from './GraphCustomization'
import { GraphLoading } from './GraphLoading'
import { GraphEmpty, openGraphNode } from './GraphPage'
import { GraphToolbar } from './GraphToolbar'
import { exportGraphPng, type GraphRenderer } from './exportPng'
import { bestMatch, filterGraph } from './filterGraph'
import { useGraphData } from './useGraphData'
import { useGraphUi } from './useGraphUi'

export const LOCAL_GRAPH_TEXT = {
  heading: 'Graph View',
  maxDistance: 'Maximum distance',
  showMore: 'Show more',
  showLess: 'Show less',
}

/** localStorage key for the remembered hop count (1 or 2). */
export const HOPS_KEY = 'graph.localHops'

function readHops(): 1 | 2 {
  try {
    return localStorage.getItem(HOPS_KEY) === '2' ? 2 : 1
  } catch {
    return 1
  }
}

function writeHops(hops: 1 | 2): void {
  try {
    localStorage.setItem(HOPS_KEY, String(hops))
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

export interface LocalGraphPanelProps {
  path: string
}

const openInTabs = (target: Target, opts?: OpenOptions) => useTabs.getState().open(target, opts)

export function LocalGraphPanel({ path }: LocalGraphPanelProps) {
  const { data } = useGraphData()
  const { custom, patch } = useGraphUi()
  const types = useLinkIndex((s) => s.types)
  const loaded = useLinkIndex((s) => s.loaded)
  useEffect(() => {
    if (!loaded) void useLinkIndex.getState().load()
  }, [loaded])

  const [hops, setHopsState] = useState<1 | 2>(readHops)
  const setHops = (next: 1 | 2) => {
    setHopsState(next)
    writeHops(next)
  }

  const center = useMemo(() => (data ? data.nodes.findIndex((n) => n.path === path) : -1), [data, path])
  const centerNode = data && center >= 0 ? data.nodes[center] : null
  const visible = useMemo(
    () => (data && center >= 0 ? filterGraph(data, custom, { kind: 'local', center, hops }) : null),
    [data, custom, center, hops],
  )
  const visiblePaths = useMemo(() => (data && visible ? visible.nodes.map((i) => data.nodes[i].path) : []), [data, visible])

  const [layout, setLayout] = useState<{ running: boolean; progress: number }>({ running: false, progress: 0 })
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const [fitSignal, setFitSignal] = useState(0)
  const rendererRef = useRef<GraphRenderer | null>(null)

  // Re-centre on a new active object: forget the search focus and reset the camera.
  const lastPath = useRef(path)
  useEffect(() => {
    if (lastPath.current === path) return
    lastPath.current = path
    setFocusPath(null)
    setFitSignal((n) => n + 1)
  }, [path])

  const onNodeClick = useCallback(
    (p: string, event: MouseEvent | TouchEvent | undefined) => openGraphNode(p, event, visiblePaths, openInTabs),
    [visiblePaths],
  )

  const onSearch = (q: string) => {
    if (!data || !visible) return
    const i = bestMatch(data, visible.nodes, q)
    if (i !== null) setFocusPath(data.nodes[i].path)
  }

  // The centre is always shown, so the only empty state is an object the graph doesn't hold.
  const empty = !!data && center < 0
  const filteredEmpty = !!data && !empty && !!visible && visible.nodes.length === 0
  const step = !data ? 0 : layout.running ? 3 : 4
  const t = LOCAL_GRAPH_TEXT

  return (
    <section aria-label={t.heading} className="flex h-full min-h-0 w-full flex-col gap-2 px-4 pt-4 pb-3">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{t.heading}</h2>
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="text-fg-muted">{t.maxDistance}</span>
          <span className="tabular-nums" data-testid="local-graph-hops">
            {hops}
          </span>
          <button
            type="button"
            onClick={() => setHops(hops === 1 ? 2 : 1)}
            className="rounded-md px-1.5 py-0.5 text-fg-muted hover:bg-hover hover:text-fg"
          >
            {hops === 1 ? t.showMore : t.showLess}
          </button>
        </div>
      </header>
      <GraphToolbar
        compact
        onSearch={onSearch}
        onFit={() => setFitSignal((n) => n + 1)}
        onExport={() => exportGraphPng(rendererRef.current).catch((e: unknown) => console.warn('Could not export the graph:', e))}
        customize={
          <GraphCustomization
            custom={custom}
            onPatch={patch}
            types={types}
            tagsNetworkKey={centerNode?.tag ? 'showTagsNetwork' : undefined}
          />
        }
      />
      <div className="relative min-h-[300px] flex-1 overflow-hidden rounded-lg border border-line bg-panel">
        {data && visible && !empty && !filteredEmpty && (
          <GraphCanvas
            data={data}
            visible={visible}
            custom={custom}
            onNodeClick={onNodeClick}
            focusPath={focusPath}
            fitSignal={fitSignal}
            highlightPath={path}
            onLayout={setLayout}
            rendererRef={rendererRef}
          />
        )}
        {empty && <GraphEmpty filtered={false} />}
        {filteredEmpty && <GraphEmpty filtered />}
        {(!data || (layout.running && !empty && !filteredEmpty)) && (
          <GraphLoading step={step} progress={layout.running ? layout.progress : undefined} />
        )}
      </div>
    </section>
  )
}
