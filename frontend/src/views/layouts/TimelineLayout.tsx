// M13: the timeline layout (our layout, our strings). A table on the left (the title plus the
// chosen columns, with the column calculations in its footer) and one bar per object on a
// scrolled time axis on the right. Dragging a bar's body moves both dates; dragging an edge
// changes one; the write happens once, on drop. Objects without a start wait in the "No date"
// tray below and can be dragged onto the axis. With the view's sub-items, rows nest under their
// parent; with its dependencies, arrows join each blocker's bar end to the blocked bar's start,
// and the handle at a bar's right end links it to another bar (that bar becomes blocked by it).
//
// It draws `props.flat` (every row that survives the view's filters and sorts); only the rows in
// the scrolled window are rendered, so a large view stays responsive. Nothing is written on read.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { api, ConflictError } from '@/api/client'
import type { PropertyDef, Row, TableColumn, TimelineViewConfig, TimelineZoom, TypeDef, UpdateResult, ViewState } from '@/api/types'
import { todayYmd } from '@/calendar/dates'
import { Icon } from '@/components/Icon'
import { useTabs } from '@/nav/tabs'
import { cellForDef } from '@/properties/cellFor'
import { cn } from '@/lib/utils'
import type { LayoutProps } from '../DataView'
import { dayReader } from '../dates'
import { MenuSelect, propertyOptions } from '../MenuSelect'
import { propertyChoices } from '../properties'
import { createRowWrites } from '../rowWrites'
import { buildRowTree, flattenTree, visibleTreeRows, type TreeRow } from '../subItems'
import { CalcFooter } from '../table/CalcFooter'
import {
  addBlocker,
  axisWindow,
  barSpan,
  buildAxis,
  canWriteDate,
  dateChoices,
  dayAt,
  dayNum,
  dayText,
  dragSpan,
  dragUpdates,
  inWindow,
  linkedPaths,
  relationRefs,
  resolveEnd,
  resolveStart,
  timelineConfig,
  type Axis,
  type BarSpan,
  type DragMode,
} from './timeline/model'

/** Row height in px (our choice). */
export const TIMELINE_ROW_H = 32
const HEADER_ROW_H = 24
const HEADER_H = HEADER_ROW_H * 2
/** The table's widths in rem (our choice). */
const TITLE_REM = 14
const COL_REM = 9
/** Rows drawn beyond the scrolled window, each side. */
const OVERSCAN = 10
/** A press that moves less than this (px) is a click. */
const CLICK_SLOP = 3

/** Our strings. */
export const TIMELINE_TEXT = {
  today: 'Today',
  noDate: (n: number) => `No date (${n})`,
  outOfRange: (n: number) => `Out of range (${n})`,
  outOfRangeHint: 'Too far from the other dates to draw. Drag it onto the timeline to give it a new start date.',
  zoom: { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' } as Record<TimelineZoom, string>,
  zoomGroup: 'Zoom',
  conflict: 'Changed elsewhere. Reloaded.',
  failed: 'Could not save.',
  addDependency: (title: string) => `Add a dependency from ${title || 'Untitled'}`,
}

const ZOOMS: TimelineZoom[] = ['day', 'week', 'month', 'quarter', 'year']

/** A row's value for a property, with the summary as a fallback for the system kinds (as the table). */
function cellValue(def: PropertyDef, row: Row): unknown {
  if (def.key in row.values) return row.values[def.key]
  switch (def.type) {
    case 'entity_createdAt':
      return row.summary.createdAt
    case 'entity_lastUpdated':
      return row.summary.lastUpdated
    case 'entity_tags':
      return row.summary.tags
    case 'entity_type':
      return row.summary.type
    case 'entity_collections':
      return row.summary.collections ?? []
    default:
      return null
  }
}

const openObject = (path: string) => useTabs.getState().open({ kind: 'object', path })
const noop = () => {}

interface DragState {
  path: string
  mode: DragMode
  x0: number
  delta: number
  moved: boolean
}

interface LinkState {
  from: string
  x: number
  y: number
  target: string | null
}

interface TrayDrag {
  path: string
  x0: number
  y0: number
  x: number
  y: number
  moved: boolean
}

function saveConfig(state: ViewState, onState: (s: ViewState) => void, config: TimelineViewConfig, patch: Partial<TimelineViewConfig>) {
  onState({ ...state, viewDefinition: { ...state.viewDefinition, timelineConfig: { ...config, ...patch } } })
}

const without = <T,>(rec: Record<string, T>, key: string): Record<string, T> => {
  const next = { ...rec }
  delete next[key]
  return next
}

export function TimelineLayout(props: LayoutProps) {
  const { flat, state, onState, viewTypes, types, ctx, onOpen, onWritten } = props
  const patchRowRef = useRef(props.patchRow)
  patchRowRef.current = props.patchRow
  const config = useMemo(() => timelineConfig(state.viewDefinition), [state.viewDefinition])
  const startKey = useMemo(() => resolveStart(config, viewTypes), [config, viewTypes])
  const endKey = useMemo(() => resolveEnd(config, viewTypes, startKey), [config, viewTypes, startKey])
  const hasKey = (key: string | undefined): key is string => !!key && viewTypes.some((t) => t.propertyDefinitions.some((d) => d.key === key))
  const parentKey = state.viewDefinition.subItemsConfig?.parentPropertyId
  const subKey = hasKey(parentKey) ? parentKey : null
  const depKey = state.viewDefinition.dependenciesConfig?.blockedByPropertyId
  const blockedKey = config.showDependencies && hasKey(depKey) ? depKey : null

  const writes = useMemo(() => createRowWrites(), [])
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Removes the document listeners of the bar, link or tray drag under way (as TableLayout.endResize). */
  const endDrag = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
      // Unmounted mid-drag, the drag stops and its release writes nothing.
      endDrag.current?.()
    },
    [],
  )
  /** Starts a drag's document listeners; `detach` ends them and makes a later `up` a no-op. */
  const attachDrag = (move: (ev: MouseEvent) => void, up: (ev: MouseEvent) => void): void => {
    let ended = false
    const detach = () => {
      if (ended) return false
      ended = true
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', onUp)
      if (endDrag.current === detach) endDrag.current = null
      return true
    }
    const onUp = (ev: MouseEvent) => {
      if (!detach()) return
      up(ev)
    }
    endDrag.current?.()
    endDrag.current = detach
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', onUp)
  }
  const say = useCallback((text: string) => {
    setNotice(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])

  // Where a dropped bar sits until its row comes back from the server (only while the row is
  // still at the version it was dropped from).
  const [pending, setPending] = useState<Record<string, { version: string; span: BarSpan }>>({})
  const spans = useMemo(() => {
    const dayOf = dayReader()
    const out = new Map<string, BarSpan>()
    for (const r of flat) {
      const s = barSpan(r, startKey, endKey, dayOf)
      if (s) out.set(r.summary.path, s)
    }
    return out
  }, [flat, startKey, endKey])
  const spanOf = useCallback(
    (r: Row): BarSpan | null => {
      const p = pending[r.summary.path]
      return p && p.version === r.version ? p.span : (spans.get(r.summary.path) ?? null)
    },
    [pending, spans],
  )
  const today = dayNum(todayYmd())
  // The days the axis may cover (around the bars' middle), so a typo date (year 0202 or 20260)
  // can't make it millions of px wide; a bar outside it waits in the "Out of range" tray.
  const range = useMemo(() => {
    const all: BarSpan[] = []
    for (const r of flat) {
      const sp = spanOf(r)
      if (sp) all.push(sp)
    }
    return axisWindow(all, today)
  }, [flat, spanOf, today])
  const { dated, undated, outliers } = useMemo(() => {
    const out = { dated: [] as Row[], undated: [] as Row[], outliers: [] as Row[] }
    for (const r of flat) {
      const sp = spanOf(r)
      if (!sp) out.undated.push(r)
      else if (inWindow(sp, range)) out.dated.push(r)
      else out.outliers.push(r)
    }
    return out
  }, [flat, spanOf, range])
  const axis = useMemo(() => buildAxis(config.zoom, dated.map((r) => spanOf(r) as BarSpan), today, range), [config.zoom, dated, spanOf, today, range])

  // Nesting (sub-items) and the rows on screen.
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = useCallback((path: string) => {
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])
  const tree: TreeRow[] = useMemo(
    () => (subKey ? flattenTree(buildRowTree(dated, subKey)) : dated.map((row) => ({ row, depth: 0, hasChildren: false }))),
    [dated, subKey],
  )
  const shown = useMemo(() => visibleTreeRows(tree, closed), [tree, closed])
  const rowIndex = useMemo(() => new Map(shown.map((t, i) => [t.row.summary.path, i])), [shown])
  const byPath = useMemo(() => new Map(flat.map((r) => [r.summary.path, r])), [flat])

  // The table on the left.
  const showTable = config.showTable
  const tableDefs = useMemo(() => {
    const out: PropertyDef[] = []
    if (!showTable) return out
    const all = viewTypes.flatMap((t) => t.propertyDefinitions)
    const title = all.find((d) => d.type === 'entity_title')
    if (title) out.push(title)
    for (const key of config.tableColumns) {
      const def = all.find((d) => d.key === key)
      if (def && def.type !== 'entity_title' && !out.includes(def)) out.push(def)
    }
    return out
  }, [showTable, config.tableColumns, viewTypes])
  const columns: TableColumn[] = useMemo(
    () => tableDefs.map((d) => ({ id: d.key, type: d.type, isHidden: false, wrapContent: false, colWidth: d.type === 'entity_title' ? TITLE_REM : COL_REM })),
    [tableDefs],
  )
  const sidebarRem = showTable ? Math.max(TITLE_REM, columns.reduce((n, c) => n + c.colWidth, 0)) : 0
  const defsByKey = useMemo(() => Object.fromEntries(tableDefs.map((d) => [d.key, d])), [tableDefs])
  const widths = useMemo(() => Object.fromEntries(columns.map((c) => [c.id, c.colWidth])), [columns])

  // The scrolled window.
  const scroller = useRef<HTMLDivElement>(null)
  const sidebar = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLDivElement>(null)
  const [win, setWin] = useState({ top: 0, height: 800 })
  const measure = useCallback(() => {
    const el = scroller.current
    if (el) setWin((w) => (w.top === el.scrollTop && w.height === (el.clientHeight || 800) ? w : { top: el.scrollTop, height: el.clientHeight || 800 }))
  }, [])
  const onScroll = measure
  // The window's height is measured when the layout opens and whenever the scroller is resized.
  useEffect(() => {
    measure()
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])
  const first = Math.max(0, Math.floor((win.top - HEADER_H) / TIMELINE_ROW_H) - OVERSCAN)
  const last = Math.min(shown.length, Math.ceil((win.top + win.height) / TIMELINE_ROW_H) + OVERSCAN)

  const scrollToDay = useCallback(
    (day: number) => {
      const el = scroller.current
      if (!el) return
      const side = sidebar.current?.offsetWidth ?? 0
      const x = (day - axis.start) * axis.px
      const room = Math.max(0, (el.clientWidth || 0) - side)
      el.scrollLeft = Math.max(0, x - room / 3)
    },
    [axis.start, axis.px],
  )
  // Today comes into view when the layout opens and when the zoom changes (our choice).
  useEffect(() => {
    scrollToDay(today)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per zoom, not on every axis change
  }, [config.zoom])

  // -- writes ---------------------------------------------------------------------------------

  const reload = useCallback(
    async (rows: Row[]) => {
      if (rows.length === 0) return
      try {
        const fresh = await api.rows({ paths: rows.map((r) => r.summary.path) })
        for (const f of fresh) {
          writes.seen(
            f,
            rows.find((r) => r.summary.path === f.summary.path),
          )
          patchRowRef.current?.(f.summary.path, f)
        }
      } catch (err) {
        console.warn('Could not reload rows:', err)
      }
    },
    [writes],
  )

  const fail = useCallback(
    async (row: Row, err: unknown) => {
      if (err instanceof ConflictError) {
        await reload([row])
        say(TIMELINE_TEXT.conflict)
      } else say(err instanceof Error && err.message ? err.message : TIMELINE_TEXT.failed)
    },
    [reload, say],
  )

  /** Write a bar's new dates (`mode` and `delta` from the drag), once. */
  const writeDrag = async (row: Row, mode: DragMode, delta: number) => {
    const from = spanOf(row)
    if (!from || delta === 0) return
    const to = dragSpan(from, mode, delta)
    if (Object.keys(dragUpdates(row, startKey, endKey, from, to)).length === 0) return
    const path = row.summary.path
    setPending((p) => ({ ...p, [path]: { version: row.version, span: to } }))
    try {
      // Writes to one row run in turn, each from the newest version known (the rows may lag behind).
      const result = await writes.run(row, (version, cur) => {
        const base = barSpan(cur, startKey, endKey) ?? from
        return api.updateProperties(path, dragUpdates(cur, startKey, endKey, base, dragSpan(base, mode, delta)), version)
      })
      await reload([row])
      onWritten?.(row, result)
    } catch (err) {
      setPending((p) => without(p, path))
      await fail(row, err)
    }
  }

  /** Give an undated row the dropped day as its start. */
  const writeStart = async (row: Row, day: number) => {
    const path = row.summary.path
    setPending((p) => ({ ...p, [path]: { version: row.version, span: { start: day, end: day } } }))
    try {
      const result = await writes.run(row, (version) => api.updateProperties(path, { [startKey]: { start: dayText(day), resolution: 'day' } }, version))
      await reload([row])
      onWritten?.(row, result)
    } catch (err) {
      setPending((p) => without(p, path))
      await fail(row, err)
    }
  }

  /** `target` becomes blocked by `source` (syncing fills the source's other side). */
  const writeDependency = async (source: Row, target: Row) => {
    if (!blockedKey || !addBlocker(target, source, blockedKey)) return
    try {
      const result: UpdateResult = await writes.run(target, (version, cur) =>
        api.updateProperties(target.summary.path, { [blockedKey]: addBlocker(cur, source, blockedKey) ?? relationRefs(cur, blockedKey) }, version),
      )
      const synced = (result.synced ?? []).map((p) => byPath.get(p)).filter((r): r is Row => !!r && r !== target)
      await reload([target, ...synced])
      onWritten?.(target, result)
    } catch (err) {
      await fail(target, err)
    }
  }

  // The release handlers outlive a render: they read the newest rows, axis and writers.
  const latest = useRef({ byPath, axis, writeDependency, writeStart })
  latest.current = { byPath, axis, writeDependency, writeStart }

  // -- pointer handling (mouse events; the write happens on release) --------------------------

  const [drag, setDrag] = useState<DragState | null>(null)
  const [link, setLink] = useState<LinkState | null>(null)
  const [trayDrag, setTrayDrag] = useState<TrayDrag | null>(null)
  const justDragged = useRef(false)
  const markDragged = () => {
    justDragged.current = true
    setTimeout(() => (justDragged.current = false), 0)
  }

  const startBarDrag = (e: ReactMouseEvent, row: Row, mode: DragMode) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    let cur: DragState = { path: row.summary.path, mode, x0: e.clientX, delta: 0, moved: false }
    setDrag(cur)
    const px = axis.px
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - cur.x0
      cur = { ...cur, delta: Math.round(dx / px), moved: cur.moved || Math.abs(dx) >= CLICK_SLOP }
      setDrag(cur)
    }
    const up = () => {
      setDrag(null)
      if (!cur.moved) return
      markDragged()
      if (cur.delta !== 0) void writeDrag(row, mode, cur.delta)
    }
    attachDrag(move, up)
  }

  const overlayPoint = (clientX: number, clientY: number) => {
    const r = overlay.current?.getBoundingClientRect()
    if (!r) return null
    return { x: clientX - r.left, y: clientY - r.top, inside: r.width > 0 && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom }
  }

  /**
   * Whether a point is over the part of the axis on screen: inside the scroller's visible box,
   * right of the sticky table and below the sticky header (the overlay's own box runs on under
   * them and past the scroller's edges).
   */
  const onVisibleAxis = (clientX: number, clientY: number): boolean => {
    const box = scroller.current?.getBoundingClientRect()
    if (!box || box.width <= 0 || box.height <= 0) return false
    if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return false
    const side = sidebar.current?.getBoundingClientRect()
    if (side && side.width > 0 && clientX < side.right) return false
    const head = header.current?.getBoundingClientRect()
    if (head && head.height > 0 && clientY < head.bottom) return false
    return true
  }

  const startLink = (e: ReactMouseEvent, row: Row) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const p = overlayPoint(e.clientX, e.clientY)
    let cur: LinkState = { from: row.summary.path, x: p?.x ?? 0, y: p?.y ?? 0, target: null }
    setLink(cur)
    const move = (ev: MouseEvent) => {
      const q = overlayPoint(ev.clientX, ev.clientY)
      cur = { ...cur, x: q?.x ?? cur.x, y: q?.y ?? cur.y }
      setLink((l) => (l ? { ...l, x: cur.x, y: cur.y } : l))
    }
    const up = () => {
      const target = linkTarget.current ? latest.current.byPath.get(linkTarget.current) : undefined
      linkTarget.current = null
      setLink(null)
      if (target && target.summary.path !== row.summary.path) void latest.current.writeDependency(row, target)
    }
    attachDrag(move, up)
  }
  // The bar under the pointer while linking (set by the bars' mouseenter).
  const linkTarget = useRef<string | null>(null)
  const hoverBar = (path: string | null) => {
    if (!link) return
    linkTarget.current = path
    setLink((l) => (l ? { ...l, target: path } : l))
  }

  const startTrayDrag = (e: ReactMouseEvent, row: Row) => {
    if (e.button !== 0) return
    e.preventDefault()
    let cur: TrayDrag = { path: row.summary.path, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false }
    setTrayDrag(cur)
    const move = (ev: MouseEvent) => {
      cur = { ...cur, x: ev.clientX, y: ev.clientY, moved: cur.moved || Math.abs(ev.clientX - cur.x0) + Math.abs(ev.clientY - cur.y0) >= CLICK_SLOP }
      setTrayDrag(cur)
    }
    const up = (ev: MouseEvent) => {
      setTrayDrag(null)
      if (!cur.moved) return
      markDragged()
      const p = overlayPoint(ev.clientX, ev.clientY)
      if (p?.inside && onVisibleAxis(ev.clientX, ev.clientY)) void latest.current.writeStart(row, dayAt(latest.current.axis, p.x))
    }
    attachDrag(move, up)
  }

  const open = (row: Row, e: ReactMouseEvent) => {
    if (justDragged.current) return
    onOpen(row, e)
  }

  // -- drawing ----------------------------------------------------------------------------------

  const barGeometry = (row: Row): { left: number; width: number; span: BarSpan } | null => {
    const base = spanOf(row)
    if (!base) return null
    const span = drag && drag.path === row.summary.path ? dragSpan(base, drag.mode, drag.delta) : base
    return { left: (span.start - axis.start) * axis.px, width: Math.max(4, (span.end - span.start + 1) * axis.px), span }
  }

  const arrows = useMemo(() => {
    if (!blockedKey) return []
    const out: { key: string; from: string; to: string; d: string }[] = []
    shown.forEach((t, i) => {
      const toSpan = spanOf(t.row)
      if (!toSpan) return
      for (const p of linkedPaths(t.row, blockedKey)) {
        const j = rowIndex.get(p)
        const fromSpan = j === undefined ? null : spanOf(shown[j].row)
        if (j === undefined || !fromSpan || p === t.row.summary.path) continue
        const x1 = (fromSpan.end + 1 - axis.start) * axis.px
        const y1 = j * TIMELINE_ROW_H + TIMELINE_ROW_H / 2
        const x2 = (toSpan.start - axis.start) * axis.px
        const y2 = i * TIMELINE_ROW_H + TIMELINE_ROW_H / 2
        const gap = 8
        const d =
          x2 - x1 >= gap * 2
            ? `M${x1},${y1} H${x1 + gap} V${y2} H${x2}`
            : `M${x1},${y1} H${x1 + gap} V${(y1 + y2) / 2} H${x2 - gap} V${y2} H${x2}`
        out.push({ key: `${p}>${t.row.summary.path}`, from: p, to: t.row.summary.path, d })
      }
    })
    return out
  }, [blockedKey, shown, rowIndex, spanOf, axis])

  const bodyH = Math.max(shown.length, 3) * TIMELINE_ROW_H
  const linkFrom = link ? byPath.get(link.from) : undefined
  const linkFromGeo = linkFrom ? barGeometry(linkFrom) : null
  const linkFromIdx = link ? rowIndex.get(link.from) : undefined
  const trayRow = trayDrag ? byPath.get(trayDrag.path) : undefined

  const sidebarCells = (t: TreeRow): ReactNode =>
    columns.map((c) => {
      const def = defsByKey[c.id]
      if (!def) return null
      if (def.type === 'entity_title') {
        const isClosed = closed.has(t.row.summary.path)
        return (
          <div key={c.id} role="cell" data-col={c.id} style={{ width: `${c.colWidth}rem` }} className="flex h-full shrink-0 items-center gap-1 border-r border-line px-1.5">
            {subKey && (
              <span className="flex shrink-0 items-center" style={{ paddingLeft: `${t.depth * 1.25}rem` }}>
                {t.hasChildren ? (
                  <button
                    type="button"
                    aria-label={`${isClosed ? 'Show' : 'Hide'} sub-items of ${t.row.summary.title || 'Untitled'}`}
                    aria-expanded={!isClosed}
                    onClick={() => toggle(t.row.summary.path)}
                    className="flex h-5 w-5 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
                  >
                    <Icon name={isClosed ? 'ph-caret-right' : 'ph-caret-down'} size={12} />
                  </button>
                ) : (
                  <span aria-hidden className="h-5 w-5" />
                )}
              </span>
            )}
            <button type="button" onClick={(e) => open(t.row, e)} className="min-w-0 flex-1 truncate text-left text-[14px] text-fg hover:underline">
              {t.row.summary.title || 'Untitled'}
            </button>
          </div>
        )
      }
      const own = types.find((x) => x.id === t.row.summary.type)?.propertyDefinitions.find((d) => d.key === def.key) ?? def
      const Cell = cellForDef(own)
      return (
        <div key={c.id} role="cell" data-col={c.id} style={{ width: `${c.colWidth}rem` }} className="flex h-full shrink-0 items-center overflow-hidden whitespace-nowrap border-r border-line px-1.5">
          {Cell && (
            <div className="min-w-0 flex-1">
              <Cell def={own} value={cellValue(own, t.row)} readOnly density="table" inTable onChange={noop} typeId={t.row.summary.type} onOpenObject={openObject} />
            </div>
          )}
        </div>
      )
    })

  const renderRow = (t: TreeRow) => {
    const row = t.row
    const geo = barGeometry(row)
    const movable = canWriteDate(row, startKey, types) && (!endKey || canWriteDate(row, endKey, types))
    const linkable = !!blockedKey && !row.summary.readOnly
    const isTarget = !!link && link.target === row.summary.path && link.from !== row.summary.path
    return (
      <div
        key={row.summary.path}
        role="row"
        data-path={row.summary.path}
        data-depth={subKey ? t.depth : undefined}
        data-selected={props.isSelected?.(row.summary.path) || undefined}
        style={{ height: TIMELINE_ROW_H }}
        className="flex border-b border-line"
      >
        {showTable && (
          <div style={{ width: `${sidebarRem}rem` }} className="sticky left-0 z-[2] flex h-full shrink-0 bg-app">
            {sidebarCells(t)}
          </div>
        )}
        <div className="relative h-full shrink-0" style={{ width: axis.width }}>
          {geo && (
            <div
              data-testid="timeline-bar"
              data-path={row.summary.path}
              data-start={dayText(geo.span.start)}
              data-end={dayText(geo.span.end)}
              role="button"
              tabIndex={0}
              aria-label={row.summary.title || 'Untitled'}
              title={row.summary.title}
              onMouseDown={movable ? (e) => startBarDrag(e, row, 'move') : undefined}
              onMouseEnter={() => hoverBar(row.summary.path)}
              onMouseLeave={() => hoverBar(null)}
              onClick={(e) => open(row, e)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
                e.preventDefault()
                onOpen(row, e as unknown as ReactMouseEvent)
              }}
              style={{ left: geo.left, width: geo.width, top: 5, height: TIMELINE_ROW_H - 10 }}
              className={cn(
                'group/bar absolute flex items-center rounded-md border border-[var(--line-blue)] bg-[var(--type-blue-bg)] text-[12px] text-[var(--type-blue-fg)]',
                movable ? 'cursor-grab' : 'cursor-pointer',
                drag?.path === row.summary.path && 'cursor-grabbing opacity-80',
                isTarget && 'ring-2 ring-[var(--block-selection-border)]',
              )}
            >
              {movable && (
                <span
                  data-testid="timeline-bar-start"
                  aria-hidden
                  onMouseDown={(e) => startBarDrag(e, row, 'start')}
                  className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-md hover:bg-[var(--line-blue)]"
                />
              )}
              <span className="pointer-events-none min-w-0 flex-1 truncate px-2">{row.summary.title || 'Untitled'}</span>
              {movable && (
                <span
                  data-testid="timeline-bar-end"
                  aria-hidden
                  onMouseDown={(e) => startBarDrag(e, row, 'end')}
                  className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-md hover:bg-[var(--line-blue)]"
                />
              )}
              {linkable && (
                // Pointer only (our choice): out of the tab order and hidden from screen readers,
                // since a keyboard picker of rows would be out of proportion; "Blocked by" stays
                // editable as a property.
                <span
                  data-testid="timeline-link-handle"
                  aria-hidden
                  tabIndex={-1}
                  title={TIMELINE_TEXT.addDependency(row.summary.title)}
                  onMouseDown={(e) => startLink(e, row)}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute -right-3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 cursor-crosshair rounded-full border border-[var(--line-blue)] bg-app opacity-0 group-hover/bar:opacity-100"
                />
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const todayX = (today - axis.start) * axis.px + axis.px / 2

  return (
    <div data-testid="timeline-layout" className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => scrollToDay(today)} className="h-7 rounded-md border border-line px-2 text-[13px] hover:bg-hover">
          {TIMELINE_TEXT.today}
        </button>
        <div role="group" aria-label={TIMELINE_TEXT.zoomGroup} className="ml-auto flex items-center gap-0.5 rounded-md border border-line p-0.5">
          {ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={config.zoom === z}
              onClick={() => config.zoom !== z && saveConfig(state, onState, config, { zoom: z })}
              className="h-6 rounded px-2 text-[12px] text-fg-muted hover:bg-hover aria-pressed:bg-hover aria-pressed:text-fg"
            >
              {TIMELINE_TEXT.zoom[z]}
            </button>
          ))}
        </div>
      </div>
      {notice && (
        <div role="status" className="rounded-md bg-raised px-3 py-1.5 text-[13px] text-fg">
          {notice}
        </div>
      )}
      <div ref={scroller} data-testid="timeline-scroll" onScroll={onScroll} className="relative max-h-[70vh] overflow-auto rounded-md border border-line">
        <div className="relative" style={{ width: `calc(${sidebarRem}rem + ${axis.width}px)` }}>
          <div ref={header} className="sticky top-0 z-[3] flex border-b border-line bg-app" style={{ height: HEADER_H }}>
            {showTable && (
              <div ref={sidebar} data-testid="timeline-sidebar" style={{ width: `${sidebarRem}rem` }} className="sticky left-0 z-[4] flex h-full shrink-0 items-end bg-app">
                {columns.map((c) => (
                  <div key={c.id} role="columnheader" style={{ width: `${c.colWidth}rem` }} className="flex h-1/2 shrink-0 items-center truncate border-r border-line px-2 text-[13px] text-fg-muted">
                    {defsByKey[c.id]?.name}
                  </div>
                ))}
              </div>
            )}
            <TimeHeader axis={axis} today={today} />
          </div>
          <div className="relative" style={{ minHeight: bodyH }}>
            <div style={{ height: first * TIMELINE_ROW_H }} />
            {shown.slice(first, last).map(renderRow)}
            <div style={{ height: Math.max(0, shown.length - last) * TIMELINE_ROW_H }} />
            <div
              ref={overlay}
              data-testid="timeline-axis"
              aria-hidden
              className="pointer-events-none absolute top-0 z-[1]"
              style={{ left: `${sidebarRem}rem`, width: axis.width, height: bodyH }}
            >
              <div data-testid="timeline-today" className="absolute top-0 h-full w-px bg-[var(--accent-today)] opacity-60" style={{ left: todayX }} />
              {(arrows.length > 0 || link) && (
                <svg width={axis.width} height={bodyH} className="absolute left-0 top-0 overflow-visible text-fg-muted">
                  <defs>
                    <marker id="timeline-arrowhead" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
                    </marker>
                  </defs>
                  {arrows.map((a) => (
                    <path key={a.key} data-testid="dependency-arrow" data-from={a.from} data-to={a.to} d={a.d} fill="none" stroke="currentColor" strokeWidth={1.25} markerEnd="url(#timeline-arrowhead)" />
                  ))}
                  {link && linkFromGeo && linkFromIdx !== undefined && (
                    <line
                      data-testid="dependency-draft"
                      x1={linkFromGeo.left + linkFromGeo.width}
                      y1={linkFromIdx * TIMELINE_ROW_H + TIMELINE_ROW_H / 2}
                      x2={link.x}
                      y2={link.y}
                      stroke="var(--block-selection-border)"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  )}
                </svg>
              )}
            </div>
          </div>
          {showTable && columns.length > 0 && viewTypes[0] && (
            <div className="sticky bottom-0 z-[3] flex bg-app">
              <div className="sticky left-0 z-[4] shrink-0 bg-app" style={{ width: `${sidebarRem}rem` }}>
                <CalcFooter columns={columns} defs={defsByKey} rows={flat} state={state} onState={onState} ctx={ctx} typeId={viewTypes[0].id} widths={widths} sticky={{}} />
              </div>
              <div className="shrink-0 border-t border-line" style={{ width: axis.width }} />
            </div>
          )}
        </div>
      </div>
      {(undated.length > 0 || outliers.length > 0) && (
        <div className="flex flex-col gap-1">
          {undated.length > 0 && <Tray label={TIMELINE_TEXT.noDate(undated.length)} rows={undated} canDrag={(r) => canWriteDate(r, startKey, types)} onDown={startTrayDrag} onOpen={open} />}
          {outliers.length > 0 && (
            <Tray
              label={TIMELINE_TEXT.outOfRange(outliers.length)}
              rows={outliers}
              detail={(r) => {
                const sp = spanOf(r)
                return sp ? dayText(sp.start) : ''
              }}
              hint={TIMELINE_TEXT.outOfRangeHint}
              canDrag={(r) => canWriteDate(r, startKey, types)}
              onDown={startTrayDrag}
              onOpen={open}
            />
          )}
        </div>
      )}
      {trayDrag?.moved && trayRow && (
        <div
          data-testid="timeline-tray-ghost"
          className="pointer-events-none fixed z-50 rounded-md border border-[var(--line-blue)] bg-[var(--type-blue-bg)] px-2 py-0.5 text-[12px] text-[var(--type-blue-fg)]"
          style={{ left: trayDrag.x + 8, top: trayDrag.y + 8 }}
        >
          {trayRow.summary.title || 'Untitled'}
        </div>
      )}
    </div>
  )
}

/** The two header rows of the time axis, with today's column marked. */
function TimeHeader({ axis, today }: { axis: Axis; today: number }) {
  return (
    <div data-testid="timeline-header" className="relative h-full shrink-0" style={{ width: axis.width }}>
      {axis.top.map((c) => (
        <div
          key={c.key}
          data-testid="timeline-header-top"
          className="absolute top-0 truncate border-b border-l border-line px-1.5 text-[12px] leading-6 text-fg"
          style={{ left: c.left, width: c.width, height: HEADER_ROW_H }}
        >
          {c.label}
        </div>
      ))}
      {axis.bottom.map((c) => (
        <div
          key={c.key}
          data-testid="timeline-header-bottom"
          className="absolute truncate border-l border-line text-center text-[11px] leading-6 text-fg-muted"
          style={{ left: c.left, width: c.width, top: HEADER_ROW_H, height: HEADER_ROW_H }}
        >
          {c.width >= 14 ? c.label : ''}
        </div>
      ))}
      <div className="absolute bottom-0 h-1 bg-[var(--accent-today)]" style={{ left: (today - axis.start) * axis.px, width: Math.max(2, axis.px) }} />
    </div>
  )
}

/** A tray of rows that have no bar: "No date", and "Out of range" (a date too far from the rest). */
function Tray({
  label,
  rows,
  detail,
  hint,
  canDrag,
  onDown,
  onOpen,
}: {
  label: string
  rows: Row[]
  detail?(row: Row): string
  hint?: string
  canDrag(row: Row): boolean
  onDown(e: ReactMouseEvent, row: Row): void
  onOpen(row: Row, e: ReactMouseEvent): void
}) {
  // Closed until asked for (our choice).
  const [open, setOpen] = useState(false)
  return (
    <div data-testid="timeline-tray" className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 items-center gap-1 self-start rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Icon name={open ? 'ph-caret-down' : 'ph-caret-right'} size={12} />
        {label}
      </button>
      {open && (
        <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto px-2">
          {rows.map((r) => {
            const draggable = canDrag(r)
            const extra = detail?.(r)
            return (
              <button
                key={r.summary.path}
                type="button"
                data-testid="timeline-tray-item"
                data-path={r.summary.path}
                title={hint}
                onMouseDown={draggable ? (e) => onDown(e, r) : undefined}
                onClick={(e) => onOpen(r, e)}
                className={cn('h-7 max-w-[16rem] truncate rounded-md border border-line px-2 text-[13px] text-fg hover:bg-hover', draggable && 'cursor-grab')}
              >
                {r.summary.title || 'Untitled'}
                {extra && <span className="ml-1.5 text-fg-muted">{extra}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// -- settings ----------------------------------------------------------------------------------

export interface TimelineSettingsProps {
  types: TypeDef[]
  state: ViewState
  onState(next: ViewState): void
}

/** Our strings. */
export const TIMELINE_SETTINGS_TEXT = {
  start: 'Start date',
  end: 'End date',
  sameAsStart: 'From the start date',
  zoom: 'Zoom',
  showTable: 'Show table',
  columns: 'Table columns',
  showDependencies: 'Show dependencies',
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange(next: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn('flex h-4 w-7 items-center rounded-full p-0.5 transition-colors', on ? 'justify-end bg-[var(--line-blue)]' : 'justify-start bg-hover')}>
        <span className="h-3 w-3 rounded-full bg-app" />
      </span>
    </button>
  )
}

/** The value of the end menu's "From the start date" row. */
const SAME_AS_START = '__start__'

/** The layout's page in "Customize view". */
export function TimelineSettings({ types, state, onState }: TimelineSettingsProps) {
  const config = timelineConfig(state.viewDefinition)
  const save = (patch: Partial<TimelineViewConfig>) => saveConfig(state, onState, config, patch)
  const dates = dateChoices(types)
  const start = resolveStart(config, types)
  const end = resolveEnd(config, types, start)
  const deps = !!state.viewDefinition.dependenciesConfig
  // M28: not the computed other sides (`counterpartOf`): the table builds its columns from the
  // stored definitions only.
  const columnChoices = propertyChoices(types).filter(
    (c) => c.kind !== 'entity_title' && c.kind !== 'blocks' && c.kind !== 'entity_backlinks' && !c.def.options?.counterpartOf,
  )
  const row = (label: string, control: ReactNode) => (
    <div className="flex items-center gap-2 px-2">
      <span className="w-24 shrink-0 text-[13px] text-fg-muted">{label}</span>
      {control}
    </div>
  )
  return (
    <div data-testid="timeline-settings" className="flex flex-col gap-1 py-1">
      {row(
        TIMELINE_SETTINGS_TEXT.start,
        <MenuSelect
          label={TIMELINE_SETTINGS_TEXT.start}
          value={start}
          options={propertyOptions(dates)}
          onChange={(v) => save({ startProperty: v, endProperty: config.endProperty === v ? null : config.endProperty })}
          className="flex-1"
        />,
      )}
      {row(
        TIMELINE_SETTINGS_TEXT.end,
        <MenuSelect
          label={TIMELINE_SETTINGS_TEXT.end}
          value={end ?? SAME_AS_START}
          options={[{ value: SAME_AS_START, label: TIMELINE_SETTINGS_TEXT.sameAsStart }, ...propertyOptions(dates.filter((c) => c.key !== start))]}
          onChange={(v) => save({ endProperty: v === SAME_AS_START ? null : v })}
          className="flex-1"
        />,
      )}
      {row(
        TIMELINE_SETTINGS_TEXT.zoom,
        <MenuSelect
          label={TIMELINE_SETTINGS_TEXT.zoom}
          value={config.zoom}
          options={ZOOMS.map((z) => ({ value: z, label: TIMELINE_TEXT.zoom[z] }))}
          onChange={(v) => save({ zoom: v as TimelineZoom })}
          className="flex-1"
        />,
      )}
      <Toggle label={TIMELINE_SETTINGS_TEXT.showTable} on={config.showTable} onChange={(v) => save({ showTable: v })} />
      {deps && <Toggle label={TIMELINE_SETTINGS_TEXT.showDependencies} on={config.showDependencies} onChange={(v) => save({ showDependencies: v })} />}
      {config.showTable && (
        <>
          <div className="px-2 pt-1 text-[12px] text-fg-muted">{TIMELINE_SETTINGS_TEXT.columns}</div>
          {columnChoices.map((c) => {
            const on = config.tableColumns.includes(c.key)
            return (
              <button
                key={c.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => save({ tableColumns: on ? config.tableColumns.filter((k) => k !== c.key) : [...config.tableColumns, c.key] })}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <Icon name={on ? 'ph-eye' : 'ph-eye-slash'} size={14} />
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
