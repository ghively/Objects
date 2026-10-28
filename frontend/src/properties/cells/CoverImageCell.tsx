import { useState } from 'react'
import { api } from '@/api/client'
import { ImagePicker } from '@/components/ImagePicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { placeholderFor } from '../format'
import type { CellProps } from './types'

/** The cover image: a thumbnail and its file name; a click opens the ImagePicker. */
export function CoverImageCell({ def, value, readOnly, density, inTable, onChange }: CellProps<string | null>) {
  const [open, setOpen] = useState(false)
  const shown = value ? (
    <span className="flex min-w-0 items-center gap-2">
      <img src={api.fileUrl(value)} alt="" className="h-6 w-10 shrink-0 rounded object-cover" />
      <span className="truncate text-[15px] text-fg">{value.split('/').pop()}</span>
    </span>
  ) : (
    <span className="text-[15px] text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>
  )
  if (readOnly) return <div className="py-0.5">{shown}</div>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Edit ${def.name}`} className="flex w-full min-w-0 py-0.5 text-left">
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-line bg-raised p-0 text-fg">
        <ImagePicker
          value={value}
          onChange={(next) => {
            onChange(next)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
