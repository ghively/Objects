// The sidebar's Pinned section, and the item list it shares with custom sections: each pin
// renders by kind (object, type, collection, query), reorders by drag, has an unpin menu, and
// is dimmed (unpin only) when its target no longer exists.
import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { PinRef } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useLinkIndex } from '@/links/linkIndex'
import type { Target } from '@/nav/tabs'
import { ObjectIcon } from '@/object/ObjectHeader'
import { queryTitle } from '@/queries/autoTitle'
import { useTitleCtx } from '@/queries/QueryPage'
import { useDefs } from '@/types/useDefinitions'
import { cn } from '@/lib/utils'
import { TypeChip } from './Sidebar'
import { PINNED_TEXT } from './pinText'
import { usePinned } from './usePinned'

export const pinKey = (r: PinRef) => `${r.kind}:${r.id}`

export type OpenTarget = (target: Target, opts: { newTab?: boolean }) => void

interface Resolved {
  target: Target
  label: string
  leading: ReactNode
}

/** What a pin points at, or null while it can't be told yet; `missing` when it is gone. */
function useResolver(): (ref: PinRef) => Resolved | 'missing' | null {
  const objects = useLinkIndex((s) => s.objects)
  const types = useLinkIndex((s) => s.types)
  const indexLoaded = useLinkIndex((s) => s.loaded)
  const { collections, queries, loaded: defsLoaded } = useDefs()
  const titleCtx = useTitleCtx(types)
  return useMemo(
    () => (ref: PinRef) => {
      switch (ref.kind) {
        case 'object': {
          const o = objects.find((x) => x.id === ref.id)
          if (!o) return indexLoaded || objects.length > 0 ? 'missing' : null
          const type = types.find((t) => t.id === o.type)
          return {
            target: { kind: 'object', path: o.path },
            label: o.title,
            leading: o.icon ? <ObjectIcon icon={o.icon} size={16} /> : type ? <TypeChip type={type} size={22} /> : null,
          }
        }
        case 'type': {
          const t = types.find((x) => x.id === ref.id)
          if (!t) return indexLoaded || types.length > 0 ? 'missing' : null
          return { target: { kind: 'type', typeId: t.id }, label: t.pluralName, leading: <TypeChip type={t} size={22} /> }
        }
        case 'collection': {
          const c = collections.find((x) => x.id === ref.id)
          if (!c) return defsLoaded ? 'missing' : null
          return {
            target: { kind: 'collection', id: c.id },
            label: c.name,
            leading: <IconOrEmoji icon={c.icon} fallback="ph-stack" size={16} />,
          }
        }
        case 'query': {
          const q = queries.find((x) => x.id === ref.id)
          if (!q) return defsLoaded ? 'missing' : null
          return {
            target: { kind: 'query', id: q.id },
            label: queryTitle(q, titleCtx) || 'Query',
            leading: <IconOrEmoji icon={q.icon} fallback="ph-magnifying-glass" size={16} />,
          }
        }
      }
    },
    [objects, types, indexLoaded, collections, queries, defsLoaded, titleCtx],
  )
}

function PinRow({
  pin,
  resolved,
  unpinLabel,
  onUnpin,
  onOpen,
}: {
  pin: PinRef
  resolved: Resolved | 'missing'
  unpinLabel: string
  onUnpin(): void
  onOpen: OpenTarget
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pinKey(pin) })
  const missing = resolved === 'missing'
  const open = (e: MouseEvent) => {
    if (!missing) onOpen(resolved.target, { newTab: e.ctrlKey || e.metaKey })
  }
  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      data-pin={pinKey(pin)}
      data-missing={missing ? '' : undefined}
      className={cn(isDragging && 'relative z-10 opacity-70')}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={open}
            aria-disabled={missing || undefined}
            className={cn(
              'flex h-[36px] w-full items-center gap-2 rounded-lg px-1.5 text-left text-[15px] font-medium hover:bg-hover',
              missing && 'opacity-50',
            )}
          >
            {missing ? (
              <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-md border border-line text-fg-muted">
                <Icon name="ph-question" size={14} />
              </span>
            ) : (
              <span className="inline-flex size-[22px] shrink-0 items-center justify-center">{resolved.leading}</span>
            )}
            <span className="min-w-0 flex-1 truncate">{missing ? PINNED_TEXT.missing : resolved.label}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="border-line bg-raised text-fg">
          <ContextMenuItem onSelect={onUnpin}>
            <Icon name="ph-push-pin-slash" size={14} />
            {unpinLabel}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  )
}

/** The items of one sidebar section, draggable to reorder. `sectionId` null is the Pinned section. */
export function PinList({
  items,
  sectionId,
  unpinLabel,
  onOpenTarget,
}: {
  items: PinRef[]
  sectionId: string | null
  unpinLabel: string
  onOpenTarget?: OpenTarget
}) {
  const { move, unpin } = usePinned()
  const resolve = useResolver()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  if (items.length === 0) return <p className="px-2 pb-1 text-[14px] text-fg-muted italic">{PINNED_TEXT.empty}</p>

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = items.findIndex((p) => pinKey(p) === active.id)
    const to = items.findIndex((p) => pinKey(p) === over.id)
    if (from >= 0 && to >= 0) void move(sectionId, from, to)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map(pinKey)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-0.5 pb-1">
          {items.map((pin) => {
            const resolved = resolve(pin)
            if (!resolved) return null
            return (
              <PinRow
                key={pinKey(pin)}
                pin={pin}
                resolved={resolved}
                unpinLabel={unpinLabel}
                onUnpin={() => void unpin(pin, sectionId)}
                onOpen={(t, o) => onOpenTarget?.(t, o)}
              />
            )
          })}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

/** The fixed "Pinned" section. */
export function PinnedSection({ headingId = 'sb-pinned', onOpenTarget }: { headingId?: string; onOpenTarget?: OpenTarget }) {
  const { pinned } = usePinned()
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="flex items-center gap-1.5 px-2 pt-5 pb-2 text-[14px] font-semibold text-[#a7a2a1]">
        {PINNED_TEXT.heading}
      </h2>
      <PinList items={pinned} sectionId={null} unpinLabel={PINNED_TEXT.unpinFromSpace} onOpenTarget={onOpenTarget} />
    </section>
  )
}
