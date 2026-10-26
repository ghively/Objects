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
 */
import type { CSSProperties, ReactNode } from 'react'
import { api } from '@/api/client'
import type { ObjectSummary, TypeDef, TypeFont } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { CoverImage } from './CoverImage'
import { decodeIcon } from './PropertyPanel'

export type PageDesign = 'standard' | 'indexCard' | 'profile' | 'encyclopedia'

/** Where the property panel sits, and so how it is drawn. */
export type PanelVariant = 'side' | 'card' | 'column' | 'infobox'

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
  /** The property panel (drawn for `panelVariant(pageDesign(type))`), or null when hidden. */
  properties: ReactNode
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
          {properties && <div data-index-card="">{properties}</div>}
          {bodyEl}
        </>
      )
      break
    case 'profile':
      content = (
        <div className="flex gap-10">
          <div data-profile-column="" className="flex w-[var(--profile-column-width)] shrink-0 flex-col gap-6">
            <ProfileImage summary={summary} type={type} />
            {properties}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {headerEl}
            {bodyEl}
          </div>
        </div>
      )
      break
    case 'encyclopedia':
      content = (
        <>
          {headerEl}
          <div className="flex items-start gap-10">
            {bodyEl}
            {properties}
          </div>
        </>
      )
      break
    default:
      content = (
        <>
          {headerEl}
          {bodyEl}
        </>
      )
  }

  return (
    <div className="flex h-full min-h-0 w-full" data-page-layout={design} data-font={type?.font ?? 'sans-serif'}>
      {design === 'standard' && properties}
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
