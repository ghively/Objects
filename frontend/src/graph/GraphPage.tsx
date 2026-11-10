// The global graph page: header "Graph" with the search field, the sigma canvas over every visible
// object with its controls (M31, catalog §7: top right the count pill, "Open as list" and "Recently
// opened"; bottom right zoom out, the zoom menu, zoom in, "Export view as PNG" and Customize), and
// its empty states. A click peeks the node
// with the visible nodes as the pager list; Ctrl/Cmd+click opens it in a new tab.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useLinkIndex } from '@/links/linkIndex'
import { useRecent } from '@/nav/recent'
import { usePeek, type OpenOptions, type Target } from '@/nav/tabs'
import { GraphCanvas } from './GraphCanvas'
import { GraphTopControls, GraphZoomControls, percentOf, ratioOf, type GraphItem } from './GraphControls'
import { GraphCustomization } from './GraphCustomization'
import { GraphLoading } from './GraphLoading'
import { GraphToolbar } from './GraphToolbar'
import { exportGraphPng, type GraphRenderer } from './exportPng'
import { bestMatch, filterGraph } from './filterGraph'
import { useGraphData } from './useGraphData'
import { useGraphUi } from './useGraphUi'

export const GRAPH_TEXT = {
  heading: 'Graph',
  emptyTitle: 'Nothing to show',
  emptyDescription: 'This graph has no nodes yet.',
  emptyFiltered: 'Your filters hide every node in this graph.',
}

export interface GraphPageProps {
  onOpenTarget: (target: Target, opts?: OpenOptions) => void
}

/** Ctrl/Cmd+click opens a tab; a plain click peeks with `list` as the pager. */
export function openGraphNode(
  path: string,
  event: MouseEvent | TouchEvent | undefined,
  list: string[],
  onOpenTarget: (target: Target, opts?: OpenOptions) => void,
): void {
  const e = event as MouseEvent | undefined
  if (e && (e.ctrlKey || e.metaKey)) {
    onOpenTarget({ kind: 'object', path }, { newTab: true })
    return
  }
  usePeek.getState().peek(path, list)
}

export function GraphEmpty({ filtered }: { filtered: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center" data-testid="graph-empty">
      <p className="text-[15px] font-semibold">{GRAPH_TEXT.emptyTitle}</p>
      <p className="text-[13px] text-fg-muted">{filtered ? GRAPH_TEXT.emptyFiltered : GRAPH_TEXT.emptyDescription}</p>
    </div>
  )
}

export function GraphPage({ onOpenTarget }: GraphPageProps) {
  const { data } = useGraphData()
  const { custom, patch } = useGraphUi()
  const types = useLinkIndex((s) => s.types)
  const loaded = useLinkIndex((s) => s.loaded)
  useEffect(() => {
    if (!loaded) void useLinkIndex.getState().load()
  }, [loaded])

  const visible = useMemo(() => (data ? filterGraph(data, custom, { kind: 'global' }) : null), [data, custom])
  const visiblePaths = useMemo(() => (data && visible ? visible.nodes.map((i) => data.nodes[i].path) : []), [data, visible])
  const [layout, setLayout] = useState<{ running: boolean; progress: number }>({ running: false, progress: 0 })
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const [focusSignal, setFocusSignal] = useState(0)
  const [fitSignal, setFitSignal] = useState(0)
  const [zoomRequest, setZoomRequest] = useState<{ ratio: number; n: number } | null>(null)
  const [percent, setPercent] = useState(100)
  const recent = useRecent((s) => s.paths)
  const items = useMemo<GraphItem[]>(
    () => (data && visible ? visible.nodes.map((i) => ({ path: data.nodes[i].path, title: data.nodes[i].title || data.nodes[i].path })) : []),
    [data, visible],
  )
  const onZoom = useCallback((to: number | 'fit') => {
    if (to === 'fit') setFitSignal((n) => n + 1)
    else setZoomRequest((cur) => ({ ratio: ratioOf(to), n: (cur?.n ?? 0) + 1 }))
  }, [])
  const onCameraRatio = useCallback((ratio: number) => setPercent(Math.round(percentOf(ratio) * 100) / 100), [])
  const find = useCallback((path: string) => {
    setFocusPath(path)
    setFocusSignal((n) => n + 1)
  }, [])
  const rendererRef = useRef<GraphRenderer | null>(null)

  const onNodeClick = useCallback(
    (path: string, event: MouseEvent | TouchEvent | undefined) => openGraphNode(path, event, visiblePaths, onOpenTarget),
    [visiblePaths, onOpenTarget],
  )

  const onSearch = (q: string) => {
    if (!data || !visible) return
    const i = bestMatch(data, visible.nodes, q)
    if (i !== null) find(data.nodes[i].path)
  }
  const exportPng = () => exportGraphPng(rendererRef.current).catch((e: unknown) => console.warn('Could not export the graph:', e))

  const empty = !!data && data.nodes.length === 0
  const filteredEmpty = !!data && !empty && !!visible && visible.nodes.length === 0
  const step = !data ? 0 : layout.running ? 3 : 4

  return (
    <div className="flex h-full min-h-0 w-full flex-col px-6 pt-5 pb-4">
      <header className="flex flex-wrap items-center gap-2.5 pb-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover-2">
          <Icon name="ph-graph" size={20} />
        </span>
        <h1 className="min-w-0 flex-1 text-[20px] font-bold md:text-[22px]">{GRAPH_TEXT.heading}</h1>
        <GraphToolbar onSearch={onSearch} />
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel">
        {data && visible && !empty && !filteredEmpty && (
          <GraphCanvas
            data={data}
            visible={visible}
            custom={custom}
            onNodeClick={onNodeClick}
            focusPath={focusPath}
            focusSignal={focusSignal}
            zoomRequest={zoomRequest}
            onCameraRatio={onCameraRatio}
            fitSignal={fitSignal}
            onLayout={setLayout}
            rendererRef={rendererRef}
          />
        )}
        {empty && <GraphEmpty filtered={false} />}
        {filteredEmpty && <GraphEmpty filtered />}
        {(!data || (layout.running && !empty && !filteredEmpty)) && (
          <GraphLoading step={step} progress={layout.running ? layout.progress : undefined} />
        )}
        {data && !empty && (
          <div className="pointer-events-none absolute top-2 right-2 z-10">
            <GraphTopControls
              items={items}
              recent={recent}
              onOpen={(path, e, list) => openGraphNode(path, e.nativeEvent, list, onOpenTarget)}
              onFind={find}
            />
          </div>
        )}
        {data && !empty && (
          <div className="pointer-events-none absolute right-2 bottom-2 z-10">
            <GraphZoomControls
              percent={percent}
              onZoom={onZoom}
              onExport={() => void exportPng()}
              customize={<GraphCustomization custom={custom} onPatch={patch} types={types} tagsNetworkKey="showSpaceTagsNetwork" iconOnly />}
            />
          </div>
        )}
      </div>
    </div>
  )
}
