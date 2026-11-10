/**
 * M30 "Entities" step (a batch kept as Sources; design 5 and 5a): the things the pages talk about,
 * resolved into one entity per thing. Each is accepted, renamed, merged, split or turned down; every
 * change saves the whole review and shows the view the server answers. Write is enabled only when
 * nothing is undecided; it runs in the filing worker, so its state is polled until it is done or failed.
 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { EntitiesReview, EntitiesView, EntityDecision, EntityLeftOut, EntityValue, FilingStatus, ImportEntity } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { AGENT_TEXT as T } from './text'
import { agentTiming } from './TrialStep'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const show = (v: unknown): string => (Array.isArray(v) ? v.map(show).join(', ') : v != null && typeof v === 'object' ? JSON.stringify(v) : String(v))
const titles = (sources: { title: string }[]) => `(${sources.map((s) => s.title).join(', ')})`

/** Entities (and left-out names) in the order shown, grouped by their type's name. */
function byType<E extends { type: string }>(items: E[]): [string, E[]][] {
  const groups = new Map<string, E[]>()
  for (const e of items) groups.set(e.type, [...(groups.get(e.type) ?? []), e])
  return [...groups]
}

export function EntitiesStep({ batch, onDone }: { batch: string; onDone: (status: FilingStatus) => void }) {
  const [view, setView] = useState<EntitiesView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [showLeftOut, setShowLeftOut] = useState(false)
  /** Write was pressed (or the batch was writing when the step opened); `polling` once its POST answered. */
  const [writing, setWriting] = useState(false)
  const [polling, setPolling] = useState(false)
  const [failed, setFailed] = useState(false)
  const [finished, setFinished] = useState<FilingStatus | null>(null)

  const load = useCallback(async () => {
    try {
      const v = await api.importEntities(batch)
      setView(v)
      setError(null)
      // Opened (or read again) while Write runs: follow it until it ends.
      if (v.state === 'writing') {
        setWriting(true)
        setPolling(true)
      }
      return v
    } catch (e) {
      setError(msg(e))
      return null
    }
  }, [batch])

  useEffect(() => {
    const first = async () => {
      await load()
    }
    void first()
  }, [load])
  // Reopened after a write: the status Continue hands on.
  useEffect(() => {
    if (view?.state !== 'written' || finished) return
    api.filingStatus(batch).then(setFinished, (e: unknown) => setError(msg(e)))
  }, [view?.state, finished, batch])
  // The pass may still be collecting when the step opens: read the list again until it is ready.
  useEffect(() => {
    if (view?.state !== 'collecting') return
    const t = setInterval(() => void load(), agentTiming.pollMs)
    return () => clearInterval(t)
  }, [view?.state, load])
  useEffect(() => {
    if (!polling) return
    // One status read at a time; the first answer that ends the write stops the polling at once.
    let busy = false
    let stopped = false
    const t = setInterval(() => {
      if (busy || stopped) return
      busy = true
      void api
        .filingStatus(batch)
        .then(async (s) => {
          if (stopped || (s.state !== 'done' && s.state !== 'failed')) return
          stopped = true
          clearInterval(t)
          setPolling(false)
          setWriting(false)
          if (s.state === 'failed') setFailed(true)
          else setFinished(s)
          await load()
        })
        .catch((e: unknown) => setError(msg(e)))
        .finally(() => {
          busy = false
        })
    }, agentTiming.pollMs)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [polling, batch, load])

  const review: EntitiesReview = view?.review ?? { decisions: {}, merges: [], splits: [] }
  const entities = view?.entities ?? []
  const leftOut = view?.leftOut ?? []
  // The server resolves each entity's decision (a merge or split may move or drop one), so its answer is shown as it is.
  const decisionOf = (e: ImportEntity): EntityDecision | null => e.decision ?? null
  const done = !!finished || view?.state === 'written'
  const locked = writing || done

  const save = async (next: EntitiesReview) => {
    setError(null)
    try {
      const r = await api.saveEntitiesReview(batch, next)
      setView(r.view)
    } catch (e) {
      setError(msg(e))
    }
  }
  const decide = (id: string, d: EntityDecision) => void save({ ...review, decisions: { ...review.decisions, [id]: d } })
  const merge = (ids: string[]) => {
    setSelected((s) => s.filter((id) => !ids.includes(id)))
    void save({ ...review, merges: [...review.merges, ids] })
  }
  const split = (id: string, names: string[]) => void save({ ...review, splits: [...review.splits, { id, names }] })
  const acceptRest = () => {
    const rest = entities.filter((e) => !decisionOf(e))
    void save({ ...review, decisions: { ...review.decisions, ...Object.fromEntries(rest.map((e) => [e.id, { status: 'accepted' as const }])) } })
  }
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)))

  const write = async () => {
    setWriting(true)
    setFailed(false)
    setError(null)
    try {
      await api.writeEntities(batch)
      setPolling(true)
    } catch (e) {
      setWriting(false)
      setError(msg(e))
    }
  }

  const undecided = view?.undecided ?? 0
  const canWrite = !!view && view.state !== 'collecting' && undecided === 0 && !locked
  const written = view?.written ?? null

  return (
    <section aria-labelledby="entities-heading" className="flex flex-col gap-3">
      <h3 id="entities-heading" tabIndex={-1} className="text-[14px] font-semibold outline-none">
        {T.entitiesHeading}
      </h3>
      <p className="text-[13px] text-fg-muted">{T.entitiesIntro}</p>
      {(!view || view.state === 'collecting') && !error && <p className="text-[13px] text-fg-muted">{T.loading}</p>}
      {view && view.state !== 'collecting' && entities.length === 0 && <p className="text-[13px] text-fg-muted">{T.entitiesNone}</p>}
      {entities.length > 0 && <p className="text-[13px] text-fg-muted">{T.sourcesNote(view?.sources ?? 0)}</p>}

      {(view?.suggestedMerges ?? []).length > 0 && !locked && (
        <section aria-labelledby="entities-suggested" className="flex flex-col gap-1">
          <h4 id="entities-suggested" className="text-[13px] font-semibold">
            {T.suggestedHeading}
          </h4>
          <ul className="flex flex-col gap-1">
            {view!.suggestedMerges.map((s) => (
              <li key={s.ids.join('|')} className="flex items-center gap-2 text-[13px]">
                <span>{s.names.join(', ')}</span>
                <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => merge(s.ids)}>
                  {T.mergeSuggestion}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {byType(entities).map(([type, rows]) => {
        const left = leftOut.filter((l) => l.type === type)
        const chosen = [...rows, ...left].map((e) => e.id).filter((id) => selected.includes(id))
        return (
          <section key={type} aria-label={T.typeGroup(type, rows.length)} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h4 className="text-[13px] font-semibold">{T.typeGroup(type, rows.length)}</h4>
              {chosen.length >= 2 && !locked && (
                <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => merge(chosen)}>
                  {T.mergeSelected(chosen.length)}
                </Button>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {rows.map((e) => (
                <EntityRow
                  key={e.id}
                  entity={e}
                  decision={decisionOf(e)}
                  selected={selected.includes(e.id)}
                  locked={locked}
                  onSelect={(on) => toggle(e.id, on)}
                  onDecide={(d) => decide(e.id, d)}
                  onSplit={(names) => split(e.id, names)}
                />
              ))}
            </ul>
          </section>
        )
      })}

      {leftOut.length > 0 && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            aria-expanded={showLeftOut}
            aria-controls="entities-left-out"
            onClick={() => setShowLeftOut((o) => !o)}
            className="flex items-center gap-1 self-start rounded-md px-1.5 py-0.5 text-[13px] font-semibold hover:bg-hover"
          >
            <Icon name={showLeftOut ? 'ph-caret-down' : 'ph-caret-right'} size={12} />
            {T.leftOutHeading}
          </button>
          {showLeftOut && (
            <ul id="entities-left-out" aria-label={T.leftOutHeading} className="flex flex-col gap-1 text-[13px]">
              {leftOut.map((l) => (
                <LeftOutRow
                  key={l.id}
                  item={l}
                  selectable={!locked && entities.some((e) => e.type === l.type)}
                  selected={selected.includes(l.id)}
                  onSelect={(on) => toggle(l.id, on)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {failed && !writing && (
        <p role="alert" className="text-[13px] text-danger">
          {T.writeFailed}
        </p>
      )}
      {done && written && (
        <div role="status" className="flex flex-col gap-1 text-[13px]">
          <p>{T.written(written)}</p>
          {written.conflicts > 0 && <p>{T.conflictsWritten(written.conflicts)}</p>}
          {written.sectionsLeft > 0 && <p>{T.sectionsLeft(written.sectionsLeft)}</p>}
          {written.relationsInbox > 0 && <p>{T.relationsInbox(written.relationsInbox)}</p>}
          {written.failed.map((f) => (
            <p key={f.name} className="text-danger">
              {T.droppedLine(f.name, f.reason)}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {!done && undecided > 0 && <span className="mr-auto text-[12px] text-fg-muted">{T.undecidedEntities(undecided)}</span>}
        {done ? (
          <Button type="button" disabled={!finished} onClick={() => {
              if (finished) onDone(finished)
            }}>
            {T.next}
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" disabled={undecided === 0 || locked} onClick={acceptRest}>
              {T.acceptRest}
            </Button>
            <Button type="button" disabled={!canWrite} onClick={() => void write()}>
              {writing ? T.writing : T.write}
            </Button>
          </>
        )}
      </div>
    </section>
  )
}

function EntityRow({
  entity: e,
  decision,
  selected,
  locked,
  onSelect,
  onDecide,
  onSplit,
}: {
  entity: ImportEntity
  decision: EntityDecision | null
  selected: boolean
  locked: boolean
  onSelect: (on: boolean) => void
  onDecide: (d: EntityDecision) => void
  onSplit: (names: string[]) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(decision?.name ?? e.name)
  const [splitting, setSplitting] = useState(false)
  const [moving, setMoving] = useState<string[]>([])
  const status = decision?.status
  const value: EntityValue | undefined = e.values[0]
  const disagree = e.values.some((v) => (v.conflict ?? []).length > 0)
  const badges: string[] = [
    e.mainPages.length > 0 && T.mainSubject,
    e.existing && T.alreadyHere,
    e.joinedByAgent && T.joinedByAgent,
    disagree && T.disagree,
    e.confidence === 'low' && T.confidence.low,
  ].filter((b) => typeof b === 'string')

  const rename = () => {
    const n = name.trim()
    if (!n) return
    setRenaming(false)
    onDecide({ status: 'renamed', name: n })
  }
  const finishSplit = () => {
    setSplitting(false)
    setMoving([])
    if (moving.length > 0) onSplit(moving)
  }

  return (
    <li role="group" aria-label={e.name} className="flex flex-col gap-2 rounded-md border border-line p-3 text-[13px]">
      <div className="flex flex-wrap items-baseline gap-2">
        <input
          type="checkbox"
          checked={selected}
          disabled={locked}
          aria-label={T.selectLabel(e.name)}
          onChange={(ev) => onSelect(ev.target.checked)}
          className="self-center"
        />
        <span className="text-[14px] font-semibold">{status === 'renamed' && decision?.name ? decision.name : e.name}</span>
        <span className="text-fg-muted">{T.sourcesCount(e.pages.length)}</span>
        {badges.map((b) => (
          <span key={b} className="rounded bg-hover px-1.5 py-0.5 text-[11px] font-semibold">
            {b}
          </span>
        ))}
        <span className="ml-auto text-[12px] text-fg-muted">{status ? T.entityStatus[status] : T.status.undecided}</span>
      </div>
      {e.aliases.length > 0 && <p className="text-fg-muted">{T.alsoCalled(e.aliases)}</p>}
      {e.summary.length > 0 && <p>{e.summary[0]}</p>}
      {value && (
        <div>
          <span>{`${value.name}: ${show(value.value)}`}</span> <span className="text-fg-muted">{titles(value.sources)}</span>
          {value.sources[0] && (
            <blockquote className="border-l-2 border-line pl-2 text-[12px] text-fg-muted">
              <span className="sr-only">{T.quote}: </span>
              {value.sources[0].quote}
            </blockquote>
          )}
          {value.conflict && value.conflict.length > 0 && (
            <p className="text-[12px] text-fg-muted">
              {T.keptValue(
                show(value.value),
                value.conflict.map((c) => show(c.value)),
              )}
            </p>
          )}
        </div>
      )}
      {renaming && (
        <label className="flex flex-col gap-1 text-[12px] font-semibold">
          {T.renameLabel}
          <input
            value={name}
            autoFocus
            onChange={(ev) => setName(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault()
                rename()
              } else if (ev.key === 'Escape') {
                ev.stopPropagation()
                setRenaming(false)
              }
            }}
            className="h-8 rounded-md border border-line bg-transparent px-2 text-[13px] font-normal"
          />
        </label>
      )}
      {splitting && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[12px] font-semibold">{T.splitIntro}</legend>
          {[e.name, ...e.aliases].map((n) => (
            <label key={n} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={moving.includes(n)}
                onChange={(ev) => setMoving((m) => (ev.target.checked ? [...m, n] : m.filter((x) => x !== n)))}
              />
              {n}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label={`${e.name} decision`}>
        <Button
          type="button"
          size="sm"
          variant={status === 'accepted' ? 'default' : 'outline'}
          aria-pressed={status === 'accepted'}
          disabled={locked}
          onClick={() => {
            setRenaming(false)
            onDecide({ status: 'accepted' })
          }}
        >
          {T.accept}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={status === 'renamed' ? 'default' : 'outline'}
          aria-pressed={status === 'renamed'}
          disabled={locked}
          onClick={() => setRenaming(true)}
        >
          {T.rename}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={status === 'rejected' ? 'default' : 'outline'}
          aria-pressed={status === 'rejected'}
          disabled={locked}
          onClick={() => {
            setRenaming(false)
            onDecide({ status: 'rejected' })
          }}
        >
          {T.reject}
        </Button>
        {e.aliases.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant={splitting ? 'default' : 'outline'}
            aria-expanded={splitting}
            disabled={locked}
            onClick={() => (splitting ? finishSplit() : setSplitting(true))}
          >
            {T.split}
          </Button>
        )}
      </div>
    </li>
  )
}

function LeftOutRow({
  item,
  selectable,
  selected,
  onSelect,
}: {
  item: EntityLeftOut
  selectable: boolean
  selected: boolean
  onSelect: (on: boolean) => void
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          aria-label={T.selectLabel(item.name)}
          onChange={(ev) => onSelect(ev.target.checked)}
          className="self-center"
        />
      )}
      <span className="font-medium">{item.name}</span>
      <span className="text-fg-muted">{item.type}</span>
      <span className="text-fg-muted">{T.sourcesCount(item.pages)}</span>
      <span className="text-[12px] text-fg-muted">{T.leftOutReason[item.reason]}</span>
    </li>
  )
}
