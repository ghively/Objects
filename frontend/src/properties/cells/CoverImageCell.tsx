import { useState } from 'react'
import { ImagePicker } from '@/components/ImagePicker'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SpaceImage } from '@/components/SpaceImage'
import { placeholderFor } from '../format'
import type { CellProps } from './types'

/**
 * The cover image: a thumbnail and its file name; a click on the name opens the ImagePicker. The
 * thumbnail sits beside the picker's button, not in it: with "Media loading: Required only" (M31)
 * it is a "Load" button of its own.
 */
export function CoverImageCell({ def, value, readOnly, density, inTable, onChange }: CellProps<string | null>) {
  const [open, setOpen] = useState(false)
  const thumb = value ? <SpaceImage path={value} compact className="h-6 w-10 shrink-0 rounded object-cover" /> : null
  const label = value ? (
    <span className="truncate text-[15px] text-fg">{value.split('/').pop()}</span>
  ) : (
    <span className="text-[15px] text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>
  )
  if (readOnly) {
    return (
      <div className="py-0.5">
        <span className="flex min-w-0 items-center gap-2">
          {thumb}
          {label}
        </span>
      </div>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="flex w-full min-w-0 items-center gap-2 py-0.5">
          {thumb}
          <PopoverTrigger asChild>
            <button type="button" aria-label={`Edit ${def.name}`} className="flex min-w-0 flex-1 text-left">
              {label}
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
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
