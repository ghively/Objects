// Type Settings > "Card view and linking": the default link view (how a link to an object of this
// type is shown as a block) and the default small card (which properties it shows), with a live
// preview. Both save through `useTypeEditor`.
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { Row, SmallCardViewConfig, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { useTypeEditor, type TypeEditor } from '@/object/useTypeEditor'
import { cardProperties, cardPropertyChoices, type CardProperty } from '@/views/cards/cardConfig'
import { SmallCard } from '@/views/cards/SmallCard'

export const CARD_VIEW_TEXT = {
  group: 'Card view and linking',
  linkView: 'Default link view',
  linkViewExplanation: 'Set a default view to be used when linking or creating an object as a block somewhere in your content.',
  cardView: 'Default card view',
  cardViewExplanation: 'Set which properties should be shown on the small card by default for this object type.',
  selected: 'Selected Properties',
  addProperties: 'Add Properties',
}

export const LINK_VIEWS: readonly { value: NonNullable<TypeDef['defaultViewType']>; name: string }[] = [
  { value: 'inline', name: 'Link block' },
  { value: 'smallCard', name: 'Small card' },
  { value: 'wideCard', name: 'Wide card' },
  { value: 'embed', name: 'Embed' },
]

function PropRow({ id, name, disabled, onRemove }: { id: string; name: string; disabled: boolean; onRemove(): void }) {
  const s = useSortable({ id, disabled })
  return (
    <div
      ref={s.setNodeRef}
      {...s.attributes}
      {...s.listeners}
      data-testid="type-card-prop"
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

/** A row to show in the preview: the type's first, else a made-up one titled with the type's name. */
function usePreviewRow(type: TypeDef | undefined): Row | null {
  const [row, setRow] = useState<Row | null>(null)
  const id = type?.id
  useEffect(() => {
    if (!id) return
    let alive = true
    api
      .rows({ typeIds: [id] })
      .then((rows) => alive && setRow(rows?.[0] ?? null))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [id])
  if (!type) return null
  return (
    row ?? {
      summary: {
        id: null,
        path: `${type.folder}/${type.name}.md`,
        type: type.id,
        title: type.name,
        icon: null,
        iconColor: null,
        description: null,
        aliases: [],
        createdAt: null,
        lastUpdated: null,
        tags: [],
        template: null,
        color: null,
        coverImage: null,
        readOnly: false,
        collections: [],
      },
      version: '',
      values: {},
      links: {},
      preview: '',
    }
  )
}

export function CardViewSettings({ typeId, editor, disabled }: { typeId: string; editor?: TypeEditor; disabled?: boolean }) {
  const own = useTypeEditor(editor ? null : typeId)
  const ed = editor ?? own
  const type = ed.type
  const [adding, setAdding] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const preview = usePreviewRow(type)
  if (!type) return null

  const props = cardProperties(type)
  const choices = cardPropertyChoices(type)
  const nameOf = (p: CardProperty) => choices.find((c) => c.propertyId === p.propertyId)?.name ?? p.propertyId
  const available = choices.filter((c) => !props.some((p) => p.propertyId === c.propertyId))
  const saveProps = (properties: CardProperty[]) => {
    const smallCardViewConfig: SmallCardViewConfig = { entityViewType: 'smallCard', properties }
    void ed.save((latest) => ({ ...latest, smallCardViewConfig }))
  }
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = props.findIndex((p) => p.propertyId === e.active.id)
    const to = props.findIndex((p) => p.propertyId === e.over?.id)
    if (from >= 0 && to >= 0) saveProps(arrayMove(props, from, to))
  }
  const linkView = type.defaultViewType ?? 'inline'

  return (
    <section aria-label={CARD_VIEW_TEXT.group}>
      <h3 className="mb-2 text-[15px] font-semibold text-fg-muted">{CARD_VIEW_TEXT.group}</h3>
      <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-start sm:gap-6">
        <div className="sm:w-[240px] sm:shrink-0">
          <div className="text-[15px] font-medium">{CARD_VIEW_TEXT.linkView}</div>
          <p className="mt-0.5 text-[13px] text-fg-muted">{CARD_VIEW_TEXT.linkViewExplanation}</p>
        </div>
        <div role="radiogroup" aria-label={CARD_VIEW_TEXT.linkView} className="flex flex-wrap gap-1.5">
          {LINK_VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              role="radio"
              aria-checked={linkView === v.value}
              disabled={disabled}
              onClick={() => linkView !== v.value && void ed.save((latest) => ({ ...latest, defaultViewType: v.value }))}
              className={cn(
                'h-8 rounded-md border px-3 text-[14px] disabled:opacity-60',
                linkView === v.value ? 'border-fg-muted bg-hover-2' : 'border-line hover:bg-hover',
              )}
            >
              {v.name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-start sm:gap-6">
        <div className="sm:w-[240px] sm:shrink-0">
          <div className="text-[15px] font-medium">{CARD_VIEW_TEXT.cardView}</div>
          <p className="mt-0.5 text-[13px] text-fg-muted">{CARD_VIEW_TEXT.cardViewExplanation}</p>
        </div>
        <div className="flex w-full max-w-[420px] flex-col gap-2">
          <div className="px-2 text-[12px] text-fg-muted">{CARD_VIEW_TEXT.selected}</div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={props.map((p) => p.propertyId)} strategy={verticalListSortingStrategy}>
              {props.map((p) => (
                <PropRow
                  key={p.propertyId}
                  id={p.propertyId}
                  name={nameOf(p)}
                  disabled={!!disabled}
                  onRemove={() => saveProps(props.filter((x) => x.propertyId !== p.propertyId))}
                />
              ))}
            </SortableContext>
          </DndContext>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAdding((v) => !v)}
            className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover disabled:opacity-60"
          >
            <Icon name="ph-plus" size={14} />
            {CARD_VIEW_TEXT.addProperties}
          </button>
          {adding &&
            (available.length === 0 ? (
              <p className="px-2 py-1 text-[13px] text-fg-muted">No further properties available</p>
            ) : (
              available.map((c) => (
                <button
                  key={c.propertyId}
                  type="button"
                  onClick={() => saveProps([...props, { propertyType: c.propertyType, propertyId: c.propertyId }])}
                  className="flex h-8 items-center rounded-md px-6 text-left text-[14px] hover:bg-hover"
                >
                  {c.name}
                </button>
              ))
            ))}
          {preview && (
            <div className="mt-2 max-w-[260px]" aria-label="Card preview">
              <SmallCard row={preview} type={type} props={props} />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
