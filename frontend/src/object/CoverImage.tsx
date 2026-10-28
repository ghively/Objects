/**
 * An object's cover image (`coverImage`). `wide` spans the whole panel, otherwise the content
 * width; `crop` fixes the height with `object-fit: cover`, otherwise the image keeps its natural
 * height. Hovering offers "Pick cover image" (the image picker), "Toggle wide cover image",
 * "Reposition cover image" (cropped covers only: the offset moves only a cropped image) and
 * "Remove cover image" (`CoverImageManager.*`).
 *
 * M9 reposition (`RenderCoverImage.*`): the offset is a y percent, 0–100 (default 50), drawn as
 * `object-position: 0% <offset>%`. While repositioning, "Drag image to reposition" shows; a drag
 * sets offset = start − dy / rendered height × 100, clamped; "Save" (or a click outside) writes
 * it, "Cancel" restores. An unmoved save writes nothing (our choice); the offset is rounded to a
 * whole percent (our choice).
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { ImagePicker } from '@/components/ImagePicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/** Reference strings: `CoverImageManager.*`, `RenderCoverImage.*`. */
export const COVER_TEXT = {
  pick: 'Pick cover image',
  remove: 'Remove cover image',
  toggleWide: 'Toggle wide cover image',
  reposition: 'Reposition cover image',
  dragHint: 'Drag image to reposition',
  save: 'Save',
  cancel: 'Cancel',
} as const

/** The default cover offset (centred). */
export const DEFAULT_COVER_OFFSET = 50

export function clampOffset(n: number): number {
  return Math.min(100, Math.max(0, n))
}

export interface CoverImageProps {
  /** The image's space-relative path. */
  path: string
  wide: boolean
  crop: boolean
  /** The y offset in percent (0–100); absent means 50. */
  offset?: number
  /** A new image path, or `null` to remove the cover. Without it the cover is read-only. */
  onChange?(next: string | null): void
  /** "Toggle wide cover image"; without it the button is hidden. */
  onToggleWide?(): void
  /** Writes a repositioned offset; without it "Reposition cover image" is hidden. */
  onOffsetChange?(offset: number): void
}

const ACTION =
  'h-7 rounded-md border border-line bg-raised/90 px-2.5 text-[13px] font-medium text-fg backdrop-blur hover:bg-hover'
const ICON_ACTION =
  'flex size-7 items-center justify-center rounded-md border border-line bg-raised/90 text-fg backdrop-blur hover:bg-hover'

export function CoverImage({ path, wide, crop, offset, onChange, onToggleWide, onOffsetChange }: CoverImageProps) {
  const [picking, setPicking] = useState(false)
  const saved = clampOffset(offset ?? DEFAULT_COVER_OFFSET)
  /** The offset being dragged, or null when not repositioning. */
  const [draft, setDraft] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const draftRef = useRef<number | null>(null)
  draftRef.current = draft
  const repositioning = draft !== null
  const shown = draft ?? saved

  const finish = useCallback(
    (save: boolean) => {
      const value = draftRef.current
      setDraft(null)
      if (save && value !== null) {
        const rounded = Math.round(value)
        if (rounded !== saved) onOffsetChange?.(rounded)
      }
    },
    [saved, onOffsetChange],
  )

  // A click outside the cover saves (`RenderCoverImage`).
  useEffect(() => {
    if (!repositioning) return
    const onDown = (e: PointerEvent | MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) finish(true)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [repositioning, finish])

  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (!repositioning || e.button !== 0) return
    e.preventDefault()
    const height = imgRef.current?.getBoundingClientRect().height ?? 0
    if (height <= 0) return
    const startY = e.clientY
    const start = draftRef.current ?? saved
    const move = (ev: PointerEvent) => setDraft(clampOffset(start - ((ev.clientY - startY) / height) * 100))
    const up = (ev: PointerEvent) => {
      move(ev)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={rootRef}
      data-cover-image=""
      data-wide={wide ? 'true' : 'false'}
      data-crop={crop ? 'true' : 'false'}
      data-repositioning={repositioning ? 'true' : undefined}
      className={cn('group/cover-image relative w-full overflow-hidden', wide ? 'rounded-none' : 'rounded-xl')}
    >
      <img
        ref={imgRef}
        src={api.fileUrl(path)}
        alt=""
        draggable={false}
        onPointerDown={onPointerDown}
        style={crop ? { objectPosition: `0% ${shown}%` } : undefined}
        className={cn(
          'block w-full',
          crop ? 'h-[var(--cover-crop-height)] object-cover' : 'h-auto',
          repositioning && 'cursor-move touch-none select-none',
        )}
      />
      {repositioning ? (
        <>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-md bg-black/60 px-3 py-1.5 text-[13px] font-medium text-white">
              {COVER_TEXT.dragHint}
            </span>
          </div>
          <div className="absolute right-3 bottom-3 flex gap-1">
            <button type="button" className={ACTION} onClick={() => finish(false)}>
              {COVER_TEXT.cancel}
            </button>
            <button type="button" className={ACTION} onClick={() => finish(true)}>
              {COVER_TEXT.save}
            </button>
          </div>
        </>
      ) : (
        onChange && (
          <div
            className={cn(
              'absolute right-3 bottom-3 flex gap-1 opacity-0 transition-opacity group-hover/cover-image:opacity-100 focus-within:opacity-100',
              picking && 'opacity-100',
            )}
          >
            <Popover open={picking} onOpenChange={setPicking}>
              <PopoverTrigger asChild>
                <button type="button" className={ACTION}>
                  {COVER_TEXT.pick}
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
            {onToggleWide && (
              <button
                type="button"
                className={ICON_ACTION}
                aria-label={COVER_TEXT.toggleWide}
                title={COVER_TEXT.toggleWide}
                onClick={onToggleWide}
              >
                <Icon name="ph-arrows-out-line-horizontal" size={15} />
              </button>
            )}
            {onOffsetChange && crop && (
              <button
                type="button"
                className={ICON_ACTION}
                aria-label={COVER_TEXT.reposition}
                title={COVER_TEXT.reposition}
                onClick={() => setDraft(saved)}
              >
                <Icon name="ph-arrows-out-line-vertical" size={15} />
              </button>
            )}
            <button type="button" className={ACTION} onClick={() => onChange(null)}>
              {COVER_TEXT.remove}
            </button>
          </div>
        )
      )}
    </div>
  )
}
