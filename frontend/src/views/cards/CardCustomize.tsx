// Customize view > Card view: per type, "Use default", a gear for the type's settings, and the
// selected card properties (sortable, removable) with the ones that can still be added.
import { useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { TypeDef, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { useTabs } from '@/nav/tabs'
import {
  cardProperties,
  cardPropertyChoices,
  setCardProperties,
  setUseDefault,
  usesDefaultCard,
  type CardProperty,
} from './cardConfig'

function Row({ id, name, disabled, onRemove }: { id: string; name: string; disabled: boolean; onRemove(): void }) {
  const s = useSortable({ id, disabled })
  return (
    <div
      ref={s.setNodeRef}
      {...s.attributes}
      {...s.listeners}
      data-testid="card-prop"
      style={{ transform: s.transform ? `translate3d(0, ${Math.round(s.transform.y)}px, 0)` : undefined, transition: s.transition }}
      className="flex h-8 items-center gap-2 rounded-md px-2 text-[14px] hover:bg-hover"
    >
      <Icon name="ph-dots-six-vertical" size={13} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {!disabled && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          className="text-fg-muted hover:text-fg"
        >
          <Icon name="ph-x" size={13} />
        </button>
      )}
    </div>
  )
}

function TypeCard({ type, state, onState }: { type: TypeDef; state: ViewState; onState(next: ViewState): void }) {
  const [adding, setAdding] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const def = state.viewDefinition
  const isDefault = usesDefaultCard(type, def)
  const props = cardProperties(type, def)
  const choices = cardPropertyChoices(type)
  const nameOf = (p: CardProperty) => choices.find((c) => c.propertyId === p.propertyId)?.name ?? p.propertyId
  const set = (next: CardProperty[]) => onState({ ...state, viewDefinition: setCardProperties(type, def, next) })
  const available = choices.filter((c) => !props.some((p) => p.propertyId === c.propertyId))

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = props.findIndex((p) => p.propertyId === e.active.id)
    const to = props.findIndex((p) => p.propertyId === e.over?.id)
    if (from >= 0 && to >= 0) set(arrayMove(props, from, to))
  }

  return (
    <div className="flex flex-col border-b border-line pb-1 last:border-0" data-testid="card-settings" data-type={type.id}>
      <div className="flex h-8 items-center gap-2 px-2 text-[14px] font-medium">
        <span className="min-w-0 flex-1 truncate">{type.name}</span>
        <button
          type="button"
          aria-label="Open settings"
          title="Open settings"
          onClick={() => useTabs.getState().open({ kind: 'typeSettings', typeId: type.id })}
          className="text-fg-muted hover:text-fg"
        >
          <Icon name="ph-gear" size={14} />
        </button>
      </div>
      <label className="flex h-8 items-center justify-between gap-2 px-2 text-[14px]">
        Use default
        <input
          type="checkbox"
          role="switch"
          aria-label={`Use default for ${type.name}`}
          checked={isDefault}
          onChange={(e) => onState({ ...state, viewDefinition: setUseDefault(type, def, e.target.checked) })}
        />
      </label>
      <div className="px-2 pt-1 text-[12px] text-fg-muted">Selected Properties</div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={props.map((p) => p.propertyId)} strategy={verticalListSortingStrategy}>
          {props.map((p) => (
            <Row
              key={p.propertyId}
              id={p.propertyId}
              name={nameOf(p)}
              disabled={isDefault}
              onRemove={() => set(props.filter((x) => x.propertyId !== p.propertyId))}
            />
          ))}
        </SortableContext>
      </DndContext>
      {!isDefault && (
        <>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
          >
            <Icon name="ph-plus" size={14} />
            Add Properties
          </button>
          {adding &&
            (available.length === 0 ? (
              <p className="px-2 py-1 text-[13px] text-fg-muted">No further properties available</p>
            ) : (
              available.map((c) => (
                <button
                  key={c.propertyId}
                  type="button"
                  onClick={() => set([...props, { propertyType: c.propertyType, propertyId: c.propertyId }])}
                  className="flex h-8 items-center rounded-md px-6 text-left text-[14px] hover:bg-hover"
                >
                  {c.name}
                </button>
              ))
            ))}
        </>
      )}
    </div>
  )
}

export function CardCustomizePage({ types, state, onState }: { types: TypeDef[]; state: ViewState; onState(next: ViewState): void }) {
  return (
    <div className="flex flex-col">
      {types.map((t) => (
        <TypeCard key={t.id} type={t} state={state} onState={onState} />
      ))}
    </div>
  )
}
