/**
 * The board presentation (M8): "Play" presents the board frame by frame in reading order (else
 * top-to-bottom, left-to-right; `presentationSlides`), fitting each frame in the view, with
 * "Previous page" / "Next page" (`Whiteboard.control.pagePrev/pageNext`) and "Exit presentation"
 * (`FloatingToolbox.presentation.exit`). ArrowRight / ArrowLeft step (also PageDown / PageUp,
 * our choice) and Escape exits. A board without frames is one slide of everything (our choice).
 * The control bar sits bottom centre in place of the toolbox (our choice).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { Slide } from '../readingOrder'
import { WB } from '../strings'

export interface BoardPresentationProps {
  slides: Slide[]
  /** Fit the canvas to a slide. */
  onShow(slide: Slide, index: number): void
  onExit(): void
  initialIndex?: number
}

function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('input, textarea, select, [contenteditable="true"]')
}

export function BoardPresentation({ slides, onShow, onExit, initialIndex = 0 }: BoardPresentationProps) {
  const count = slides.length
  const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, count - 1)))
  const at = Math.max(0, Math.min(index, count - 1))
  const showRef = useRef(onShow)
  const exitRef = useRef(onExit)
  useEffect(() => {
    showRef.current = onShow
    exitRef.current = onExit
  })

  const slide = slides[at]
  const box = slide ? `${slide.box.x},${slide.box.y},${slide.box.width},${slide.box.height}` : ''
  useEffect(() => {
    if (slide) showRef.current(slide, at)
    // Re-fit when the slide (or its frame's box) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, slide?.frameId, box])

  useEffect(() => {
    if (count === 0) exitRef.current()
  }, [count])

  const prev = useCallback(() => setIndex((i) => Math.max(0, Math.min(i, count - 1) - 1)), [count])
  const next = useCallback(() => setIndex((i) => Math.min(count - 1, Math.min(i, count - 1) + 1)), [count])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        exitRef.current()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        e.stopPropagation()
        next()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        e.stopPropagation()
        prev()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [next, prev])

  if (!slide) return null
  return (
    <div
      role="toolbar"
      aria-label={WB.controlPlay.text}
      data-testid="whiteboard-presentation"
      data-slide={at + 1}
      className="flex items-center gap-1 rounded-xl border border-line bg-raised p-1 text-[13px] text-fg shadow-lg"
    >
      <button
        type="button"
        aria-label={WB.controlPagePrev.text}
        title={WB.controlPagePrev.text}
        disabled={at === 0}
        className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
        onClick={prev}
      >
        <Icon name="ph-caret-left" size={18} />
      </button>
      <span className="min-w-12 px-1 text-center text-fg-muted tabular-nums" aria-live="polite">
        {at + 1} / {count}
      </span>
      <button
        type="button"
        aria-label={WB.controlPageNext.text}
        title={WB.controlPageNext.text}
        disabled={at >= count - 1}
        className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
        onClick={next}
      >
        <Icon name="ph-caret-right" size={18} />
      </button>
      {slide.label && <span className="max-w-[240px] truncate px-1">{slide.label}</span>}
      <div aria-hidden className="mx-1 h-5 w-px bg-line" />
      <button
        type="button"
        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-fg-muted hover:bg-hover hover:text-fg"
        onClick={onExit}
      >
        <Icon name="ph-x" size={16} />
        <span>{WB.presentationExit.text}</span>
      </button>
    </div>
  )
}
