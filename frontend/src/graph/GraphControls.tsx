// M31 item 8: the graph's controls over the canvas (catalog §7 Graph).
// Top right: a count pill (the objects shown after the filters), "Open as list" (a document icon)
// and "Recently opened" (a history icon). Bottom right: zoom out, the zoom menu (Page Fit, 5% …
// 300%), zoom in, download ("Export view as PNG") and the settings dropdown (Customize).
//
// Our calls (listed for Gene; the catalog names the icons but not what they do):
// - "Open as list" lists the objects shown, by title, in a popover; a pick peeks it with the list
//   as the pager (Ctrl/Cmd+click opens a tab), as a click on a node does. No page takes a set of
//   paths, so the list is the popover itself.
// - "Recently opened" lists the objects opened lately (newest first, up to 10) that this graph
//   shows; a pick finds it on the graph (the camera moves to it and its links light up).
// - Zoom: 100% is the whole graph in view (sigma's camera ratio 1); a step is 100 / ratio. Page
//   Fit also centres the graph. Zoom in and out go to the next step; the menu's label shows the
//   zoom now, wheel zooms included.
import { useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { TOOLBAR_TEXT } from './GraphToolbar'

/** The zoom menu's steps, in percent (catalog: "5% ... 300%"; the ones between are ours). */
export const ZOOM_STEPS = [5, 10, 25, 50, 75, 100, 150, 200, 300] as const

/** Objects listed in "Open as list" at most (the rest are counted). */
export const LIST_LIMIT = 500
/** Recent objects listed at most. */
export const RECENT_LIMIT = 10

export const GRAPH_CONTROLS_TEXT = {
  count: (n: number) => (n === 1 ? '1 note shown' : `${n.toLocaleString()} notes shown`),
  openAsList: 'Open as list',
  listHeading: 'Notes in this graph',
  listMore: (shown: number, total: number) => `${shown.toLocaleString()} of ${total.toLocaleString()} listed. Find the rest with the search field.`,
  recent: 'Recently opened',
  recentHeading: 'Recently opened',
  noRecent: 'Nothing you opened lately is in this graph.',
  graphControls: 'Graph notes',
  viewControls: 'Graph view',
  zoomOut: 'Zoom out',
  zoomIn: 'Zoom in',
  zoom: 'Zoom',
  pageFit: 'Page Fit',
  percent: (p: number) => `${p}%`,
} as const

const T = GRAPH_CONTROLS_TEXT

/** The zoom step after `percent` going in (`1`) or out (`-1`), or null past the last one. */
export function nextZoom(percent: number, dir: 1 | -1): number | null {
  const eps = 0.5
  if (dir > 0) return ZOOM_STEPS.find((s) => s > percent + eps) ?? null
  return [...ZOOM_STEPS].reverse().find((s) => s < percent - eps) ?? null
}

/** The camera ratio that shows `percent`. */
export const ratioOf = (percent: number): number => 100 / percent
/** The percent a camera ratio shows. */
export const percentOf = (ratio: number): number => (ratio > 0 ? 100 / ratio : 100)

const iconButton =
  'flex size-8 items-center justify-center rounded-lg border border-line bg-raised hover:bg-hover disabled:opacity-40 disabled:hover:bg-raised'

export interface GraphItem {
  path: string
  title: string
}

function ItemList({
  label,
  items,
  onPick,
  footer,
}: {
  label: string
  items: GraphItem[]
  onPick(path: string, event: ReactMouseEvent): void
  footer?: ReactNode
}) {
  return (
    <div className="flex flex-col">
      <h3 className="px-2 pt-1 pb-1.5 text-[12px] font-medium text-fg-muted">{label}</h3>
      <ul aria-label={label} className="flex max-h-80 flex-col overflow-y-auto">
        {items.map((it) => (
          <li key={it.path}>
            <button
              type="button"
              onClick={(e) => onPick(it.path, e)}
              className="flex h-7 w-full items-center rounded-md px-2 text-left text-[13px] hover:bg-hover"
            >
              <span className="truncate">{it.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {footer}
    </div>
  )
}

export interface GraphTopControlsProps {
  /** The objects shown (after the filters), in graph order. */
  items: GraphItem[]
  /** Recently opened paths, newest first. */
  recent: string[]
  /** "Open as list": `list` is the listed paths (the peek's pager). */
  onOpen(path: string, event: ReactMouseEvent, list: string[]): void
  /** "Recently opened": find the object on the graph. */
  onFind(path: string): void
}

export function GraphTopControls({ items, recent, onOpen, onFind }: GraphTopControlsProps) {
  const [listOpen, setListOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const sorted = useMemo(
    () => (listOpen ? [...items].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })) : []),
    [items, listOpen],
  )
  const listed = sorted.slice(0, LIST_LIMIT)
  const recentItems = useMemo(() => {
    if (!recentOpen) return []
    const byPath = new Map(items.map((i) => [i.path, i]))
    return recent.flatMap((p) => byPath.get(p) ?? []).slice(0, RECENT_LIMIT)
  }, [items, recent, recentOpen])

  return (
    <div role="toolbar" aria-label={T.graphControls} className="pointer-events-auto flex items-center gap-1.5">
      <span
        data-testid="graph-count"
        title={T.count(items.length)}
        className="flex h-8 items-center rounded-lg border border-line bg-raised px-2.5 text-[13px] text-fg-muted tabular-nums"
      >
        {items.length.toLocaleString()}
      </span>
      <Popover open={listOpen} onOpenChange={setListOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={T.openAsList} title={T.openAsList} className={iconButton}>
            <Icon name="ph-file-text" size={15} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1.5">
          <ItemList
            label={T.listHeading}
            items={listed}
            onPick={(path, e) => {
              setListOpen(false)
              onOpen(path, e, listed.map((i) => i.path))
            }}
            footer={
              sorted.length > listed.length ? (
                <p className="px-2 pt-1.5 text-[12px] text-fg-muted">{T.listMore(listed.length, sorted.length)}</p>
              ) : null
            }
          />
        </PopoverContent>
      </Popover>
      <Popover open={recentOpen} onOpenChange={setRecentOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={T.recent} title={T.recent} className={iconButton}>
            <Icon name="ph-clock-counter-clockwise" size={15} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1.5">
          {recentItems.length === 0 ? (
            <p className="px-2 py-1.5 text-[13px] text-fg-muted">{T.noRecent}</p>
          ) : (
            <ItemList
              label={T.recentHeading}
              items={recentItems}
              onPick={(path) => {
                setRecentOpen(false)
                onFind(path)
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

export interface GraphZoomControlsProps {
  /** The zoom now, in percent (from the camera). */
  percent: number
  /** Zoom to a step (percent), or `'fit'` for Page Fit. */
  onZoom(to: number | 'fit'): void
  /** "Export view as PNG". */
  onExport(): void
  /** The Customize dropdown. */
  customize?: ReactNode
}

export function GraphZoomControls({ percent, onZoom, onExport, customize }: GraphZoomControlsProps) {
  const zoomIn = nextZoom(percent, 1)
  const zoomOut = nextZoom(percent, -1)
  return (
    <div role="toolbar" aria-label={T.viewControls} className="pointer-events-auto flex items-center gap-1.5">
      <button
        type="button"
        aria-label={T.zoomOut}
        title={T.zoomOut}
        disabled={zoomOut === null}
        onClick={() => zoomOut !== null && onZoom(zoomOut)}
        className={iconButton}
      >
        <Icon name="ph-minus" size={14} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={T.zoom}
            title={T.zoom}
            className="flex h-8 min-w-[72px] items-center justify-between gap-1 rounded-lg border border-line bg-raised px-2 text-[13px] tabular-nums hover:bg-hover"
          >
            {T.percent(Math.round(percent))}
            <Icon name="ph-caret-down" size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="min-w-[120px] border-line bg-raised">
          <DropdownMenuItem onSelect={() => onZoom('fit')}>{T.pageFit}</DropdownMenuItem>
          {ZOOM_STEPS.map((s) => (
            <DropdownMenuItem
              key={s}
              onSelect={() => onZoom(s)}
              className={cn(Math.round(percent) === s && 'font-medium')}
            >
              {T.percent(s)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={T.zoomIn}
        title={T.zoomIn}
        disabled={zoomIn === null}
        onClick={() => zoomIn !== null && onZoom(zoomIn)}
        className={iconButton}
      >
        <Icon name="ph-plus" size={14} />
      </button>
      <button type="button" onClick={onExport} title={TOOLBAR_TEXT.exportPng} aria-label={TOOLBAR_TEXT.exportPng} className={iconButton}>
        <Icon name="ph-download-simple" size={14} />
      </button>
      {customize}
    </div>
  )
}
