/**
 * The frame around a media block or an embedded object: a right-edge drag handle that writes `width` on release,
 * an optional bottom handle that writes `height` (PDF), the alignment buttons
 * "Align left" / "Align center" / "Align right" (left
 * removes `align`), and "Add caption" / "Remove caption" with the
 * placeholder "Caption..." (writing `caption`).
 *
 * Nothing is written while dragging; the live size is local state until the
 * pointer goes up, so one drag is one option change (one undo step).
 *
 * Also `EmbedMenu`, the block's `…` menu (shared by the media, web link and
 * object embed views).
 */
import { AlignCenter, AlignLeft, AlignRight, Captions, CaptionsOff, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Resizer } from '@/shell/Resizer'
import type { Option } from '../annotations'

export type EmbedAlign = 'left' | 'center' | 'right'

/** The smallest width or height a drag can leave (our value). */
export const MIN_EMBED_SIZE = 48

export function optionOf(options: readonly Option[] | null | undefined, key: string): string | true | undefined {
  return (options ?? []).find((o) => o.key === key)?.value
}

/** M32: a frame narrower than this has its hover toolbar beside it (over it, the toolbar would cover a small picture). */
export const NARROW_EMBED_WIDTH = 180

/** A positive integer option (`width`, `height`), or undefined. */
export function sizeOption(options: readonly Option[] | null | undefined, key: string): number | undefined {
  const v = optionOf(options, key)
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return undefined
  const n = Number(v)
  return n > 0 ? n : undefined
}

export function alignOption(options: readonly Option[] | null | undefined): EmbedAlign {
  const v = optionOf(options, 'align')
  return v === 'center' || v === 'right' ? v : 'left'
}

export interface ResizableEmbedProps {
  options: readonly Option[] | null | undefined
  editable: boolean
  /** Write one option on the block (`null` removes it). */
  setOption(key: string, value: string | null): void
  /** A right-edge handle writing `width` (image, PDF, video, object embed). */
  resizeWidth?: boolean
  /** The alignment buttons (image, PDF, video, object embed). */
  alignable?: boolean
  /** The caption (image, PDF, video, audio, file). */
  captionable?: boolean
  /** A bottom handle writing `height`, starting from this default (PDF). */
  resizeHeight?: number
  /** Extra toolbar content (the `…` menu). */
  menu?: ReactNode
  /**
   * M32: the content's own width in CSS pixels (an image's, once it has loaded). With no `width`
   * option the frame takes it, so a small picture is not stretched to the text column; the column
   * still caps a wide one. Never written to the file.
   */
  naturalWidth?: number | null
  /** The frame's body; a function gets the live height while a bottom drag is under way. */
  children: ReactNode | ((size: { height?: number }) => ReactNode)
  className?: string
}

export function ResizableEmbed({
  options,
  editable,
  setOption,
  resizeWidth,
  alignable,
  captionable,
  resizeHeight,
  menu,
  naturalWidth,
  children,
  className,
}: ResizableEmbedProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const width = sizeOption(options, 'width')
  const height = sizeOption(options, 'height') ?? resizeHeight
  const align = alignOption(options)
  const captionValue = optionOf(options, 'caption')
  const caption = typeof captionValue === 'string' ? captionValue : null

  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const [liveHeight, setLiveHeight] = useState<number | null>(null)
  const startWidth = useRef(0)

  const [captionOpen, setCaptionOpen] = useState(false)
  const [draft, setDraft] = useState(caption ?? '')
  const captionRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setDraft(caption ?? '')
  }, [caption])
  useEffect(() => {
    if (captionOpen) captionRef.current?.focus()
  }, [captionOpen])

  const widthFor = (delta: number) =>
    Math.max(MIN_EMBED_SIZE, Math.round(startWidth.current + delta * (align === 'center' ? 2 : 1)))
  const heightFor = (delta: number) => Math.max(MIN_EMBED_SIZE, Math.round((height ?? 0) + delta))

  const commitCaption = () => {
    const text = draft.trim()
    setCaptionOpen(false)
    if (text === (caption ?? '')) return
    setOption('caption', text ? draft : null)
  }

  const showCaption = captionable && (caption !== null || captionOpen)
  const w = liveWidth ?? width
  const h = liveHeight ?? height
  // M32: with no width set, the content's own (never upscaled).
  const natural = w === undefined && naturalWidth && naturalWidth > 0 ? Math.round(naturalWidth) : undefined
  const shown = w ?? natural

  return (
    <div
      className={`resizable-embed${className ? ` ${className}` : ''}`}
      data-align={align}
      data-testid="resizable-embed"
    >
      <div
        ref={frameRef}
        className="resizable-embed-frame"
        style={shown ? { width: `${shown}px`, maxWidth: '100%' } : undefined}
        data-width={w ?? undefined}
        data-natural={natural ? '' : undefined}
        data-narrow={shown && shown < NARROW_EMBED_WIDTH ? '' : undefined}
      >
        {typeof children === 'function' ? children({ height: h }) : children}
        {editable && (alignable || captionable || menu) && (
          <div className="resizable-embed-toolbar" contentEditable={false}>
            {alignable &&
              (
                [
                  ['left', 'Align left', AlignLeft],
                  ['center', 'Align center', AlignCenter],
                  ['right', 'Align right', AlignRight],
                ] as const
              ).map(([value, label, IconC]) => (
                <button
                  key={value}
                  type="button"
                  className="resizable-embed-btn"
                  aria-label={label}
                  title={label}
                  aria-pressed={align === value}
                  onClick={() => {
                    if (align !== value) setOption('align', value === 'left' ? null : value)
                  }}
                >
                  <IconC size={14} />
                </button>
              ))}
            {captionable &&
              (caption !== null ? (
                <button
                  type="button"
                  className="resizable-embed-btn"
                  aria-label="Remove caption"
                  title="Remove caption"
                  onClick={() => {
                    setCaptionOpen(false)
                    setOption('caption', null)
                  }}
                >
                  <CaptionsOff size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  className="resizable-embed-btn"
                  aria-label="Add caption"
                  title="Add caption"
                  onClick={() => setCaptionOpen(true)}
                >
                  <Captions size={14} />
                </button>
              ))}
            {menu}
          </div>
        )}
        {editable && resizeWidth && (
          <div
            className="resizable-embed-handle-x"
            contentEditable={false}
            onPointerDownCapture={() => {
              // The width on screen (a wide picture is capped by the column), else the content's own.
              startWidth.current = width ?? (Math.round(frameRef.current?.getBoundingClientRect().width ?? 0) || natural || 0)
            }}
          >
            <Resizer
              direction="x"
              label="Resize width"
              onDrag={(d) => setLiveWidth(widthFor(d))}
              onEnd={(d) => {
                const next = widthFor(d)
                setLiveWidth(null)
                if (d !== 0 && next !== width) setOption('width', String(next))
              }}
              className="h-full w-1.5"
            />
          </div>
        )}
        {editable && resizeHeight !== undefined && (
          <div className="resizable-embed-handle-y" contentEditable={false}>
            <Resizer
              direction="y"
              label="Resize height"
              onDrag={(d) => setLiveHeight(heightFor(d))}
              onEnd={(d) => {
                const next = heightFor(d)
                setLiveHeight(null)
                if (d !== 0 && next !== sizeOption(options, 'height')) setOption('height', String(next))
              }}
              className="h-1.5 w-full"
            />
          </div>
        )}
      </div>
      {showCaption &&
        (editable ? (
          <input
            ref={captionRef}
            className="resizable-embed-caption"
            aria-label="Caption"
            placeholder="Caption..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitCaption}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft(caption ?? '')
                setCaptionOpen(false)
              }
            }}
          />
        ) : (
          <div className="resizable-embed-caption">{caption}</div>
        ))}
    </div>
  )
}

export interface EmbedMenuItem {
  label: string
  onSelect(): void
  /** Rows nested under a heading (the "Change Block View" list). */
  children?: { label: string; checked?: boolean; onSelect(): void }[]
}

/** The block's `…` menu. */
export function EmbedMenu({ items, label = 'Block menu' }: { items: EmbedMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="resizable-embed-btn" aria-label={label} title={label}>
          <MoreHorizontal size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="embed-menu w-56 border-line bg-raised p-1" role="menu">
        {items.map((item) =>
          item.children ? (
            <div key={item.label} role="group" aria-label={item.label}>
              <div className="embed-menu-heading">{item.label}</div>
              {item.children.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  role="menuitemradio"
                  aria-checked={!!c.checked}
                  className="embed-menu-item"
                  onClick={() => {
                    setOpen(false)
                    c.onSelect()
                  }}
                >
                  <span className="flex-1">{c.label}</span>
                  {c.checked && <span aria-hidden>✓</span>}
                </button>
              ))}
            </div>
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="embed-menu-item"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ),
        )}
      </PopoverContent>
    </Popover>
  )
}
