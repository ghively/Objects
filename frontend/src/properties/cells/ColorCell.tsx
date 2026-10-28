import { useState } from 'react'
import { ColorPicker } from '@/components/ColorPicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { colorName, lineColor } from '@/theme/palette'
import { placeholderFor } from '../format'
import type { CellProps } from './types'

/** A Tag object's colour, stored as `bg-<c>`; a click opens the ColorPicker. */
export function ColorCell({ def, value, readOnly, density, inTable, onChange }: CellProps<string | null>) {
  const [open, setOpen] = useState(false)
  const shown = value ? (
    <span className="flex items-center gap-2 text-[15px] text-fg">
      <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: lineColor(value) }} />
      {colorName(value)}
    </span>
  ) : (
    <span className="text-[15px] text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>
  )
  if (readOnly) return <div className="py-0.5">{shown}</div>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Edit ${def.name}`} className="py-0.5 text-left">
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
        <ColorPicker
          value={value}
          onChange={(c) => {
            setOpen(false)
            if (`bg-${c}` !== value) onChange(`bg-${c}`)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
