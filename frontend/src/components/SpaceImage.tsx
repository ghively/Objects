/**
 * M31 "Media loading" and "Clear media cache" outside the editor's media blocks.
 *
 * - `MediaPlaceholder`: the one "Required only" placeholder, a box with "Load" that the media
 *   blocks (`editor/media/MediaView.tsx`), covers, cards, image property cells and whiteboard media
 *   show until clicked. The full one names the file and says why it isn't shown; the compact one
 *   (small pictures: small and wide cards, profile pictures, a property cell's thumbnail) is just
 *   "Load" in the picture's box, with the reason as its tooltip (our call).
 * - `useFileUrl`: a space file's URL that follows the media token, so a shown file reloads when
 *   the cache is cleared.
 * - `SpaceImage`: an `<img>` of a space file, behind the placeholder while "Required only" is on.
 *
 * Load never opens what the picture sits in (a card, a cell's picker, a whiteboard drag).
 */
import { useState, type ImgHTMLAttributes, type Ref, type SyntheticEvent } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { MEDIA_TEXT, useMediaOnRequest, useMediaToken, withMediaToken } from '@/settings/mediaLoading'

const stop = (e: SyntheticEvent) => e.stopPropagation()

export interface MediaPlaceholderProps {
  /** The file's name (the full placeholder's first line). */
  name: string
  /** The kind's icon (full placeholder). */
  icon?: string
  onLoad(): void
  /** "Load" alone in the picture's box (`className` sizes the box). */
  compact?: boolean
  className?: string
}

export function MediaPlaceholder({ name, icon = 'ph-image', onLoad, compact, className }: MediaPlaceholderProps) {
  const button = (
    <button
      type="button"
      contentEditable={false}
      title={compact ? `${name}: ${MEDIA_TEXT.notLoaded}` : undefined}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onLoad()
      }}
      onPointerDown={stop}
      onMouseDown={stop}
      onKeyDown={stop}
      className={cn(
        'nodrag shrink-0 rounded-md border border-line bg-raised font-medium text-fg hover:bg-hover',
        compact ? 'px-1.5 py-0.5 text-[12px]' : 'px-2.5 py-1 text-[13px]',
      )}
    >
      {MEDIA_TEXT.load}
    </button>
  )
  if (compact) {
    return (
      <div
        data-testid="media-placeholder"
        data-compact=""
        className={cn('flex items-center justify-center overflow-hidden border border-dashed border-line bg-raised/50', className)}
      >
        {button}
      </div>
    )
  }
  return (
    <div
      data-testid="media-placeholder"
      className={cn('flex items-center gap-3 rounded-lg border border-dashed border-line px-3 py-2.5 text-[13px]', className)}
    >
      <Icon name={icon} size={18} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-fg">{name}</div>
        <div className="text-fg-muted">{MEDIA_TEXT.notLoaded}</div>
      </div>
      {button}
    </div>
  )
}

/** A space file's URL (`api.fileUrl`) with the current media token, re-rendering when it changes. */
export function useFileUrl(path: string): string {
  const token = useMediaToken()
  return withMediaToken(api.fileUrl(path), token)
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

export interface SpaceImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** The image's space-relative path. */
  path: string
  /** "Required only": the compact placeholder (small pictures). */
  compact?: boolean
  ref?: Ref<HTMLImageElement>
}

/**
 * An image from the space. With "Media loading: Required only" it is a placeholder with "Load" in
 * the image's box (`className`) until clicked; the full placeholder sits centred in it.
 */
export function SpaceImage({ path, compact, className, alt = '', ref, ...img }: SpaceImageProps) {
  const url = useFileUrl(path)
  const onRequest = useMediaOnRequest()
  const [asked, setAsked] = useState(false)
  if (onRequest && !asked) {
    const load = () => setAsked(true)
    if (compact) return <MediaPlaceholder compact name={baseName(path)} onLoad={load} className={className} />
    return (
      <div className={cn(className, 'flex items-center justify-center p-3')}>
        <MediaPlaceholder name={baseName(path)} onLoad={load} className="w-full max-w-md bg-raised/80" />
      </div>
    )
  }
  return <img ref={ref} src={url} alt={alt} className={className} {...img} />
}
