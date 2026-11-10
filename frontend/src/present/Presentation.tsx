/**
 * The full-screen presentation of one object (`usePresentation().path`). Mounted once in
 * `shell/GlobalOverlays.tsx`.
 *
 * Slides come from `slides.ts`: the title slide (title, cover image unless "Hide cover image",
 * description, the visible properties) and the body cut at top-level H1/H2 headings and
 * horizontal lines, each shown in a read-only editor (nothing is ever saved from here). The header
 * carries the title (content slides, unless "Hide title in header"), "Presentation settings" and
 * "Exit presentation"; the progress bar runs along the top unless "Hide progress indicator"; the
 * footer has the left and right footer texts, "Previous slide", the slide number and "Next slide".
 * The window goes full screen when the browser allows it; leaving full screen ends the presentation.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { ObjectDetail, TypeDef } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { Editor } from '@/editor/Editor'
import { useLinkIndex } from '@/links/linkIndex'
import { cellValue, propertyRows } from '@/object/PropertyPanel'
import { cellForDef } from '@/properties/cellFor'
import { propertyIsEmpty } from '@/properties/format'
import { kindIcon } from '@/properties/kinds'
import { PresentationSettings, usePresentationPrefs } from './PresentationSettings'
import { useOpenPresentationShortcut, usePresentingShortcuts } from './shortcuts'
import { buildSlides, type Slide } from './slides'
import { usePresentation } from './usePresentation'

export const PRESENTATION_TEXT = {
  exit: 'Exit presentation',
  next: 'Next slide',
  previous: 'Previous slide',
  slideNumber: 'Slide number',
  /** Our string: the dialog's accessible name. */
  label: 'Presentation',
  /** Our string: the object could not be read. */
  loadFailed: 'This object could not be opened.',
} as const

const noop = () => undefined

function settingsOpen(): boolean {
  return !!document.querySelector('[data-presentation-settings-content]')
}

function useFullscreen(active: boolean, onLeft: () => void) {
  const entered = useRef(false)
  const left = useRef(onLeft)
  left.current = onLeft
  useEffect(() => {
    if (!active) return
    const root = document.documentElement
    if (typeof root.requestFullscreen === 'function' && !document.fullscreenElement) {
      root
        .requestFullscreen()
        .then(() => {
          entered.current = true
        })
        .catch(() => undefined)
    }
    const onChange = () => {
      if (entered.current && !document.fullscreenElement) {
        entered.current = false
        left.current()
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (entered.current && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        entered.current = false
        void document.exitFullscreen().catch(() => undefined)
      }
    }
  }, [active])
}

/**
 * The title slide's properties: the type's visible ones with a value (hidden and empty ones are
 * left out on a slide: our choice), each drawn by its read-only cell.
 */
function TitleProperties({ detail, type }: { detail: ObjectDetail; type?: TypeDef }) {
  const { frontmatter, links, summary, backlinks, computed, synced } = detail
  const rows = propertyRows(type, frontmatter)
    .filter((d) => d.type !== 'entity_title' && d.visibility !== 'hidden')
    .map((def) => ({ def, value: cellValue(def, frontmatter, links, summary, backlinks ?? [], computed, synced) }))
    .filter(({ def, value }) => !propertyIsEmpty(def, value))
  if (!rows.length) return null
  return (
    <dl data-slide-properties="" className="grid grid-cols-[minmax(120px,max-content)_1fr] items-start gap-x-6 gap-y-3">
      {rows.map(({ def, value }) => {
        const Cell = cellForDef(def)
        return (
          <div key={def.id} data-property-row={def.name} className="contents">
            <dt className="flex items-center gap-2 text-[15px] font-medium text-fg-muted">
              <IconOrEmoji icon={def.icon ?? kindIcon(def.type)} size={16} />
              {def.name}
            </dt>
            <dd className="min-w-0">
              {Cell ? (
                <Cell def={def} value={value} readOnly onChange={noop} frontmatter={frontmatter} typeId={type?.id ?? summary.type} />
              ) : null}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

function TitleSlide({ detail, hideCover }: { detail: ObjectDetail; hideCover: boolean }) {
  const types = useLinkIndex((s) => s.types)
  const type = types.find((t) => t.id === detail.summary.type)
  const { summary } = detail
  return (
    <div data-slide-kind="title" className="flex flex-col gap-6">
      {!hideCover && summary.coverImage && (
        <img
          data-slide-cover=""
          src={api.fileUrl(summary.coverImage)}
          alt=""
          className="max-h-[40vh] w-full rounded-xl object-cover"
        />
      )}
      <h1 className="text-[44px] leading-tight font-bold text-fg">{summary.title}</h1>
      {summary.description && <p className="text-[20px] text-fg-muted">{summary.description}</p>}
      <TitleProperties detail={detail} type={type} />
    </div>
  )
}

function ContentSlide({ detail, slide, index }: { detail: ObjectDetail; slide: Extract<Slide, { kind: 'content' }>; index: number }) {
  return (
    <div data-slide-kind="content" className="text-[1.15rem]">
      <Editor
        key={index}
        path={detail.summary.path}
        body={slide.body}
        version={detail.version}
        readOnly
        onSaved={noop}
        onConflict={noop}
      />
    </div>
  )
}

function PresentationView({ path }: { path: string }) {
  const slide = usePresentation((s) => s.slide)
  const prefs = usePresentationPrefs()
  const [detail, setDetail] = useState<ObjectDetail | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setDetail(null)
    setFailed(false)
    api
      .object(path)
      .then((d) => live && setDetail(d))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [path])

  const slides = useMemo(() => (detail ? buildSlides(detail.body) : []), [detail])
  useEffect(() => {
    if (slides.length) usePresentation.getState().setCount(slides.length)
  }, [slides.length])

  const exit = () => usePresentation.getState().stop()
  usePresentingShortcuts({
    exit: () => {
      if (!settingsOpen()) exit()
    },
    next: () => usePresentation.getState().next(),
    previous: () => usePresentation.getState().previous(),
  })
  useFullscreen(true, exit)

  const count = slides.length
  const index = count ? Math.min(slide, count - 1) : 0
  const current = slides[index]
  const showTitle = !!detail && !prefs.hideTitle && current?.kind === 'content'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={PRESENTATION_TEXT.label}
      data-presentation=""
      className="fixed inset-0 z-50 flex flex-col bg-app text-fg"
    >
      {!prefs.hideProgressIndicator && (
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={Math.max(1, count)}
          aria-valuenow={index + 1}
          className="h-1 w-full shrink-0 bg-line"
        >
          <div className="h-full bg-fg transition-[width]" style={{ width: count ? `${((index + 1) / count) * 100}%` : '0%' }} />
        </div>
      )}
      <header className="flex h-14 shrink-0 items-center gap-2 px-6">
        <div data-presentation-title="" className="min-w-0 flex-1 truncate text-[15px] font-medium text-fg-muted">
          {showTitle ? detail.summary.title : null}
        </div>
        <PresentationSettings />
        <button
          type="button"
          aria-label={PRESENTATION_TEXT.exit}
          title={PRESENTATION_TEXT.exit}
          onClick={exit}
          className="flex size-8 items-center justify-center rounded-md hover:bg-hover"
        >
          <Icon name="ph-x" size={18} />
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[960px] flex-col justify-center px-12 py-10">
          {failed && <p role="alert">{PRESENTATION_TEXT.loadFailed}</p>}
          {detail && current?.kind === 'title' && <TitleSlide detail={detail} hideCover={prefs.hideCoverImage} />}
          {detail && current?.kind === 'content' && <ContentSlide detail={detail} slide={current} index={index} />}
        </div>
      </main>
      <footer className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 text-[14px] text-fg-muted">
        <div data-footer="left" className="truncate">
          {prefs.footerLeft}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={PRESENTATION_TEXT.previous}
            title={PRESENTATION_TEXT.previous}
            disabled={index <= 0}
            onClick={() => usePresentation.getState().previous()}
            className="flex size-8 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40"
          >
            <Icon name="ph-caret-left" size={18} />
          </button>
          <span aria-label={PRESENTATION_TEXT.slideNumber} title={PRESENTATION_TEXT.slideNumber} className="min-w-12 text-center tabular-nums">
            {count ? `${index + 1} / ${count}` : ''}
          </span>
          <button
            type="button"
            aria-label={PRESENTATION_TEXT.next}
            title={PRESENTATION_TEXT.next}
            disabled={index >= count - 1}
            onClick={() => usePresentation.getState().next()}
            className="flex size-8 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40"
          >
            <Icon name="ph-caret-right" size={18} />
          </button>
        </div>
        <div data-footer="right" className="truncate text-right">
          {prefs.footerRight}
        </div>
      </footer>
    </div>
  )
}

export function Presentation() {
  const path = usePresentation((s) => s.path)
  useOpenPresentationShortcut()
  return path ? <PresentationView key={path} path={path} /> : null
}

export default Presentation
