/**
 * M27 "Proposed schema" step (design section 8): each proposal item (use / extend / create) with
 * its evidence is accepted, edited or turned down; Apply is enabled only when nothing is undecided.
 * The review is saved as it changes, so a closed dialog resumes where it was.
 * M30 (an IT ops space): an item the rules refuse as a look-alike offers "Use <type>, with a category",
 * which saves it as an edit onto that existing type.
 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { ProposalGroup, ProposalReviewItem, ProposalStatus, SchemaProposal } from '@/api/types'
import { Button } from '@/components/ui/button'
import { useLinkIndex } from '@/links/linkIndex'
import { AGENT_TEXT as T } from './text'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function ProposalStep({ batch, onApplied, onSkip }: { batch: string; onApplied: () => void; onSkip?: () => void }) {
  const [proposal, setProposal] = useState<SchemaProposal | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [decisions, setDecisions] = useState<Record<string, ProposalReviewItem>>({})
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ created: number; extended: number; skipped: { name: string; reason: string }[] } | null>(null)

  const load = useCallback(() => {
    setLoaded(false)
    api
      .importProposal(batch)
      .then((r) => {
        setProposal(r.proposal)
        setDecisions(Object.fromEntries((r.review?.items ?? []).map((i) => [i.id, i])))
        setError(null)
      })
      .catch((e: unknown) => setError(msg(e)))
      .finally(() => setLoaded(true))
  }, [batch])
  useEffect(load, [load])

  const save = (next: Record<string, ProposalReviewItem>) => {
    setDecisions(next)
    api.saveProposalReview(batch, Object.values(next)).catch((e: unknown) => setError(msg(e)))
  }
  const decide = (id: string, status: ProposalStatus, edited?: ProposalReviewItem['edited']) =>
    save({ ...decisions, [id]: { id, status, ...(edited ? { edited } : {}) } })

  const groups = proposal?.groups ?? []
  const undecided = groups.filter((g) => !decisions[g.id]).length

  const apply = async () => {
    setApplying(true)
    setError(null)
    try {
      const r = await api.applyProposal(batch)
      // What Apply left out, by group name; a turned-down item is skipped by the user's own say, not worth repeating.
      const names = new Map(groups.map((g) => [g.id, decisions[g.id]?.edited?.name || g.name]))
      const skipped = (r.skipped ?? [])
        .filter((s) => decisions[s.id]?.status !== 'rejected')
        .map((s) => ({ name: names.get(s.id) ?? s.id, reason: s.reason }))
      setDone({ created: r.created.length, extended: r.extended.length, skipped })
    } catch (e) {
      setError(msg(e))
    } finally {
      setApplying(false)
    }
  }

  return (
    <section aria-labelledby="proposal-heading" className="flex flex-col gap-3">
      <h3 id="proposal-heading" tabIndex={-1} className="text-[14px] font-semibold outline-none">
        {T.proposalHeading}
      </h3>
      <p className="text-[13px] text-fg-muted">{T.proposalIntro}</p>
      {!loaded && <p className="text-[13px] text-fg-muted">{T.loading}</p>}
      {loaded && groups.length === 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-fg-muted">{T.noProposal}</p>
          <div>
            <Button type="button" variant="outline" onClick={load}>
              {T.refresh}
            </Button>
          </div>
        </div>
      )}
      {groups.length > 0 && (
        <ul className="flex flex-col gap-3">
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              decision={decisions[g.id]}
              locked={!!done}
              onDecide={(status, edited) => decide(g.id, status, edited)}
            />
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-[13px]">
          {T.applied(done.created, done.extended)}
          {done.skipped.length > 0 && ` ${T.skippedSummary(done.skipped)}`}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {!done && undecided > 0 && <span className="mr-auto text-[12px] text-fg-muted">{T.undecidedCount(undecided)}</span>}
        {!done && onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip}>
            {T.skip}
          </Button>
        )}
        {done ? (
          <Button type="button" onClick={onApplied}>
            {T.next}
          </Button>
        ) : (
          <Button type="button" disabled={groups.length === 0 || undecided > 0 || applying} onClick={() => void apply()}>
            {applying ? T.applying : T.apply}
          </Button>
        )}
      </div>
    </section>
  )
}

function GroupCard({
  group: g,
  decision,
  locked,
  onDecide,
}: {
  group: ProposalGroup
  decision: ProposalReviewItem | undefined
  locked: boolean
  onDecide: (status: ProposalStatus, edited?: ProposalReviewItem['edited']) => void
}) {
  // The offer taken is an edit too, but has no name or properties to edit.
  const [editing, setEditing] = useState(decision?.status === 'edited' && !decision.edited?.useType)
  const [name, setName] = useState(decision?.edited?.name ?? g.name)
  const [plural, setPlural] = useState(decision?.edited?.plural ?? g.plural ?? '')
  const [dropped, setDropped] = useState<string[]>(decision?.edited?.dropProperties ?? [])

  const saveEdit = (n: string, p: string, d: string[]) =>
    onDecide('edited', { name: n, ...(p ? { plural: p } : {}), ...(d.length ? { dropProperties: d } : {}) })
  const status = decision?.status
  const offer = g.offer
  const offerTaken = !!offer && status === 'edited' && decision?.edited?.useType === offer.typeId
  const types = useLinkIndex((s) => s.types)
  // The offer taken makes the item a use of that type: its own create, skip and properties no longer apply.
  const offerType = offerTaken ? (types.find((t) => t.id === offer.typeId)?.name ?? offer.typeId) : null
  return (
    <li role="group" aria-label={T.itemLabel(g.name)} className="flex flex-col gap-2 rounded-md border border-line p-3 text-[13px]">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-hover px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
          {T.actions[offerType !== null ? 'use' : g.action]}
        </span>
        <span className="text-[14px] font-semibold">{g.name}</span>
        <span className="text-fg-muted">{T.documents(g.documentCount)}</span>
        <span className="ml-auto text-[12px] text-fg-muted">{T.status[status ?? 'undecided']}</span>
      </div>
      {g.examples.length > 0 && (
        <p className="text-fg-muted">
          {T.examples}: {g.examples.join(', ')}
        </p>
      )}
      {offerType !== null && offer && <p>{T.offerTaken(offerType, offer.category)}</p>}
      {offerType === null &&
        (g.problems ?? []).map((p) => (
          <p key={p} className="text-[12px] text-danger">
            {T.willSkip(p)}
          </p>
        ))}
      {offerType === null && g.properties.length > 0 && (
        <div>
          <h4 className="text-[12px] font-semibold">{T.propertiesHeading}</h4>
          <ul className="flex flex-col gap-1">
            {g.properties.map((p) => (
              <li key={p.key} className="flex flex-col">
                <span>
                  {editing ? (
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={!dropped.includes(p.key)}
                        aria-label={T.keepProperty(p.name)}
                        onChange={(e) => {
                          const d = e.target.checked ? dropped.filter((k) => k !== p.key) : [...dropped, p.key]
                          setDropped(d)
                          saveEdit(name, plural, d)
                        }}
                      />
                      {p.name}
                    </label>
                  ) : (
                    <span className="font-medium">{p.name}</span>
                  )}{' '}
                  <span className="text-fg-muted">
                    {p.kind} · {T.fillRate(Math.round(p.fillRate * 100))}
                    {p.relationTo ? ` · ${T.relationTo(p.relationTo)}` : ''}
                  </span>
                </span>
                {p.options && p.options.length > 0 && (
                  <span className="text-[12px] text-fg-muted">
                    {T.optionsLabel}: {p.options.join(', ')}
                  </span>
                )}
                {p.mergedFrom &&
                  Object.entries(p.mergedFrom).map(([to, from]) => (
                    <span key={to} className="text-[12px] text-fg-muted">
                      {T.mergedLabel(to, from)}
                    </span>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {offerType === null && (g.dropped ?? []).length > 0 && (
        <div>
          <h4 className="text-[12px] font-semibold">{T.droppedHeading}</h4>
          <ul className="flex flex-col gap-1 text-[12px] text-fg-muted">
            {(g.dropped ?? []).map((d) => (
              <li key={d.key}>{T.droppedLine(d.name, d.reason)}</li>
            ))}
          </ul>
        </div>
      )}
      {editing && (
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            {T.nameLabel}
            <input
              value={name}
              disabled={locked}
              onChange={(e) => {
                setName(e.target.value)
                saveEdit(e.target.value, plural, dropped)
              }}
              className="h-8 rounded-md border border-line bg-transparent px-2 text-[13px] font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            {T.pluralLabel}
            <input
              value={plural}
              disabled={locked}
              onChange={(e) => {
                setPlural(e.target.value)
                saveEdit(name, e.target.value, dropped)
              }}
              className="h-8 rounded-md border border-line bg-transparent px-2 text-[13px] font-normal"
            />
          </label>
        </div>
      )}
      {offer && (
        <div>
          <Button
            type="button"
            size="sm"
            variant={offerTaken ? 'default' : 'outline'}
            aria-pressed={offerTaken}
            disabled={locked}
            onClick={() => {
              setEditing(false)
              onDecide('edited', { useType: offer.typeId, category: offer.category })
            }}
          >
            {offer.label}
          </Button>
        </div>
      )}
      <div className="flex gap-2" role="group" aria-label={T.itemLabel(g.name) + ' decision'}>
        <Button
          type="button"
          size="sm"
          variant={status === 'accepted' ? 'default' : 'outline'}
          aria-pressed={status === 'accepted'}
          disabled={locked}
          onClick={() => {
            setEditing(false)
            onDecide('accepted')
          }}
        >
          {T.accept}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={status === 'edited' && !offerTaken ? 'default' : 'outline'}
          aria-pressed={status === 'edited' && !offerTaken}
          disabled={locked}
          onClick={() => {
            setEditing(true)
            saveEdit(name, plural, dropped)
          }}
        >
          {T.edit}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={status === 'rejected' ? 'default' : 'outline'}
          aria-pressed={status === 'rejected'}
          disabled={locked}
          onClick={() => {
            setEditing(false)
            onDecide('rejected')
          }}
        >
          {T.reject}
        </Button>
      </div>
    </li>
  )
}
