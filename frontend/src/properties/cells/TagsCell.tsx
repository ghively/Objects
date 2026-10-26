import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { tagStyle } from '@/theme/palette'
import { placeholderFor } from '../format'
import { TagPicker, tagColor, useTagObjects } from '../TagPicker'
import type { CellProps } from './types'

export interface TagsCellProps extends CellProps<string[] | null> {
  onOpenTag?(name: string): void
}

/** Tags: chips coloured from their Tag objects; "+" opens the TagPicker. */
export function TagsCell({ def, value, readOnly, density, onChange, onOpenTag }: TagsCellProps) {
  const [open, setOpen] = useState(false)
  const tags = useTagObjects()
  const names = value ?? []
  const table = density === 'table'
  return (
    <div className={`group/tags flex items-center gap-1 py-0.5 ${table ? 'flex-nowrap' : 'flex-wrap'}`}>
      {names.map((name) => (
        <span
          key={name}
          className={`inline-flex shrink-0 items-center rounded-md ${table ? 'text-[12px]' : 'text-[13px]'}`}
          style={tagStyle(tagColor(tags, name))}
        >
          <button type="button" onClick={() => onOpenTag?.(name)} className="px-1.5 py-[1px]">
            {name}
          </button>
          {!readOnly && (
            <button
              type="button"
              aria-label={`Remove ${name}`}
              onClick={() => onChange(names.filter((n) => n !== name))}
              className="flex h-4 w-4 items-center justify-center rounded opacity-0 group-hover/tags:opacity-70 hover:opacity-100 focus-visible:opacity-100"
            >
              <Icon name="ph-x" size={10} />
            </button>
          )}
        </span>
      ))}
      {names.length === 0 && readOnly && <span className="text-[15px] text-fg-muted">{placeholderFor(def, density)}</span>}
      {!readOnly && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Edit ${def.name}`}
              className="flex items-center gap-1 rounded px-1 text-[15px] text-fg-muted hover:bg-hover hover:text-fg"
            >
              {names.length === 0 ? placeholderFor(def, density) : <Icon name="ph-plus" size={14} />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto border-line bg-raised p-0 text-fg">
            <TagPicker value={names} onChange={onChange} onOpenTag={onOpenTag} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
