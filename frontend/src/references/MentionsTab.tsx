/**
 * The Mentions tab: objects whose body names this object without linking it, each line with its
 * context (the match highlighted) and a "Link" button. With none, one quiet line says so (M32);
 * with any, they always show (ground rule: unlinked mentions are never removed or hidden). Linking sends the entry's version
 * (`api.linkMention`), then reloads once; a stale version (409) or moved text (422) reloads
 * without retrying.
 *
 * M33 (`mentionRows.ts`): the context reads as text (a `[[link]]` shows its words, the line's
 * markers and emphasis marks are not shown, as in a backlink row), and a line that names the
 * object twice is one row with every match highlighted. Its "Link" links every match in the row:
 * one `api.linkMention` per match, the last one first (so the offsets of the ones before it
 * still hold), each on the version the one before answered. If one of them is refused (the file
 * changed in between), the ones already made stay, nothing more is tried, and the reload shows
 * what is still unlinked with its own "Link".
 */
import { Fragment, useState } from 'react'
import { api, ApiError, ConflictError } from '@/api/client'
import type { MentionEntry, ObjectSummary } from '@/api/types'
import type { ReloadOptions } from './useReferences'
import { EmptyLine, EntryHeader, openReference } from './BacklinksTab'
import { mentionRows, rowDisplay, type MentionRow } from './mentionRows'
import { REFERENCES_TEXT } from './referencesUi'

export interface MentionsTabProps {
  /** The mentioned object: the one the references section belongs to. */
  target: string
  entries: MentionEntry[]
  summaries: Record<string, ObjectSummary>
  reload(opts?: ReloadOptions): void
  onToast(message: string): void
}

/** A row's text cut at its matches: what stands before each match, the match, and what follows the last. */
function rowPieces(row: MentionRow): { parts: { before: string; match: string }[]; rest: string } {
  const { text, marks } = rowDisplay(row)
  const parts: { before: string; match: string }[] = []
  let at = 0
  for (const [start, end] of marks) {
    parts.push({ before: text.slice(at, start), match: text.slice(start, end) })
    at = end
  }
  return { parts, rest: text.slice(at) }
}

/** A row's text with every match in bold, through the search-highlight style. */
function RowContext({ row }: { row: MentionRow }) {
  const { parts, rest } = rowPieces(row)
  return (
    <span className="search-highlights whitespace-pre-wrap break-words">
      {parts.map(({ before, match }, i) => (
        <Fragment key={i}>
          {before}
          {match && <b>{match}</b>}
        </Fragment>
      ))}
      {rest}
    </span>
  )
}

export function MentionsTab({ target, entries, summaries, reload, onToast }: MentionsTabProps) {
  const [busy, setBusy] = useState(false)

  if (entries.length === 0) return <EmptyLine text={REFERENCES_TEXT.mentionsEmpty} />

  const link = async (entry: MentionEntry, row: MentionRow) => {
    if (busy) return
    setBusy(true)
    try {
      let version = entry.version
      // The last match first: a link is longer than the name, so it moves only what follows it.
      for (const occ of [...row.occurrences].reverse()) {
        const res = await api.linkMention({
          path: entry.path,
          target,
          start: occ.start,
          end: occ.end,
          text: occ.text,
          baseVersion: version,
        })
        version = res.version
      }
      onToast(REFERENCES_TEXT.linkCreated)
      reload({ absorb: entry.path })
    } catch (err) {
      if (err instanceof ConflictError || (err instanceof ApiError && err.status === 422)) {
        onToast(REFERENCES_TEXT.changedElsewhere)
      } else {
        console.warn('Could not link the mention:', err)
        onToast(REFERENCES_TEXT.linkFailed)
      }
      reload()
    } finally {
      setBusy(false)
    }
  }

  const list = entries.map((e) => e.path)
  return (
    <ul className="flex flex-col gap-3" data-references-list="mentions">
      {entries.map((entry) => (
        <li key={entry.path} data-mention={entry.path} className="flex flex-col gap-1">
          <EntryHeader path={entry.path} summary={summaries[entry.path]} list={list} />
          <div className="flex flex-col gap-1 pl-7">
            {mentionRows(entry.occurrences).map((row) => (
              <div
                key={`${row.occurrences[0].start}:${row.occurrences[row.occurrences.length - 1].end}`}
                data-occurrence=""
                data-occurrences={row.occurrences.length}
                className="flex items-start gap-2 rounded-md border border-line px-2 py-1"
              >
                <button
                  type="button"
                  onClick={(e) => openReference(entry.path, e, list)}
                  className="min-w-0 flex-1 text-left text-[14px] leading-6"
                >
                  <RowContext row={row} />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void link(entry, row)}
                  className="h-6 shrink-0 rounded-md border border-line bg-raised px-2 text-[13px] font-medium hover:bg-hover disabled:opacity-50"
                >
                  {REFERENCES_TEXT.link}
                </button>
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  )
}
