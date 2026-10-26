// The small card (`.preview-card-base` + `.preview-card-core`): type label, cover, title and the
// configured properties as compact read-only cells.
import type { MouseEvent, ReactNode } from 'react'
import { api } from '@/api/client'
import type { PropertyDef, Row, TypeDef } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { cellForDef } from '@/properties/cellFor'
import { chipStyle, tagStyle } from '@/theme/palette'
import { displayTitle } from '../filter'
import type { CardProperty } from './cardConfig'
import { COLLECTION_ICON } from '@/lib/defIcons'

/** The image shown on a card: the cover, else a media preview image kept in the space. */
export function cardImage(row: Row): string | null {
  const cover = row.summary.coverImage
  if (cover) return cover
  const preview = row.values.previewImage
  return typeof preview === 'string' && preview && !/^[a-z][a-z0-9+.-]*:/i.test(preview) ? preview : null
}

export const isEmptyValue = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0)

export const CARD_BASE =
  'preview-card-base preview-card-core relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-line bg-raised text-left shadow-[0_2px_3px_#00000001,0_4px_9px_#00000003,0_8px_12px_#00000001] active:brightness-[1.02]'

function TypeLabel({ type }: { type?: TypeDef }) {
  if (!type) return null
  return (
    <span
      data-testid="card-type"
      className="inline-flex max-w-full items-center gap-1 text-[12px] text-[var(--chip-fg)]"
      style={chipStyle(type.color)}
    >
      <IconOrEmoji icon={type.icon} fallback="ph-file-text" size={12} />
      <span className="truncate">{type.name}</span>
    </span>
  )
}

export function CardProperties({
  row,
  type,
  props,
  hide = [],
}: {
  row: Row
  type?: TypeDef
  props: CardProperty[]
  /** Property keys left out (the one a kanban groups by). */
  hide?: string[]
}) {
  return (
    <>
      {props.map((p) => {
        if (hide.includes(p.propertyId)) return null
        switch (p.propertyType) {
          case 'entity_type':
            return <TypeLabel key={p.propertyId} type={type} />
          case 'entity_title':
            return (
              <span key={p.propertyId} data-testid="card-title" className="line-clamp-2 text-[15px] font-semibold text-fg">
                {displayTitle(row)}
              </span>
            )
          case 'entity_tags': {
            const tags = row.summary.tags
            return (
              <span key={p.propertyId} data-testid="card-tags" className="flex flex-wrap gap-1">
                {tags.length === 0 ? (
                  <span className="text-[13px] text-fg-muted">Tags</span>
                ) : (
                  tags.map((t) => (
                    <span key={t} className="rounded-md px-1.5 py-[1px] text-[12px]" style={tagStyle(null)}>
                      {t}
                    </span>
                  ))
                )}
              </span>
            )
          }
          case 'entity_collections': {
            const names = row.summary.collections ?? []
            return (
              <span key={p.propertyId} data-testid="card-collections" className="flex items-center gap-1 text-[13px] text-fg-muted">
                <Icon name={COLLECTION_ICON} size={12} />
                <span className="truncate">{names.length ? names.join(', ') : 'Collections'}</span>
              </span>
            )
          }
          case 'computed':
            return row.preview ? (
              <span key={p.propertyId} data-testid="card-preview" className="line-clamp-4 text-[13px] text-fg-muted">
                {row.preview}
              </span>
            ) : null
          default: {
            const def: PropertyDef | undefined = type?.propertyDefinitions.find((d) => d.key === p.propertyId)
            if (!def) return null
            const value = p.propertyId in row.values ? row.values[p.propertyId] : undefined
            if (isEmptyValue(value)) return null
            const Cell = cellForDef(def)
            if (!Cell) return null
            return (
              <div key={p.propertyId} data-prop={p.propertyId} className="pointer-events-none min-w-0">
                <Cell def={def} value={value} readOnly density="table" onChange={() => {}} />
              </div>
            )
          }
        }
      })}
    </>
  )
}

export function SmallCard({
  row,
  type,
  props,
  hide,
  onOpen,
  className,
  leading,
  trailing,
}: {
  row: Row
  type?: TypeDef
  props: CardProperty[]
  hide?: string[]
  onOpen?(row: Row, e: MouseEvent): void
  className?: string
  /** Beside the card's properties, on the left (a task's checkbox). */
  leading?: ReactNode
  /** Under the card's properties (a task's date, deadline and priority). */
  trailing?: ReactNode
}) {
  const image = cardImage(row)
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="small-card"
      data-path={row.summary.path}
      onClick={(e) => onOpen?.(row, e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen?.(row, e as unknown as MouseEvent)
      }}
      className={cn(CARD_BASE, className)}
    >
      {image && <img src={api.fileUrl(image)} alt="" className="h-28 w-full object-cover" />}
      {leading == null && trailing == null ? (
        <div className="flex min-w-0 flex-col gap-1.5 p-3">
          <CardProperties row={row} type={type} props={props} hide={hide} />
        </div>
      ) : (
        <div className="flex min-w-0 items-start gap-2 p-3">
          {leading != null && (
            <span data-slot="leading" className="flex shrink-0 items-center pt-0.5">
              {leading}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <CardProperties row={row} type={type} props={props} hide={hide} />
            {trailing != null && (
              <div data-slot="trailing" className="flex flex-wrap items-center gap-2">
                {trailing}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
