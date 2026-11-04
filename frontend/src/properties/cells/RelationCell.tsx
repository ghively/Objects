import { useState } from 'react'
import type { EntityRef } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { summaryOf, typeOf, useLinkIndex } from '@/links/linkIndex'
import { chipStyle, tagStyle, themeColor } from '@/theme/palette'
import { placeholderFor } from '../format'
import { isTagType, RelationPicker } from '../RelationPicker'
import type { CellProps } from './types'

export interface RelationCellProps extends CellProps<EntityRef[] | null> {
  /** Opens a linked object (a click on its chip). */
  onOpenObject?(path: string): void
  /** "Edit Property" in the picker: opens the property's settings. */
  onOpenSettings?(): void
}

/**
 * A relation (`entity`): chips of the linked objects; a click on the cell opens the RelationPicker.
 * A linked Tag object (Object -> Tag "Status" or "Category", item 22) is a chip in the
 * tag's own colour, like its tag chips.
 */
export function RelationCell({ def, value, readOnly, density, inTable, onChange, onOpenObject, onOpenSettings }: RelationCellProps) {
  const [open, setOpen] = useState(false)
  // Re-render when summaries load or change.
  useLinkIndex((s) => s.revision)
  const refs = value ?? []
  const table = density === 'table'
  const chips = refs.map((ref, i) => {
    const summary = ref.path ? summaryOf(ref.path) : undefined
    const type = typeOf(summary?.type)
    const title = summary?.title ?? ref.target
    const tag = !!ref.path && isTagType(type)
    return (
      <span
        key={`${ref.path ?? ref.target}-${i}`}
        data-tag-chip={tag ? themeColor(summary?.color) : undefined}
        onClick={(e) => {
          if (!ref.path || !onOpenObject) return
          e.stopPropagation()
          onOpenObject(ref.path)
        }}
        className={`inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-[1px] ${table ? 'shrink-0 text-[12px]' : 'text-[13px]'} ${
          !ref.path ? 'text-fg-muted line-through' : tag ? '' : 'bg-[var(--chip-bg)] text-[var(--chip-fg)]'
        }`}
        style={tag ? tagStyle(summary?.color) : chipStyle(type?.color)}
      >
        {ref.path && !tag && <IconOrEmoji icon={summary?.icon ?? type?.icon ?? null} size={12} fallback="ph-file-text" />}
        <span className="truncate">{title}</span>
      </span>
    )
  })
  const shown =
    chips.length > 0 ? (
      <span className={table ? 'flex flex-nowrap gap-1' : 'flex flex-wrap gap-1'}>{chips}</span>
    ) : (
      <span className="text-[15px] text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>
    )
  if (readOnly) return <div className="py-0.5">{shown}</div>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Edit ${def.name}`} className="w-full py-0.5 text-left">
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-line bg-raised p-0 text-fg">
        <RelationPicker
          def={def}
          value={refs}
          onChange={onChange}
          onClose={() => setOpen(false)}
          onOpenSettings={
            onOpenSettings &&
            (() => {
              setOpen(false)
              onOpenSettings()
            })
          }
        />
      </PopoverContent>
    </Popover>
  )
}
