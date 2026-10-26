/**
 * An object's cover image (`coverImage`). `wide` spans the whole panel, otherwise the content
 * width; `crop` fixes the height with `object-fit: cover`, otherwise the image keeps its natural
 * height. Hovering offers "Change" (the image picker) and "Remove".
 */
import { useState } from 'react'
import { api } from '@/api/client'
import { ImagePicker } from '@/components/ImagePicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface CoverImageProps {
  /** The image's space-relative path. */
  path: string
  wide: boolean
  crop: boolean
  /** A new image path, or `null` to remove the cover. Without it the cover is read-only. */
  onChange?(next: string | null): void
}

const ACTION =
  'h-7 rounded-md border border-line bg-raised/90 px-2.5 text-[13px] font-medium text-fg backdrop-blur hover:bg-hover'

export function CoverImage({ path, wide, crop, onChange }: CoverImageProps) {
  const [picking, setPicking] = useState(false)
  return (
    <div
      data-cover-image=""
      data-wide={wide ? 'true' : 'false'}
      data-crop={crop ? 'true' : 'false'}
      className={cn('group/cover-image relative w-full overflow-hidden', wide ? 'rounded-none' : 'rounded-xl')}
    >
      <img
        src={api.fileUrl(path)}
        alt=""
        className={cn('block w-full', crop ? 'h-[var(--cover-crop-height)] object-cover' : 'h-auto')}
      />
      {onChange && (
        <div
          className={cn(
            'absolute right-3 bottom-3 flex gap-1 opacity-0 transition-opacity group-hover/cover-image:opacity-100 focus-within:opacity-100',
            picking && 'opacity-100',
          )}
        >
          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger asChild>
              <button type="button" className={ACTION}>
                Change
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto border-line bg-raised p-0 text-fg">
              <ImagePicker
                value={path}
                onChange={(next) => {
                  setPicking(false)
                  if (next !== path) onChange(next)
                }}
              />
            </PopoverContent>
          </Popover>
          <button type="button" className={ACTION} onClick={() => onChange(null)}>
            Remove
          </button>
        </div>
      )}
    </div>
  )
}
