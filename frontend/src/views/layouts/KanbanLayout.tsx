// `kanban`: one column per group (the view's grouping, else the first label property). Cards drag
// between columns and a drop writes the group's value; "+" creates an object in a column.
import { useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { api, ConflictError } from '@/api/client'
import type { GroupBy, Row } from '@/api/types'
import { Icon } from '@/components/Icon'
import { usePeek } from '@/nav/tabs'
import { LabelPill } from '@/properties/LabelMenu'
import { cn } from '@/lib/utils'
import type { LayoutProps } from '../DataView'
import { groupRows, valueForGroup, type Group } from '../group'
import { matchingValues } from '../matching'
import { propertyChoices } from '../properties'
import { createRowWrites } from '../rowWrites'
import { CardItem } from './CardItem'

/** The grouping a kanban uses: the view's own, else the first label property of its types. */
export function kanbanGroupBy(groupBy: GroupBy | null, props: Pick<LayoutProps, 'viewTypes'>): GroupBy | null {
  if (groupBy?.groups?.length) return groupBy
  const choices = propertyChoices(props.viewTypes)
  const label = choices.find((c) => c.kind === 'label')
  return label ? { groups: [{ propertyId: label.key, option: 'default', structureId: label.structureId }] } : null
}

function Card({ props, row, hide, groupId }: { props: LayoutProps; row: Row; hide: string[]; groupId: string }) {
  // A card with several values shows in several columns: the id names the column it is in.
  const d = useDraggable({
    id: `${groupId}\n${row.summary.path}`,
    data: { path: row.summary.path, groupId },
    disabled: row.summary.readOnly,
  })
  return (
    <div
      ref={d.setNodeRef}
      {...d.attributes}
      {...d.listeners}
      data-testid="kanban-card"
      data-path={row.summary.path}
      style={{ transform: d.transform ? `translate3d(${d.transform.x}px, ${d.transform.y}px, 0)` : undefined, zIndex: d.isDragging ? 20 : undefined }}
      className={cn(d.isDragging && 'opacity-80')}
    >
      <CardItem layout={props} row={row} hide={hide} />
    </div>
  )
}

function Column({
  group,
  droppable,
  props,
  hide,
  title,
  onAdd,
}: {
  group: Group
  droppable: boolean
  props: LayoutProps
  hide: string[]
  title: React.ReactNode
  onAdd(): void
}) {
  const drop = useDroppable({ id: `col:${group.id}`, disabled: !droppable })
  return (
    <div
      ref={drop.setNodeRef}
      data-testid="kanban-column"
      data-group={group.id}
      data-droppable={droppable ? 'true' : 'false'}
      className={cn('flex w-64 shrink-0 flex-col gap-2 rounded-xl bg-hover/40 p-2', drop.isOver && 'bg-hover')}
    >
      <div className="flex h-7 items-center gap-2 px-1 text-[14px] font-medium">
        {title}
        <span className="text-fg-muted">{group.rows.length}</span>
      </div>
      {group.rows.map((r) => (
        <Card key={r.summary.path} props={props} row={r} hide={hide} groupId={group.id} />
      ))}
      <button
        type="button"
        aria-label={`Add to ${group.label}`}
        onClick={onAdd}
        className="flex h-8 w-full items-center justify-center rounded-lg text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Icon name="ph-plus" size={14} />
      </button>
    </div>
  )
}

export function KanbanLayout(props: LayoutProps) {
  const { flat, state, ctx, viewTypes, typesById, collections, patchRow, onWritten } = props
  const [notice, setNotice] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writes = useMemo(() => createRowWrites(), [])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const groupBy = useMemo(() => kanbanGroupBy(state.groupBy, props), [state.groupBy, props])
  const choices = useMemo(() => propertyChoices(viewTypes), [viewTypes])
  const entry = groupBy?.groups[0]
  const groupDef = entry ? choices.find((c) => c.key === entry.propertyId)?.def : undefined
  const { groups } = useMemo(
    () => groupRows(flat, groupBy, state.viewDefinition.groupByConfig, ctx),
    [flat, groupBy, state.viewDefinition.groupByConfig, ctx],
  )
  const update = (g: Group) => (groupBy && groupDef ? valueForGroup(groupBy, g, groupDef) : null)
  const hide = entry ? [entry.propertyId] : []

  const say = (text: string) => {
    setNotice(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setNotice(null), 4000)
  }

  const reload = async (row: Row) => {
    try {
      const [fresh] = await api.rows({ paths: [row.summary.path] })
      if (fresh) {
        writes.seen(fresh, row)
        patchRow?.(row.summary.path, fresh)
      }
    } catch (err) {
      console.warn('Could not reload row:', err)
    }
  }

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over) return
    const data = e.active.data?.current as { path?: string; groupId?: string } | undefined
    const path = data?.path ?? String(e.active.id)
    const row = flat.find((r) => r.summary.path === path)
    const target = groups.find((g) => `col:${g.id}` === e.over?.id)
    if (!row || !target || target.rows.some((r) => r.summary.path === row.summary.path)) return
    const from = groups.find((g) => g.id === data?.groupId) ?? groups.find((g) => g.rows.some((r) => r.summary.path === path))
    const change = groupBy && groupDef ? valueForGroup(groupBy, target, groupDef, { row, from }) : null
    if (!change) return
    try {
      // Writes to one row run in turn, each from the newest version (the rows may lag behind).
      const result = await writes.run(row, (version, cur) => {
        const c = (groupBy && groupDef && valueForGroup(groupBy, target, groupDef, { row: cur, from })) || change
        return api.updateProperties(row.summary.path, { [c.key]: c.value }, version)
      })
      await reload(row)
      onWritten?.(row, result)
    } catch (err) {
      if (err instanceof ConflictError) {
        await reload(row)
        say('Changed elsewhere. Reloaded.')
      } else say(err instanceof Error ? err.message : 'Could not save.')
    }
  }

  const add = async (g: Group) => {
    const type = viewTypes[0] ?? Object.values(typesById)[0]
    if (!type) return
    const values: Record<string, unknown> = { ...matchingValues(state.filterGroup, props.types, type.id, collections) }
    const change = update(g)
    if (change) values[change.key] = change.value
    try {
      const created = await api.createObject(type.id, { values })
      usePeek.getState().peek(created.path)
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not create.')
    }
  }

  return (
    <div data-testid="kanban">
      <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          {groups.map((g) => (
            <Column
              key={g.id}
              group={g}
              droppable={update(g) !== null}
              props={props}
              hide={hide}
              onAdd={() => void add(g)}
              title={
                groupDef?.type === 'label' && !g.isOther ? (
                  <LabelPill option={{ text: g.label, color: g.color ?? null, icon: null }} />
                ) : (
                  <span className="truncate">{g.label}</span>
                )
              }
            />
          ))}
        </div>
      </DndContext>
      {notice && (
        <div role="status" className="mt-2 text-[13px] text-fg-muted">
          {notice}
        </div>
      )}
    </div>
  )
}
