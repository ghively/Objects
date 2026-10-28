/**
 * The object page's layout, from the type's page settings:
 * - `viewDesign` Standard (`null`): the properties in the left panel (as Capacities' current
 *   object page and the visual reference), the header and body in the content column.
 *   `indexCard`: the properties in a bordered card under the header. `profile`: the cover (or
 *   icon) as a large round image beside the title, the properties in a side column.
 *   `encyclopedia`: the properties in a right-hand infobox next to the body.
 * - `wideLayoutMode` removes the content max-width (Standard only: Capacities' setting "will not
 *   make any difference for encyclopedia, profile, or index card designs").
 * - `font` sets the title and body font family.
 * - The cover image: `wideCoverImage` spans the whole panel, `cropCoverImage` fixes its height.
 * The page and the peek share this layout; the peek is narrower, so its gutters are too.
 *
 * Narrow widths: below the container's md breakpoint (`PROPERTIES_BESIDE_WIDTH`, 768 px) the
 * Standard, Profile and Encyclopedia properties move inline under the header (drawn as the `card`
 * variant). Capacities shows Profile's and Encyclopedia's property sidebar only from md
 * (`PropertiesSidebar`, `isMd`). Whether Capacities' Standard design has a property sidebar at all
 * is open (reference-check section 5): Standard keeps its left panel here until Gene checks.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { api } from '@/api/client'
import type { ObjectSummary, TypeDef, TypeFont } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { CoverImage } from './CoverImage'
import { decodeIcon } from './PropertyPanel'

export type PageDesign = 'standard' | 'indexCard' | 'profile' | 'encyclopedia'

/** Where the property panel sits, and so how it is drawn. */
export type PanelVariant = 'side' | 'card' | 'column' | 'infobox'

/** The Standard left property panel's width (`PropertyPanel`'s `side` variant). */
export const PROPERTY_PANEL_WIDTH = 370
/**
 * The layout width from which the properties sit beside the content: Capacities' container `md`
 * breakpoint (768 px), from which Profile and Encyclopedia show their property sidebar.
 */
export const PROPERTIES_BESIDE_WIDTH = 768

/** The designs whose properties go inline under the header below `PROPERTIES_BESIDE_WIDTH`. */
const INLINE_WHEN_NARROW: readonly PageDesign[] = ['standard', 'profile', 'encyclopedia']

/** Whether a layout `width` px wide (null: not measured yet) has the properties beside the content. */
export function propertiesBeside(width: number | null): boolean {
  return width === null || width >= PROPERTIES_BESIDE_WIDTH
}

/** The layout's width, measured before paint and on every resize (null where it cannot be). */
function useWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      setWidth(w > 0 ? w : null)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

export function pageDesign(type: TypeDef | undefined): PageDesign {
  return type?.viewDesign ?? 'standard'
}

export function panelVariant(design: PageDesign): PanelVariant {
  switch (design) {
    case 'indexCard':
      return 'card'
    case 'profile':
      return 'column'
    case 'encyclopedia':
      return 'infobox'
    default:
      return 'side'
  }
}

const FONT_VAR: Record<TypeFont, string> = {
  'sans-serif': 'var(--object-font-sans-serif)',
  serif: 'var(--object-font-serif)',
  monospace: 'var(--object-font-monospace)',
}

export function fontStyle(font: TypeFont | undefined): CSSProperties {
  return { fontFamily: FONT_VAR[font ?? 'sans-serif'] ?? FONT_VAR['sans-serif'] }
}

export interface PageLayoutProps {
  type?: TypeDef
  summary: ObjectSummary
  /** The object header (type chip, icon, title, description, aliases, tags). */
  header: ReactNode
  /**
   * The property panel, or null when hidden. As a function it is drawn for the variant given:
   * `panelVariant(pageDesign(type))`, or `card` when a narrow Standard layout puts it inline.
   */
  properties: ReactNode | ((variant: PanelVariant) => ReactNode)
  /** The body editor, with any notices above it. */
  body: ReactNode
  mode?: 'page' | 'peek'
  /** The toolbar row above the scrolling content (panel toggle, `…` menu). */
  toolbar?: ReactNode
  /** Writes a new cover image (or `null` to remove it); without it the cover is read-only. */
  onCoverChange?(next: string | null): void
  /** Rendered over the content column (the peek's pager, dialogs). */
  children?: ReactNode
}

function ProfileImage({ summary, type }: { summary: ObjectSummary; type?: TypeDef }) {
  const icon = decodeIcon(summary.icon, summary.iconColor) ?? type?.icon ?? null
  return (
    <div
      data-profile-image=""
      className="flex size-[var(--profile-image-size)] shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-raised"
    >
      {summary.coverImage ? (
        <img src={api.fileUrl(summary.coverImage)} alt="" className="size-full object-cover" />
      ) : (
        <IconOrEmoji icon={icon} size={56} fallback="ph-file-text" />
      )}
    </div>
  )
}

export function PageLayout({
  type,
  summary,
  header,
  properties,
  body,
  mode = 'page',
  toolbar,
  onCoverChange,
  children,
}: PageLayoutProps) {
  const design = pageDesign(type)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const width = useWidth(rootRef)
  const open = properties !== null && properties !== undefined && properties !== false
  const inline = open && INLINE_WHEN_NARROW.includes(design) && !propertiesBeside(width)
  const propertiesEl =
    typeof properties === 'function' ? properties(inline ? 'card' : panelVariant(design)) : properties
  const wide = design === 'standard' && !!type?.wideLayoutMode
  const font = fontStyle(type?.font)
  const cover = design !== 'profile' ? summary.coverImage : null
  const wideCover = !!type?.wideCoverImage
  const crop = type?.cropCoverImage ?? true
  const coverEl = cover ? <CoverImage path={cover} wide={wideCover} crop={crop} onChange={onCoverChange} /> : null
  const gutter = mode === 'peek' ? 'px-10' : 'px-12'
  const headerEl = (
    <div data-page-title="" style={font}>
      {header}
    </div>
  )
  const bodyEl = (
    <div data-page-body="" className="min-w-0 flex-1" style={font}>
      {body}
    </div>
  )

  let content: ReactNode
  switch (design) {
    case 'indexCard':
      content = (
        <>
          {headerEl}
          {propertiesEl && <div data-index-card="">{propertiesEl}</div>}
          {bodyEl}
        </>
      )
      break
    case 'profile':
      content = inline ? (
        <>
          <div data-profile-column="" className="mb-6">
            <ProfileImage summary={summary} type={type} />
          </div>
          {headerEl}
          <div data-properties-inline="">{propertiesEl}</div>
          {bodyEl}
        </>
      ) : (
        <div className="flex gap-10">
          <div data-profile-column="" className="flex w-[var(--profile-column-width)] shrink-0 flex-col gap-6">
            <ProfileImage summary={summary} type={type} />
            {propertiesEl}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {headerEl}
            {bodyEl}
          </div>
        </div>
      )
      break
    case 'encyclopedia':
      content = inline ? (
        <>
          {headerEl}
          <div data-properties-inline="">{propertiesEl}</div>
          {bodyEl}
        </>
      ) : (
        <>
          {headerEl}
          <div className="flex items-start gap-10">
            {bodyEl}
            {propertiesEl}
          </div>
        </>
      )
      break
    default:
      content = (
        <>
          {headerEl}
          {inline && <div data-properties-inline="">{propertiesEl}</div>}
          {bodyEl}
        </>
      )
  }

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 w-full"
      data-page-layout={design}
      data-font={type?.font ?? 'sans-serif'}
      data-properties={inline ? 'inline' : design === 'standard' && open ? 'beside' : undefined}
    >
      {design === 'standard' && !inline && propertiesEl}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {toolbar}
        <div className="min-h-0 flex-1 overflow-auto">
          {coverEl && wideCover && <div className="pt-3">{coverEl}</div>}
          <div
            data-page-content=""
            data-wide={wide ? 'true' : 'false'}
            className={cn(
              'mx-auto w-full pb-24',
              gutter,
              wide ? 'max-w-none' : design === 'standard' ? 'max-w-[var(--page-content-width)]' : 'max-w-[1080px]',
              coverEl && !wideCover ? 'pt-4' : 'pt-10',
            )}
            data-object-path={summary.path}
          >
            {coverEl && !wideCover && <div className="mb-8">{coverEl}</div>}
            {coverEl && wideCover && <div className="h-6" />}
            {content}
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
