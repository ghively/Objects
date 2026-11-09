/**
 * M18: an agent's History (its ledger, newest first), shared by the Memory tab and the Skills tab.
 * Each row shows the change's line, its time and who made it, with Undo. Undo calls the route;
 * a refusal (409: the file changed again since) shows in the row. Highlighted rows (from a chat's
 * "Learning" line) are marked and scrolled into view. "Show more" pages back with `before`. The
 * list reloads on `agentLearning` events for the agent. Reading the ledger writes nothing.
 *
 * `query.target` may name several targets joined by commas (the Memory tab's "memory,user"): the
 * route takes one, so each is read and the pages merged, newest first.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, ConflictError, RESYNC_PATH } from '@/api/client'
import type { LedgerSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LEARNING_TEXT as T, learningDate } from './learningText'

/** Rows per page (our number). */
export const LEDGER_PAGE = 20

export interface LedgerListProps {
  agentId: string
  query: { target?: string; skill?: string; run?: string }
  highlight?: string[]
  readOnly?: boolean
  /** Bumped by the owner after its own write: this window's own events don't come back to it. */
  reloadKey?: number
}

interface Page {
  entries: LedgerSummary[]
  more: boolean
}

function newestFirst(a: LedgerSummary, b: LedgerSummary): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

async function fetchPage(agentId: string, query: LedgerListProps['query'], before?: string): Promise<Page> {
  const targets = query.target ? query.target.split(',').filter(Boolean) : [undefined]
  const pages = await Promise.all(
    targets.map((target) => api.agentLedger(agentId, { ...query, target, limit: LEDGER_PAGE, before })),
  )
  if (pages.length === 1) return pages[0]
  const seen = new Set<string>()
  const merged = pages
    .flatMap((p) => p.entries)
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort(newestFirst)
  return {
    entries: merged.slice(0, LEDGER_PAGE),
    more: merged.length > LEDGER_PAGE || pages.some((p) => p.more),
  }
}

function message(e: unknown): string {
  if (e instanceof ConflictError) return T.undoConflict
  if (e instanceof ApiError || e instanceof Error) return e.message
  return String(e)
}

export function LedgerList({ agentId, query, highlight, readOnly, reloadKey }: LedgerListProps) {
  const [entries, setEntries] = useState<LedgerSummary[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  /** Pages shown ("Show more" adds one); a reload reads as many. */
  const pages = useRef(1)
  const { target, skill, run } = query

  const load = useCallback(async () => {
    try {
      // A reload keeps as many pages as were shown.
      const q = { target, skill, run }
      let page = await fetchPage(agentId, q)
      let all = page.entries
      for (let n = 1; n < pages.current && page.more && all.length > 0; n++) {
        page = await fetchPage(agentId, q, all[all.length - 1].id)
        all = [...all, ...page.entries]
      }
      setEntries(all)
      setMore(page.more)
      setError(null)
    } catch (e) {
      setError(message(e))
    }
  }, [agentId, target, skill, run])

  useEffect(() => {
    let live = true
    const reload = () => {
      if (live) void load()
    }
    reload()
    const off = api.onChange((e) => {
      if (e.kind === 'agentLearning' && (e.path === agentId || e.path === RESYNC_PATH)) reload()
    })
    return () => {
      live = false
      off()
    }
  }, [load, agentId, reloadKey])

  const marked = highlight ?? []
  const markedKey = marked.join(',')
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!markedKey || !listRef.current) return
    const first = listRef.current.querySelector<HTMLElement>('[data-highlighted]')
    first?.scrollIntoView?.({ block: 'nearest' })
  }, [markedKey, entries])

  const showMore = async () => {
    if (!entries || entries.length === 0) return
    try {
      const page = await fetchPage(agentId, { target, skill, run }, entries[entries.length - 1].id)
      const next = [...entries, ...page.entries]
      pages.current += 1
      setEntries(next)
      setMore(page.more)
    } catch (e) {
      setError(message(e))
    }
  }

  const undo = async (entry: LedgerSummary) => {
    setBusy(entry.id)
    setRowError((r) => {
      const { [entry.id]: _gone, ...rest } = r
      return rest
    })
    try {
      await api.undoLedgerEntry(agentId, entry.id)
      await load()
    } catch (e) {
      setRowError((r) => ({ ...r, [entry.id]: message(e) }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col gap-2" data-ledger-list="">
      <h3 className="text-[15px] font-semibold">{T.history}</h3>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {entries === null ? (
        !error && <p className="text-[14px] text-fg-muted">{T.loading}</p>
      ) : entries.length === 0 ? (
        <p className="text-[14px] text-fg-muted">{T.historyEmpty}</p>
      ) : (
        <ul ref={listRef} aria-label={T.history} className="flex flex-col gap-0.5">
          {entries.map((e) => {
            const on = marked.includes(e.id)
            return (
              <li
                key={e.id}
                data-entry={e.id}
                data-highlighted={on ? '' : undefined}
                className={cn('flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-[14px]', on && 'bg-hover ring-1 ring-line')}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{e.line}</span>
                  <span className="shrink-0 text-[13px] text-fg-muted">
                    {learningDate(e.at)} {T.source(e.source)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={readOnly || busy === e.id}
                    onClick={() => void undo(e)}
                    aria-label={`${T.undo}: ${e.line}`}
                  >
                    {T.undo}
                  </Button>
                </div>
                {rowError[e.id] && (
                  <p role="alert" className="text-[13px] text-danger">
                    {rowError[e.id]}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {more && (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void showMore()}>
            {T.showMore}
          </Button>
        </div>
      )}
    </section>
  )
}
