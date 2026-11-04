// The table layout: one structure, resizable and reorderable columns, a pinned (sticky) prefix,
// hidden and wrapped columns, a calculation footer and inline cell editing with the M2 cells.
// Rows are memoized on their row, columns, widths and selection, so one cell edit re-renders one row.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { api, ConflictError } from '@/api/client'
import type { PropertyDef, Row, TableColumn, TableViewConfig, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cellValue } from '@/object/PropertyPanel'
import { plainText, textStats, TEXT_STATS_TEXT } from '@/object/textStats'
import { useTypeEditor } from '@/object/useTypeEditor'
import { useTabs } from '@/nav/tabs'
import { cellForDef } from '@/properties/cellFor'
import { kindIcon } from '@/properties/kinds'
import { PropertySettings } from '@/properties/PropertySettings'
import { cn } from '@/lib/utils'
import type { LayoutProps } from '../DataView'
import { createRowWrites } from '../rowWrites'
import { CalcFooter } from './CalcFooter'
import { ColumnMenu } from './ColumnMenu'
import {
  isWrapped,
  leftOffsets,
  moveColumn,
  normalizeTableConfig,
  setColWidth,
  tableDefs,
  visibleColumns,
} from './tableConfig'

/** Rows are at least this tall in a table, in px. */
export const TABLE_ROW_HEIGHT = 36
const REM_PX = 16

export type TableLayoutProps = LayoutProps

/** A row's value for a property: the decoded `values`, with the summary as a fallback for system kinds. */
function valueFor(def: PropertyDef, row: Row): unknown {
  if (def.key in row.values) return row.values[def.key]
  switch (def.type) {
    case 'entity_type':
      return row.summary.type
    case 'entity_createdAt':
      return row.summary.createdAt
    case 'entity_lastUpdated':
      return row.summary.lastUpdated
    case 'entity_tags':
      return row.summary.tags
    case 'entity_collections':
      return row.summary.collections ?? []
    default:
      return null
  }
}

function HeaderCell({
  col,
  def,
  width,
  sticky,
  menu,
  onResizeStart,
  sortable,
}: {
  col: TableColumn
  def: PropertyDef
  width: number
  sticky?: number
  menu(close: () => void): ReactNode
  onResizeStart(e: ReactMouseEvent, col: TableColumn): void
  sortable: boolean
}) {
  const [open, setOpen] = useState(false)
  const s = useSortable({ id: col.id, disabled: !sortable })
  const style: CSSProperties = {
    width: `${width}rem`,
    transform: s.transform ? `translate3d(${Math.round(s.transform.x)}px, 0, 0)` : undefined,
    transition: s.transition,
    ...(sticky !== undefined ? { position: 'sticky', left: `${sticky}rem`, zIndex: 2 } : s.isDragging ? { zIndex: 3 } : {}),
  }
  return (
    <div
      ref={s.setNodeRef}
      {...s.attributes}
      {...s.listeners}
      role="columnheader"
      data-col={col.id}
      style={style}
      className="relative flex h-8 shrink-0 items-center border-r border-line bg-app"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Icon name={typeof def.icon === 'string' ? def.icon : kindIcon(def.type)} size={13} />
            <span className="truncate">{def.name}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto border-line bg-raised p-0 text-fg">
          {menu(() => setOpen(false))}
        </PopoverContent>
      </Popover>
      <span
        role="separator"
        aria-label={`Resize ${def.name}`}
        aria-orientation="vertical"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => onResizeStart(e, col)}
        className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-line"
      />
    </div>
  )
}

/** Our string: each row's title input is named by its row ("Title of Alpha"). */
export const titleLabel = (title: string) => `Title of ${title || 'Untitled'}`

function TitleCell({ row, onRename, onOpen }: { row: Row; onRename(row: Row, title: string): void; onOpen(e: ReactMouseEvent): void }) {
  const [text, setText] = useState(row.summary.title)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(row.summary.title)
  }, [row.summary.title])
  const commit = () => {
    const next = text.trim()
    if (!next || next === row.summary.title) {
      setText(row.summary.title)
      return
    }
    onRename(row, next)
  }
  return (
    <div className="group/title flex w-full min-w-0 items-center gap-1">
      <input
        aria-label={titleLabel(row.summary.title)}
        value={text}
        readOnly={row.summary.readOnly}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false
          if (!row.summary.readOnly) commit()
        }}
        onKeyDown={(e) => {
          // As every other cell (TextCell): Enter and Escape end the edit, which commits; an
          // empty title still reverts. Fields save as you type: no edit to cancel.
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none"
      />
      <button
        type="button"
        aria-label="Open"
        title="Open"
        onClick={onOpen}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover/title:opacity-100"
      >
        <Icon name="ph-arrow-square-out" size={14} />
      </button>
    </div>
  )
}

const openObject = (path: string) => useTabs.getState().open({ kind: 'object', path })

/** The row-number column at the left, in rem (our choice). */
export const ROW_NUMBER_WIDTH = 2.5

/** "N words" (singular and plural). */
export const wordsLabel = (n: number) => `${n.toLocaleString()} ${n === 1 ? TEXT_STATS_TEXT.word[0] : TEXT_STATS_TEXT.word[1]}`

/**
 * A content (`blocks`) column: an "N words" chip and an expand icon that opens the object. The type's first content property is the body.
 */
function ContentCell({ words, onExpand }: { words: number; onExpand(e: ReactMouseEvent): void }) {
  return (
    <div className="group/content flex min-w-0 flex-1 items-center gap-1">
      <span className="inline-flex shrink-0 items-center rounded-md bg-hover px-1.5 text-[12px] text-fg-muted">{wordsLabel(words)}</span>
      <button
        type="button"
        aria-label="Expand"
        title="Expand"
        onClick={onExpand}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover/content:opacity-100"
      >
        <Icon name="ph-arrows-out-simple" size={14} />
      </button>
    </div>
  )
}

/** A content property's words: the body's (the row's `words`) for the main one, else its own Markdown's. */
function contentWords(def: PropertyDef, row: Row, mainContent: string | undefined): number {
  if (def.key === mainContent) return row.words ?? 0
  const v = row.values[def.key]
  return typeof v === 'string' && v ? textStats(plainText(v)).words : 0
}

interface TableRowProps {
  row: Row
  /** 1-based, within the row's group. */
  index: number
  /** The key of the type's first content property (the body), if it has one. */
  mainContent: string | undefined
  /** Whether the row-number column is sticky (some columns are pinned). */
  pinned: boolean
  columns: TableColumn[]
  defs: Record<string, PropertyDef>
  config: TableViewConfig
  widths: Record<string, number>
  sticky: Record<string, number>
  selected: boolean
  canEditType: boolean
  onOpen(row: Row, e: ReactMouseEvent): void
  rename(row: Row, title: string): void
  commit(row: Row, def: PropertyDef, next: unknown): Promise<boolean>
  onDefChange(next: PropertyDef): Promise<unknown>
  openSettings(id: string): void
}

/** One row of cells; re-renders only when its row, the columns, their widths or its selection change. */
const TableRow = memo(function TableRow({ row, index, mainContent, pinned, columns, defs, config, widths, sticky, selected, canEditType, onOpen, rename, commit, onDefChange, openSettings }: TableRowProps) {
  const cellStyle = (c: TableColumn): CSSProperties => ({
    width: `${widths[c.id] ?? c.colWidth}rem`,
    ...(sticky[c.id] !== undefined ? { position: 'sticky', left: `${sticky[c.id]}rem`, zIndex: 1 } : {}),
  })
  return (
    <div
      role="row"
      data-path={row.summary.path}
      data-selected={selected || undefined}
      style={{ minHeight: TABLE_ROW_HEIGHT }}
      className={cn('flex border-b border-line hover:bg-hover/40', selected && 'bg-[var(--block-selection-bg)]')}
    >
      <div
        role="rowheader"
        style={{ width: `${ROW_NUMBER_WIDTH}rem`, ...(pinned ? { position: 'sticky', left: 0, zIndex: 1 } : {}) }}
        className="flex shrink-0 items-center justify-end border-r border-line bg-app px-2 text-[12px] tabular-nums text-fg-muted"
      >
        {index}
      </div>
      {columns.map((c) => {
        const def = defs[c.id]
        const wrapped = isWrapped(config, c.id)
        const Cell = def ? cellForDef(def) : null
        return (
          <div
            key={c.id}
            role="cell"
            data-col={c.id}
            data-wrap={wrapped ? 'wrap' : 'nowrap'}
            style={{ ...cellStyle(c), minHeight: TABLE_ROW_HEIGHT }}
            className={cn(
              'flex shrink-0 items-center border-r border-line bg-app px-1.5 py-1.5',
              wrapped ? 'whitespace-normal break-words' : 'overflow-hidden whitespace-nowrap',
              !wrapped && 'h-9',
            )}
          >
            {def?.type === 'entity_title' ? (
              <TitleCell row={row} onRename={rename} onOpen={(e) => onOpen(row, e)} />
            ) : def?.type === 'blocks' ? (
              <ContentCell words={contentWords(def, row, mainContent)} onExpand={(e) => onOpen(row, e)} />
            ) : def && Cell ? (
              <div className="min-w-0 flex-1">
                <Cell
                  def={def}
                  value={valueFor(def, row)}
                  readOnly={row.summary.readOnly}
                  density={wrapped ? 'panel' : 'table'}
                  inTable
                  onChange={(next: unknown) => commit(row, def, next)}
                  onDefChange={onDefChange}
                  typeId={row.summary.type}
                  onOpenObject={openObject}
                  onOpenSettings={canEditType ? () => openSettings(def.id) : undefined}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
})

export function TableLayout(props: TableLayoutProps) {
  const { groups, grouped, state, onState, viewTypes, ctx, header, closed, onOpen, flat } = props
  const type: TypeDef | undefined = viewTypes.length === 1 ? viewTypes[0] : undefined
  const typeEditor = useTypeEditor(type?.id)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [live, setLive] = useState<{ id: string; rem: number } | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writes = useMemo(() => createRowWrites(), [])
  // The owner's `patchRow` may be a new function per render: the row callbacks read the latest one.
  const patchRowRef = useRef(props.patchRow)
  patchRowRef.current = props.patchRow
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    },
    [],
  )
  const say = useCallback((text: string) => {
    setNotice(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])

  const stored = type ? state.viewDefinition.tableConfigs?.[type.id] : undefined
  const config = useMemo(() => (type ? normalizeTableConfig(type, stored) : null), [type, stored])
  const defs = useMemo(() => Object.fromEntries((type ? tableDefs(type) : []).map((d) => [d.key, d])), [type])
  const columns = useMemo(() => (config ? visibleColumns(config) : []), [config])

  const widths = useMemo(() => {
    const w: Record<string, number> = {}
    for (const c of columns) w[c.id] = live && live.id === c.id ? live.rem : c.colWidth
    return w
  }, [columns, live])
  const sticky = useMemo(() => {
    const out: Record<string, number> = {}
    if (config?.pinnedColumnIndex === undefined) return out
    const offs = leftOffsets(columns, widths)
    columns.forEach((c, i) => {
      // After the row-number column, which is pinned with them.
      if (i <= (config.pinnedColumnIndex as number)) out[c.id] = ROW_NUMBER_WIDTH + offs[i]
    })
    return out
  }, [columns, widths, config?.pinnedColumnIndex])

  const saveConfig = (next: TableViewConfig) => {
    if (!type) return
    onState({
      ...state,
      viewDefinition: { ...state.viewDefinition, tableConfigs: { ...state.viewDefinition.tableConfigs, [type.id]: next } },
    })
  }

  const startResize = (e: ReactMouseEvent, col: TableColumn) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startRem = col.colWidth
    let rem = startRem
    const move = (ev: MouseEvent) => {
      rem = startRem + (ev.clientX - startX) / REM_PX
      setLive({ id: col.id, rem })
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      setLive(null)
      if (rem !== startRem && config) saveConfig(setColWidth(config, col.id, rem))
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (config && e.over && e.active.id !== e.over.id) saveConfig(moveColumn(config, String(e.active.id), String(e.over.id)))
  }

  const reloadRow = useCallback(
    async (row: Row) => {
      try {
        const [fresh] = await api.rows({ paths: [row.summary.path] })
        if (fresh) {
          writes.seen(fresh, row)
          patchRowRef.current?.(row.summary.path, fresh)
        }
      } catch (err) {
        console.warn('Could not reload row:', err)
      }
    },
    [writes],
  )

  const fail = useCallback(
    async (row: Row, err: unknown) => {
      if (err instanceof ConflictError) {
        await reloadRow(row)
        say('Changed elsewhere. Reloaded.')
      } else {
        say(err instanceof Error ? err.message : 'Could not save.')
      }
    },
    [reloadRow, say],
  )

  /** Writes one cell; resolves `false` when the write failed (the cell then offers the value again). */
  const commit = useCallback(
    async (row: Row, def: PropertyDef, next: unknown): Promise<boolean> => {
      try {
        // Writes to one row run in turn, each from the newest version (the rows may lag behind).
        await writes.run(row, async (version, cur) => {
          const res = await api.updateProperties(row.summary.path, { [def.key]: next }, version)
          const nextLinks = res.links?.[def.key]
          const patched: Row = {
            ...cur,
            version: res.version,
            values: { ...cur.values, [def.key]: cellValue(def, res.frontmatter ?? { [def.key]: next }, res.links ?? {}, cur.summary) },
            links: nextLinks ? { ...cur.links, [def.key]: nextLinks } : cur.links,
          }
          writes.seen(patched)
          patchRowRef.current?.(row.summary.path, patched)
          return res
        })
        return true
      } catch (err) {
        await fail(row, err)
        return false
      }
    },
    [writes, fail],
  )

  const rename = useCallback(
    (row: Row, title: string) => {
      void writes.run(row, (version) => api.renameObject(row.summary.path, title, version)).catch((err: unknown) => fail(row, err))
    },
    [writes, fail],
  )

  const save = typeEditor.save
  const onDefChange = useCallback(
    // Resolves the save's result (null when it failed), so a new label is applied only once saved.
    async (next: PropertyDef) => {
      if (!type) return null
      return save({ ...type, propertyDefinitions: type.propertyDefinitions.map((d) => (d.id === next.id ? next : d)) })
    },
    [type, save],
  )

  if (!type || !config) {
    return <p className="py-6 text-center text-[14px] text-fg-muted">Table cannot be displayed for multiple object types.</p>
  }

  const canEditType = !type.basic && !type.readOnlyReason
  const total = ROW_NUMBER_WIDTH + columns.reduce((n, c) => n + (widths[c.id] ?? c.colWidth), 0)
  const mainContent = type.propertyDefinitions.find((d) => d.type === 'blocks')?.key
  const pinned = config.pinnedColumnIndex !== undefined
  const gutterStyle: CSSProperties = { width: `${ROW_NUMBER_WIDTH}rem`, ...(pinned ? { position: 'sticky', left: 0, zIndex: 2 } : {}) }

  const renderRow = (row: Row, i: number) => (
    <TableRow
      key={row.summary.path}
      row={row}
      index={i + 1}
      mainContent={mainContent}
      pinned={pinned}
      columns={columns}
      defs={defs}
      config={config}
      widths={widths}
      sticky={sticky}
      selected={props.isSelected?.(row.summary.path) ?? false}
      canEditType={canEditType}
      onOpen={onOpen}
      rename={rename}
      commit={commit}
      onDefChange={onDefChange}
      openSettings={setSettingsFor}
    />
  )

  return (
    <div data-testid="table-layout" className="flex flex-col gap-1">
      {notice && (
        <div role="status" data-testid="table-notice" className="rounded-md bg-raised px-3 py-1.5 text-[13px] text-fg">
          {notice}
        </div>
      )}
      <div className="overflow-x-auto" data-testid="table-scroll">
        <div role="table" style={{ minWidth: `${total}rem` }} className="w-max min-w-full">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={columns.filter((c) => c.type !== 'entity_title').map((c) => c.id)} strategy={horizontalListSortingStrategy}>
              <div role="row" className="flex border-b border-line">
                <div aria-hidden style={gutterStyle} className="h-8 shrink-0 border-r border-line bg-app" />
                {columns.map((c) => {
                  const def = defs[c.id]
                  if (!def) return null
                  return (
                    <HeaderCell
                      key={c.id}
                      col={c}
                      def={def}
                      width={widths[c.id] ?? c.colWidth}
                      sticky={sticky[c.id]}
                      sortable={c.type !== 'entity_title'}
                      onResizeStart={startResize}
                      menu={(close) => (
                        <ColumnMenu
                          def={def}
                          typeId={type.id}
                          state={state}
                          onState={onState}
                          config={config}
                          onConfig={saveConfig}
                          onClose={close}
                          onEditProperty={canEditType ? () => setSettingsFor(def.id) : undefined}
                        />
                      )}
                    />
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
          {groups.map((g) => (
            <div key={g.id} role="rowgroup">
              {grouped && (
                <div className="sticky left-0 max-w-[48rem]">{header(g, props.groupCount(g))}</div>
              )}
              {!(grouped && closed(g)) && g.rows.map(renderRow)}
            </div>
          ))}
          <CalcFooter
            columns={columns}
            defs={defs}
            rows={flat}
            state={state}
            onState={onState}
            ctx={ctx}
            typeId={type.id}
            widths={widths}
            sticky={sticky}
            gutter={<div aria-hidden style={gutterStyle} className="h-full shrink-0 border-r border-line bg-app" />}
          />
        </div>
      </div>
      {settingsFor && (
        <PropertySettings
          typeId={type.id}
          propertyId={settingsFor}
          open
          onOpenChange={(o) => !o && setSettingsFor(null)}
          onOpenProperty={setSettingsFor}
          editor={typeEditor}
        />
      )}
      {typeEditor.dialog}
    </div>
  )
}
