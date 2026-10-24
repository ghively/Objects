import { useState } from 'react'
import type { DateValue } from '@/api/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DatePicker } from '../DatePicker'
import { formatDate, placeholderFor } from '../format'
import type { CellProps } from './types'

/** A date, a time or a range (`datetime`, `datetimeSimple`); a click opens the DatePicker. */
export function DateCell({ def, value, readOnly, onChange }: CellProps<DateValue | null>) {
  const [open, setOpen] = useState(false)
  const text = formatDate(value)
  const shown = text ? (
    <span className="text-fg">{text}</span>
  ) : (
    <span className="text-fg-muted">{placeholderFor(def)}</span>
  )
  if (readOnly) return <p className="text-[15px]">{shown}</p>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Edit ${def.name}`} className="w-full text-left text-[15px]">
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-line bg-raised p-0 text-fg">
        <DatePicker
          value={value}
          constraints={def.options.constraints}
          onChange={(next) => {
            onChange(next)
            if (next === null) setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
