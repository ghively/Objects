// The small card (`.preview-card-base` + `.preview-card-core`): type label, cover, title and the
// configured properties as compact read-only cells. The wall variant shows the type label, the icon
// and title, the description, then one labelled row per card-view property ("Empty" when unset).
import type { MouseEvent, ReactNode } from 'react'
import { api } from '@/api/client'
import type { PropertyDef, Row, TypeDef } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { cellForDef } from '@/properties/cellFor'
import { asComputed, computedIsEmpty } from '@/properties/computed'
import { chipStyle, tagStyle } from '@/theme/palette'
import { kindIcon } from '@/properties/kinds'
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
  v === null ||
  v === undefined ||
  v === '' ||
  v === false ||
  (Array.isArray(v) && v.length === 0) ||
  // M12: a formula or rollup value with nothing in it (an error still shows).
  (asComputed(v) !== null && computedIsEmpty(v, { errorIsEmpty: false }))

export const CARD_BASE =
  'preview-card-base preview-card-core relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-line bg-raised text-left shadow-(--card-shadow) active:brightness-[1.02]'

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

/** One labelled property row of a wall card: icon and name, then the value or "Empty". */
function PropRow({ id, name, icon, children }: { id: string; name: string; icon: PropertyDef['icon'] | string; children: ReactNode }) {
  return (
    <div
      data-testid="card-prop-row"
      data-prop={id}
      className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-2 text-[13px]"
    >
      <span className="flex min-w-0 items-center gap-1 pt-0.5 text-fg-muted">
        <IconOrEmoji icon={icon} fallback="ph-note-blank" size={13} />
        <span data-testid="card-prop-name" className="truncate">
          {name}
        </span>
      </span>
      <span className="pointer-events-none min-w-0">{children}</span>
    </div>
  )
}

const EMPTY = <span className="pt-0.5 text-[13px] text-fg-muted">Empty</span>

/** The wall card's parts: type label, icon and title, description, then the property rows. */
export function WallCardProperties({
  row,
  type,
  props,
  hide = [],
}: {
  row: Row
  type?: TypeDef
  props: CardProperty[]
  hide?: string[]
}) {
  const shown = props.filter((p) => !hide.includes(p.propertyId))
  const has = (kind: string) => shown.some((p) => p.propertyType === kind)
  const icon = row.summary.icon ?? type?.icon ?? null
  const description = row.summary.description?.trim()
  const defName = (id: string, fallback: string) => type?.propertyDefinitions.find((d) => d.key === id)?.name ?? fallback
  return (
    <>
      {has('entity_type') && <TypeLabel type={type} />}
      {has('entity_title') && (
        <span data-testid="card-title" className="flex min-w-0 items-start gap-1.5 text-[15px] font-semibold text-fg">
          <span data-testid="card-title-icon" className="inline-flex shrink-0 pt-[3px]">
            <IconOrEmoji icon={icon} fallback="ph-file-text" size={16} />
          </span>
          <span className="line-clamp-2 min-w-0">{displayTitle(row)}</span>
        </span>
      )}
      {description && (
        <span data-testid="card-description" className="line-clamp-3 text-[13px] text-fg-muted">
          {description}
        </span>
      )}
      {shown.map((p) => {
        switch (p.propertyType) {
          case 'entity_type':
          case 'entity_title':
          case 'entity_description':
            return null
          case 'computed':
            return row.preview ? (
              <span key={p.propertyId} data-testid="card-preview" className="line-clamp-4 text-[13px] text-fg-muted">
                {row.preview}
              </span>
            ) : null
          case 'entity_tags': {
            const tags = row.summary.tags
            return (
              <PropRow key={p.propertyId} id={p.propertyId} name={defName(p.propertyId, 'Tags')} icon={kindIcon('entity_tags')}>
                {tags.length === 0 ? (
                  EMPTY
                ) : (
                  <span data-testid="card-tags" className="flex flex-wrap gap-1">
                    {tags.map((t) => (
                      <span key={t} className="rounded-md px-1.5 py-[1px] text-[12px]" style={tagStyle(null)}>
                        {t}
                      </span>
                    ))}
                  </span>
                )}
              </PropRow>
            )
          }
          case 'entity_collections': {
            const names = row.summary.collections ?? []
            return (
              <PropRow key={p.propertyId} id={p.propertyId} name={defName(p.propertyId, 'Collections')} icon={COLLECTION_ICON}>
                {names.length ? <span className="block truncate pt-0.5 text-fg">{names.join(', ')}</span> : EMPTY}
              </PropRow>
            )
          }
          default: {
            const def: PropertyDef | undefined = type?.propertyDefinitions.find((d) => d.key === p.propertyId)
            if (!def) return null
            const Cell = cellForDef(def)
            if (!Cell) return null
            const value = p.propertyId in row.values ? row.values[p.propertyId] : undefined
            // A checkbox always shows its box; every other kind reads "Empty" when unset.
            const empty = def.type !== 'boolean' && isEmptyValue(value)
            return (
              <PropRow key={p.propertyId} id={p.propertyId} name={def.name} icon={def.icon ?? kindIcon(def.type)}>
                {empty ? EMPTY : <Cell def={def} value={value} readOnly density="table" onChange={() => {}} />}
              </PropRow>
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
  variant,
}: {
  row: Row
  type?: TypeDef
  props: CardProperty[]
  hide?: string[]
  onOpen?(row: Row, e: MouseEvent): void
  className?: string
  /** `wall`: labelled property rows with "Empty" placeholders, and the description under the title. */
  variant?: 'wall'
  /** Beside the card's properties, on the left (a task's checkbox). */
  leading?: ReactNode
  /** Under the card's properties (a task's date, deadline and priority). */
  trailing?: ReactNode
}) {
  const image = cardImage(row)
  const Parts = variant === 'wall' ? WallCardProperties : CardProperties
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
          <Parts row={row} type={type} props={props} hide={hide} />
        </div>
      ) : (
        <div className="flex min-w-0 items-start gap-2 p-3">
          {leading != null && (
            <span data-slot="leading" className="flex shrink-0 items-center pt-0.5">
              {leading}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Parts row={row} type={type} props={props} hide={hide} />
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
