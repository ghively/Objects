/**
 * The Backlinks tab: one entry per linking object (icon, title, type chip), then the text blocks
 * that link here with the link highlighted ("Mentions in text"), or "via {property}" for a link
 * through a property. A click peeks with the tab's objects as the pager list; Ctrl/Cmd+click
 * opens a new tab. Also holds the entry pieces the other tabs share.
 */
import type { MouseEvent, ReactNode } from 'react'
import type { BacklinkEntry, ObjectSummary } from '@/api/types'
import { stemOf, typeOf, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectIcon } from '@/object/ObjectHeader'
import { TypeChip } from '@/shell/Sidebar'
import { REFERENCES_TEXT, splitAt } from './referencesUi'

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
  useLinkIndex((s) => s.revision) // re-render when types load
  const type = typeOf(summary?.type)
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

export interface BacklinksTabProps {
  entries: BacklinkEntry[]
  summaries: Record<string, ObjectSummary>
}

export function BacklinksTab({ entries, summaries }: BacklinksTabProps) {
  if (entries.length === 0) {
    return <EmptyState title={REFERENCES_TEXT.backlinksEmptyTitle} description={REFERENCES_TEXT.backlinksEmptyDescription} />
  }
  const list = entries.map((e) => e.path)
  return (
    <ul className="flex flex-col gap-3" data-references-list="backlinks">
      {entries.map((entry) => {
        const summary = summaries[entry.path]
        const defs = typeOf(summary?.type)?.propertyDefinitions ?? []
        return (
          <li key={entry.path} data-backlink={entry.path} className="flex flex-col gap-1">
            <EntryHeader path={entry.path} summary={summary} list={list} />
            {entry.contexts.length > 0 && (
              <div className="flex flex-col gap-1 pl-7">
                <span className="text-[12px] text-fg-muted">{REFERENCES_TEXT.mentionsInText}</span>
                {entry.contexts.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    data-backlink-context=""
                    onClick={(e) => openReference(entry.path, e, list)}
                    className="rounded-md border border-line px-2 py-1 text-left text-[14px] leading-6 hover:bg-hover"
                  >
                    <HighlightedContext context={c.context} start={c.start} end={c.end} />
                  </button>
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
    </ul>
  )
}
