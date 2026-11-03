/**
 * The Backlinks tab: one entry per linking object (icon, title, type chip), then the text blocks
 * that link here with the link highlighted ("Mentions in text"), or "via {property}" for a link
 * through a property. A click peeks with the tab's objects as the pager list; Ctrl/Cmd+click
 * opens a new tab. Also holds the entry pieces the other tabs share.
 *
 * M8: a block nested in others (`ancestors` from the server) shows "Only block with backlink" or
 * the "Full path above" (each parent's first line, muted, outermost first) as the setting says;
 * a small two-way toggle on the backlink switches it for that backlink only (our control, not
 * remembered). The block renders in the "Backlink content view": embed (the M5 box, the
 * default), inline (plain text), small card (one line) or wide card (our renderings of the four
 * names; no reference screenshot).
 */
import { useState, type MouseEvent, type ReactNode } from 'react'
import type { BacklinkEntry, BodyContext, ObjectSummary } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { stemOf, typeOf, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectIcon } from '@/object/ObjectHeader'
import { TypeChip } from '@/shell/Sidebar'
import {
  ancestorsOf,
  REFERENCES_TEXT,
  splitAt,
  type BacklinkContentView,
  type NestedBacklinkView,
} from './referencesUi'

type Mods = Pick<MouseEvent, 'ctrlKey' | 'metaKey'>

/** Open a referenced object: the peek (stepping through `list`), or a new tab with Ctrl/Cmd. */
export function openReference(path: string, mods: Mods, list: string[]): void {
  if (mods.ctrlKey || mods.metaKey) useTabs.getState().open({ kind: 'object', path }, { newTab: true })
  else usePeek.getState().peek(path, list)
}

/** `context` with `[start, end)` in bold, through the search-highlight style. */
export function HighlightedContext({ context, start, end }: { context: string; start: number; end: number }) {
  const [before, match, after] = splitAt(context, start, end)
  return (
    <span className="search-highlights whitespace-pre-wrap break-words">
      {before}
      {match && <b>{match}</b>}
      {after}
    </span>
  )
}

/** An entry's header row: the object's icon, title and type chip. */
export function EntryHeader({
  path,
  summary,
  list,
  action,
}: {
  path: string
  summary: ObjectSummary | undefined
  list: string[]
  action?: ReactNode
}) {
  // Only this entry's type (loaded later than the entries, perhaps): not every index revision.
  const type = useLinkIndex((s) => (summary?.type ? s.types.find((t) => t.id === summary.type) : undefined))
  const title = summary?.title || stemOf(path)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        data-reference-path={path}
        onClick={(e) => openReference(path, e, list)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-hover"
      >
        {summary?.icon && <ObjectIcon icon={summary.icon} size={16} />}
        <span className="truncate text-[15px] font-semibold">{title}</span>
        {type && (
          <span className="flex shrink-0 items-center gap-1 text-[13px] text-fg-muted">
            <TypeChip type={type} size={18} />
            {type.name}
          </span>
        )}
      </button>
      {action}
    </div>
  )
}

/** An empty tab: a title and an optional line. */
export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-1 py-3">
      <p className="text-[14px] font-medium text-fg">{title}</p>
      {description && <p className="text-[13px] text-fg-muted">{description}</p>}
    </div>
  )
}

/** Each content view's box (our renderings). */
const VIEW_CLASS: Record<BacklinkContentView, string> = {
  embed: 'rounded-md border border-line px-2 py-1 text-[14px] leading-6',
  inline: 'rounded-md px-1 text-[14px] leading-6',
  smallCard: 'truncate rounded-md bg-hover px-2 py-0.5 text-[13px] leading-5',
  wideCard: 'rounded-lg border border-line bg-raised px-3 py-2 text-[14px] leading-6 shadow-sm',
}

/** One backlink's block, with its parents above when the full path shows. */
export function BacklinkContext({
  context,
  view,
  nestedView,
  onOpen,
  path,
  list,
}: {
  context: BodyContext
  view: BacklinkContentView
  nestedView: NestedBacklinkView
  onOpen(e: MouseEvent): void
  /** The linking object: shows the hover actions. */
  path?: string
  /** The pager list for Expand. */
  list?: string[]
}) {
  const ancestors = ancestorsOf(context)
  const [mode, setMode] = useState<NestedBacklinkView | null>(null)
  const shown = mode ?? nestedView
  const full = ancestors.length > 0 && shown === 'showFullPathAbove'
  const option = (value: NestedBacklinkView, label: string) => (
    <button
      type="button"
      aria-pressed={shown === value}
      data-nested-view={value}
      onClick={() => setMode(value)}
      className={cn('rounded px-1.5 py-0.5', shown === value ? 'bg-hover-2 text-fg' : 'hover:bg-hover')}
    >
      {label}
    </button>
  )
  return (
    <div data-backlink-block="" className="group/ref flex flex-col gap-0.5">
      {ancestors.length > 0 && (
        <div role="group" aria-label={REFERENCES_TEXT.nestedView} className="flex gap-0.5 self-end text-[11px] text-fg-muted">
          {option('showBlockContainingBacklink', REFERENCES_TEXT.showBlockContainingBacklink)}
          {option('showFullPathAbove', REFERENCES_TEXT.showFullPathAbove)}
        </div>
      )}
      {full && (
        <div data-backlink-ancestors="" className="flex flex-col text-[13px] leading-5 text-fg-muted">
          {ancestors.map((line, i) => (
            <span key={i} data-backlink-ancestor="" className="truncate" style={{ paddingLeft: i * 12 }}>
              {line}
            </span>
          ))}
        </div>
      )}
      <div className="flex min-w-0 items-start gap-1.5" style={full ? { marginLeft: ancestors.length * 12 } : undefined}>
        {/* Object marks each embedded reference with a leading dot. */}
        <span data-reference-dot="" aria-hidden className="mt-[9px] size-2 shrink-0 rounded-full border border-fg-muted" />
        <button
          type="button"
          data-backlink-context=""
          data-backlink-view={view}
          onClick={onOpen}
          className={cn('min-w-0 flex-1 text-left hover:bg-hover', VIEW_CLASS[view])}
        >
          <HighlightedContext context={context.context} start={context.start} end={context.end} />
        </button>
        {path && <ReferenceActions path={path} list={list ?? [path]} />}
      </div>
    </div>
  )
}

/** Our string: the hover actions' group name. */
const REFERENCE_ACTIONS = 'Reference actions'

/**
 * The small icons that show while a reference is hovered (Object shows expand, `…` and more;
 * ours: Expand (the peek), "Open in new tab" and "Open in side panel" (`EntityMenu.*` strings).
 */
function ReferenceActions({ path, list }: { path: string; list: string[] }) {
  const action = (label: string, icon: string, run: () => void) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={run}
      className="flex size-6 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
    >
      <Icon name={icon} size={14} />
    </button>
  )
  return (
    <div
      role="group"
      aria-label={REFERENCE_ACTIONS}
      className="flex shrink-0 items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover/ref:opacity-100"
    >
      {action('Expand', 'ph-arrows-out-simple', () => usePeek.getState().peek(path, list))}
      {action('Open in new tab', 'ph-arrow-square-out', () => useTabs.getState().open({ kind: 'object', path }, { newTab: true }))}
      {action('Open in side panel', 'ph-sidebar-simple', () => useTabs.getState().openInSidepanel({ kind: 'object', path }))}
    </div>
  )
}

export interface BacklinksTabProps {
  entries: BacklinkEntry[]
  summaries: Record<string, ObjectSummary>
  /** "Backlink content view" (default embed). */
  view?: BacklinkContentView
  /** "Default display of nested backlinks" (default only the block). */
  nestedView?: NestedBacklinkView
}

/** How many backlinks show at first and how many more each "Load more" adds. */
export const BACKLINKS_PAGE = 50

export function BacklinksTab({
  entries,
  summaries,
  view = 'embed',
  nestedView = 'showBlockContainingBacklink',
}: BacklinksTabProps) {
  // Paged: an object with hundreds of backlinks must not render them all at once (`loadMore`).
  const [shown, setShown] = useState(BACKLINKS_PAGE)
  if (entries.length === 0) {
    return <EmptyState title={REFERENCES_TEXT.backlinksEmptyTitle} description={REFERENCES_TEXT.backlinksEmptyDescription} />
  }
  const list = entries.map((e) => e.path)
  const page = entries.length > shown ? entries.slice(0, shown) : entries
  return (
    <ul className="flex flex-col gap-3" data-references-list="backlinks">
      {page.map((entry) => {
        const summary = summaries[entry.path]
        const defs = typeOf(summary?.type)?.propertyDefinitions ?? []
        return (
          <li key={entry.path} data-backlink={entry.path} className="flex flex-col gap-1">
            <EntryHeader path={entry.path} summary={summary} list={list} />
            {entry.contexts.length > 0 && (
              <div className="flex flex-col gap-1 pl-7">
                <span className="text-[12px] text-fg-muted">{REFERENCES_TEXT.mentionsInText}</span>
                {entry.contexts.map((c, i) => (
                  <BacklinkContext
                    key={i}
                    context={c}
                    view={view}
                    nestedView={nestedView}
                    onOpen={(e) => openReference(entry.path, e, list)}
                    path={entry.path}
                    list={list}
                  />
                ))}
              </div>
            )}
            {entry.properties.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-7 text-[13px] text-fg-muted">
                {entry.properties.map((key) => (
                  <span key={key} data-backlink-property={key}>
                    {REFERENCES_TEXT.via(defs.find((d) => d.key === key)?.name ?? key)}
                  </span>
                ))}
              </div>
            )}
          </li>
        )
      })}
      {entries.length > shown && (
        <li>
          <button
            type="button"
            onClick={() => setShown((n) => n + BACKLINKS_PAGE)}
            className="rounded-md px-2 py-1 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
          >
            {REFERENCES_TEXT.loadMore}
          </button>
        </li>
      )}
    </ul>
  )
}
