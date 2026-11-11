/**
 * The Mentions tab: objects whose body names this object without linking it, each occurrence with
 * its context (the match highlighted) and a "Link" button. With none, one quiet line says so (M32);
 * with any, they always show (ground rule: unlinked mentions are never removed or hidden). Linking sends the entry's version
 * (`api.linkMention`), then reloads once; a stale version (409) or moved text (422) reloads
 * without retrying.
 */
import { useState } from 'react'
import { api, ApiError, ConflictError } from '@/api/client'
import type { MentionEntry, ObjectSummary } from '@/api/types'
import type { ReloadOptions } from './useReferences'
import { EmptyLine, EntryHeader, HighlightedContext, openReference } from './BacklinksTab'
import { REFERENCES_TEXT } from './referencesUi'

export interface MentionsTabProps {
  /** The mentioned object: the one the references section belongs to. */
  target: string
  entries: MentionEntry[]
  summaries: Record<string, ObjectSummary>
  reload(opts?: ReloadOptions): void
  onToast(message: string): void
}

export function MentionsTab({ target, entries, summaries, reload, onToast }: MentionsTabProps) {
  const [busy, setBusy] = useState(false)

  if (entries.length === 0) return <EmptyLine text={REFERENCES_TEXT.mentionsEmpty} />

  const link = async (entry: MentionEntry, occ: MentionEntry['occurrences'][number]) => {
    if (busy) return
    setBusy(true)
    try {
      await api.linkMention({
        path: entry.path,
        target,
        start: occ.start,
        end: occ.end,
        text: occ.text,
        baseVersion: entry.version,
      })
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
            {entry.occurrences.map((occ) => (
              <div
                key={`${occ.start}:${occ.end}`}
                data-occurrence=""
                className="flex items-start gap-2 rounded-md border border-line px-2 py-1"
              >
                <button
                  type="button"
                  onClick={(e) => openReference(entry.path, e, list)}
                  className="min-w-0 flex-1 text-left text-[14px] leading-6"
                >
                  <HighlightedContext
                    context={occ.context}
                    start={occ.start - occ.contextStart}
                    end={occ.end - occ.contextStart}
                  />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void link(entry, occ)}
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
