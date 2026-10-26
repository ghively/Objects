// The table layout: one structure, resizable and reorderable columns, a pinned (sticky) prefix,
// hidden and wrapped columns, a calculation footer and inline cell editing with the M2 cells.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { api, ConflictError } from '@/api/client'
import type { PropertyDef, Row, TableColumn, TableViewConfig, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cellValue } from '@/object/PropertyPanel'
import { useTypeEditor } from '@/object/useTypeEditor'
import { useTabs } from '@/nav/tabs'
import { cellForDef } from '@/properties/cellFor'
import { kindIcon } from '@/properties/kinds'
import { PropertySettings } from '@/properties/PropertySettings'
import { cn } from '@/lib/utils'
import type { LayoutProps } from '../DataView'
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
        aria-label="Title"
        value={text}
        readOnly={row.summary.readOnly}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false
          if (!row.summary.readOnly) commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setText(row.summary.title)
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

export function TableLayout(props: TableLayoutProps) {
  const { groups, grouped, state, onState, viewTypes, ctx, header, closed, onOpen, flat, patchRow } = props
  const type: TypeDef | undefined = viewTypes.length === 1 ? viewTypes[0] : undefined
  const typeEditor = useTypeEditor(type?.id)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [live, setLive] = useState<{ id: string; rem: number } | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
      if (i <= (config.pinnedColumnIndex as number)) out[c.id] = offs[i]
    })
    return out
  }, [columns, widths, config?.pinnedColumnIndex])

  if (!type || !config) {
    return <p className="py-6 text-center text-[14px] text-fg-muted">Table cannot be displayed for multiple object types.</p>
  }

  const saveConfig = (next: TableViewConfig) =>
    onState({
      ...state,
      viewDefinition: { ...state.viewDefinition, tableConfigs: { ...state.viewDefinition.tableConfigs, [type.id]: next } },
    })

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
      if (rem !== startRem) saveConfig(setColWidth(config, col.id, rem))
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) saveConfig(moveColumn(config, String(e.active.id), String(e.over.id)))
  }

  const reloadRow = async (row: Row) => {
    try {
      const [fresh] = await api.rows({ paths: [row.summary.path] })
      if (fresh) patchRow?.(row.summary.path, fresh)
    } catch (err) {
      console.warn('Could not reload row:', err)
    }
  }

  const fail = async (row: Row, err: unknown) => {
    if (err instanceof ConflictError) {
      await reloadRow(row)
      say('Changed elsewhere. Reloaded.')
    } else {
      say(err instanceof Error ? err.message : 'Could not save.')
    }
  }

  const commit = async (row: Row, def: PropertyDef, next: unknown) => {
    try {
      const res = await api.updateProperties(row.summary.path, { [def.key]: next }, row.version)
      const nextLinks = res.links?.[def.key]
      patchRow?.(row.summary.path, {
        ...row,
        version: res.version,
        values: { ...row.values, [def.key]: cellValue(def, res.frontmatter ?? { [def.key]: next }, res.links ?? {}, row.summary) },
        links: nextLinks ? { ...row.links, [def.key]: nextLinks } : row.links,
      })
    } catch (err) {
      await fail(row, err)
    }
  }

  const rename = async (row: Row, title: string) => {
    try {
      await api.renameObject(row.summary.path, title, row.version)
    } catch (err) {
      await fail(row, err)
    }
  }

  const onDefChange = async (next: PropertyDef) => {
    await typeEditor.save({ ...type, propertyDefinitions: type.propertyDefinitions.map((d) => (d.id === next.id ? next : d)) })
  }

  const canEditType = !type.basic && !type.readOnlyReason
  const total = columns.reduce((n, c) => n + (widths[c.id] ?? c.colWidth), 0)

  const cellStyle = (c: TableColumn): CSSProperties => ({
    width: `${widths[c.id] ?? c.colWidth}rem`,
    ...(sticky[c.id] !== undefined ? { position: 'sticky', left: `${sticky[c.id]}rem`, zIndex: 1 } : {}),
  })

  const renderRow = (row: Row) => (
    <div
      key={row.summary.path}
      role="row"
      data-path={row.summary.path}
      style={{ minHeight: TABLE_ROW_HEIGHT }}
      className="flex border-b border-line hover:bg-hover/40"
    >
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
              'flex shrink-0 items-center border-r border-line bg-app px-2 py-0.5',
              wrapped ? 'whitespace-normal break-words' : 'overflow-hidden whitespace-nowrap',
              !wrapped && 'h-9',
            )}
          >
            {def?.type === 'entity_title' ? (
              <TitleCell row={row} onRename={(r, t) => void rename(r, t)} onOpen={(e) => onOpen(row, e)} />
            ) : def && Cell ? (
              <div className="min-w-0 flex-1">
                <Cell
                  def={def}
                  value={valueFor(def, row)}
                  readOnly={row.summary.readOnly}
                  density={wrapped ? 'panel' : 'table'}
                  onChange={(next: unknown) => void commit(row, def, next)}
                  onDefChange={onDefChange}
                  onOpenObject={(path: string) => useTabs.getState().open({ kind: 'object', path })}
                  onOpenSettings={canEditType ? () => setSettingsFor(def.id) : undefined}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
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
