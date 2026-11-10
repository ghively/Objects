// M31: the "Page" link view: a full-width, read-only preview of the object as its page shows it.
// Top to bottom: the cover image, the type label, the icon and title (large), the description, the
// properties the page's panel shows (one labelled row each, "Empty" when unset; hidden ones and
// empty "hide when empty" ones left out), then the first lines of the body. Clicking it, or Enter,
// opens the object. Larger than the wide card; nothing in it is edited (our calls).
import type { MouseEvent } from 'react'
import { api } from '@/api/client'
import type { PropertyType, Row, TypeDef } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { propertyIsEmpty } from '@/properties/format'
import { chipStyle } from '@/theme/palette'
import { displayTitle } from '../filter'
import type { CardProperty } from './cardConfig'
import { CARD_BASE, cardImage, WallCardProperties } from './SmallCard'

/** Kinds the page shows elsewhere (title, icon, description, type, cover), or that don't preview (body, backlinks, button). */
const NOT_ROWS = new Set<PropertyType>([
  'entity_title',
  'entity_icon',
  'entity_description',
  'entity_type',
  'coverImage',
  'blocks',
  'entity_backlinks',
  'button',
])

/** The property rows a page card shows for `row`: the type's, as the page's property panel shows them. */
export function pageCardProperties(type: TypeDef | undefined, row: Row): CardProperty[] {
  const out: CardProperty[] = []
  for (const d of type?.propertyDefinitions ?? []) {
    if (NOT_ROWS.has(d.type) || d.visibility === 'hidden') continue
    const value = d.type === 'entity_tags' ? row.summary.tags : d.type === 'entity_collections' ? row.summary.collections : row.values[d.key]
    if (d.visibility === 'hideWhenEmpty' && propertyIsEmpty(d, value ?? null)) continue
    out.push({ propertyType: d.type, propertyId: d.key })
  }
  return out
}

export function PageCard({ row, type, onOpen }: { row: Row; type?: TypeDef; onOpen?(row: Row, e: MouseEvent): void }) {
  const image = cardImage(row)
  const icon = row.summary.icon ?? type?.icon ?? null
  const props = pageCardProperties(type, row)
  const preview = row.preview?.trim()
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="page-card"
      data-path={row.summary.path}
      onClick={(e) => onOpen?.(row, e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen?.(row, e as unknown as MouseEvent)
      }}
      className={cn(CARD_BASE, 'w-full')}
    >
      {image && <img src={api.fileUrl(image)} alt="" className="h-44 w-full object-cover" />}
      <div className="flex min-w-0 flex-col gap-2 px-6 pt-5 pb-6">
        {type && (
          <span
            data-testid="card-type"
            className="inline-flex max-w-full items-center gap-1 self-start text-[12px] text-[var(--chip-fg)]"
            style={chipStyle(type.color)}
          >
            <IconOrEmoji icon={type.icon} fallback="ph-file-text" size={12} />
            <span className="truncate">{type.name}</span>
          </span>
        )}
        <h3 className="flex min-w-0 items-center gap-2.5 text-[26px] leading-tight font-bold text-fg">
          {icon && (
            <span data-testid="page-card-icon" className="inline-flex shrink-0">
              <IconOrEmoji icon={icon} fallback="ph-file-text" size={28} />
            </span>
          )}
          <span className="min-w-0 break-words">{displayTitle(row)}</span>
        </h3>
        {/* The description (under the title), then one row per property. */}
        <div className="flex max-w-[640px] min-w-0 flex-col gap-1.5">
          <WallCardProperties row={row} type={type} props={props} />
        </div>
        {preview && (
          <p data-testid="page-card-body" className="mt-1 line-clamp-6 whitespace-pre-line text-[15px] leading-relaxed text-fg">
            {preview}
          </p>
        )}
      </div>
    </div>
  )
}
