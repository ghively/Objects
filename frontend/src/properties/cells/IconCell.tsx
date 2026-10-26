import { useState } from 'react'
import type { Icon as IconValue } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { lineColor } from '@/theme/palette'
import { placeholderFor } from '../format'
import type { CellProps } from './types'

/** The object's icon: an emoji or an Iconify icon (with its colour); a click opens the IconPicker. */
export function IconCell({ def, value, readOnly, density, inTable, onChange }: CellProps<IconValue | null>) {
  const [open, setOpen] = useState(false)
  const shown = value?.val ? (
    <span style={value.type === 'iconify' && value.color ? { color: lineColor(value.color) } : undefined}>
      <IconOrEmoji icon={value} size={18} />
    </span>
  ) : (
    <span className="text-[15px] text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>
  )
  if (readOnly) return <div className="flex items-center py-0.5">{shown}</div>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Edit ${def.name}`} className="flex items-center py-0.5 text-left">
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-line bg-raised p-0 text-fg">
        <IconPicker
          value={value}
          onChange={(next) => {
            onChange(next)
            // Picking a colour keeps the picker open; a new icon or "Remove" closes it.
            if (!next || next.val !== value?.val) setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
