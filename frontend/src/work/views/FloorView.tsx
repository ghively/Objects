// M23 Task 12: On the floor. A summary (`{n} to gather in {p} places · {c} collected`, ported), one
// card per place with its rows (a checkbox that collects, `what` in bold, the place, the owner or
// `General list`, and a `What you found` field whose Enter collects with the text, ported), the
// Collected list (newest first, 25) whose checkbox un-ticks, an add row and Print checklist (the
// open list only: `data-work-print`, T17's print rule hides the rest). A ticked row vanishes at once
// and comes back with a toast when the call fails. Writes go through M22's `workFloor` for an
// item's floor items and `generalFloorOp` for the general list.
import { useEffect, useState, type JSX } from 'react'
import { api, StepChangedError } from '@/api/client'
import type { FloorOp, WorkBoardItem } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { floorGroups, type FloorRow } from '../logic/floor'
import { settleHidden, useWorkData, type WorkDataState } from '../state/useWorkData'
import { workToast } from '../state/workToasts'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'

/** The `hidden` key of a floor row (kept apart from the step rows' `"{path}#{stepId}"`). */
const hideKey = (r: FloorRow) => `floor:${r.key}`

function problemText(e: unknown): string {
  if (e instanceof StepChangedError) return e.message || WORK_TEXT.floorChanged
  if (e instanceof Error && e.message) return e.message
  return String(e)
}

/** Collect or un-tick `r`: the row vanishes at once; on failure it comes back with a toast. */
async function floorAction(r: FloorRow, op: Extract<FloorOp, 'collect' | 'uncollect'>, found?: string): Promise<void> {
  const key = hideKey(r)
  const store = useWorkData.getState()
  store.hide(key)
  const req = {
    op,
    itemId: r.item.id,
    itemRev: r.item.rev,
    ...(found ? { found } : {}),
  }
  try {
    if (r.owner) {
      await api.workFloor({ path: r.owner.path, ...req })
      // The board reload the write announces shows the row in its new place.
      settleHidden(key)
    } else {
      const general = await api.generalFloorOp(req)
      useWorkData.setState({ general })
      useWorkData.getState().unhide(key)
    }
  } catch (e) {
    useWorkData.getState().unhide(key)
    workToast(problemText(e))
    void useWorkData.getState().load(r.owner ? ['board'] : ['general'])
  }
}

function ownerText(owner: WorkBoardItem | null): string {
  if (!owner) return WORK_TEXT.generalList
  return owner.ticket?.id ? `${owner.ticket.id} · ${owner.title}` : owner.title
}

function OpenRow({ r }: { r: FloorRow }): JSX.Element {
  const [found, setFound] = useState('')
  const collect = () => void floorAction(r, 'collect', found.trim())
  return (
    <li data-floor-row={r.key} className="flex min-h-9 items-center gap-2 py-1 text-[13px]">
      <input
        type="checkbox"
        checked={false}
        onChange={collect}
        aria-label={r.what || r.place}
        className="size-4 shrink-0 accent-[var(--work-you)]"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold text-fg">{r.what}</span>
        <span className="flex min-w-0 gap-1 text-[12px] text-fg-muted">
          <span className="truncate">{r.item.place ?? r.place}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{ownerText(r.owner)}</span>
        </span>
      </div>
      <input
        type="text"
        value={found}
        placeholder={WORK_TEXT.whatYouFound}
        aria-label={WORK_TEXT.whatYouFound}
        onChange={(e) => setFound(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            collect()
          }
        }}
        className="h-7 w-40 shrink-0 rounded border border-line bg-transparent px-2 text-[12px] text-fg print:hidden"
      />
    </li>
  )
}

function CollectedRow({ r }: { r: FloorRow }): JSX.Element {
  return (
    <li data-floor-row={r.key} className="flex h-9 items-center gap-2 text-[13px] text-fg-muted">
      <input
        type="checkbox"
        checked
        onChange={() => void floorAction(r, 'uncollect')}
        aria-label={r.what || r.place}
        className="size-4 shrink-0 accent-[var(--work-you)]"
      />
      <span className="truncate line-through">{r.what}</span>
      {r.found && <span className="truncate">{r.found}</span>}
      <span className="ml-auto shrink-0 text-[12px]">
        {r.place} · {ownerText(r.owner)} · {r.collected}
      </span>
    </li>
  )
}

function AddRow({ items }: { items: WorkBoardItem[] }): JSX.Element {
  const [place, setPlace] = useState('')
  const [what, setWhat] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const p = place.trim()
  const w = what.trim()
  const add = async () => {
    if ((!p && !w) || busy) return
    setBusy(true)
    try {
      if (target) {
        await api.workFloor({ path: target, op: 'add', place: p || null, what: w || null })
      } else {
        const general = await api.generalFloorOp({ op: 'add', place: p || null, what: w || null })
        useWorkData.setState({ general })
      }
      setPlace('')
      setWhat('')
    } catch (e) {
      workToast(problemText(e))
    } finally {
      setBusy(false)
    }
  }
  const field = 'h-7 rounded border border-line bg-transparent px-2 text-[13px] text-fg'
  return (
    <form
      className="flex flex-wrap items-center gap-2 print:hidden"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <input
        value={place}
        placeholder={WORK_TEXT.place}
        aria-label={WORK_TEXT.place}
        onChange={(e) => setPlace(e.target.value)}
        className={cn(field, 'w-36')}
      />
      <input
        value={what}
        placeholder={WORK_TEXT.what}
        aria-label={WORK_TEXT.what}
        onChange={(e) => setWhat(e.target.value)}
        className={cn(field, 'min-w-40 flex-1')}
      />
      <select aria-label="Item" value={target} onChange={(e) => setTarget(e.target.value)} className={cn(field, 'max-w-60')}>
        <option value="">{WORK_TEXT.generalList}</option>
        {items.map((i) => (
          <option key={i.path} value={i.path}>
            {i.ticket?.id ? `${i.ticket.id} · ${i.title}` : i.title}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={(!p && !w) || busy}
        className="h-7 rounded border border-line px-3 text-[13px] text-fg hover:bg-hover disabled:opacity-50"
      >
        {WORK_TEXT.add}
      </button>
    </form>
  )
}

export function FloorView({ data }: { data: WorkDataState; now: Date }): JSX.Element {
  const hidden = useWorkData((s) => s.hidden)
  const generalLoaded = data.general !== null
  useEffect(() => {
    if (!generalLoaded) void useWorkData.getState().load(['general'])
  }, [generalLoaded])

  const items = data.board?.items ?? []
  const groups = floorGroups(items, data.general?.items ?? [])
  const open = groups.open
    .map((g) => ({ place: g.place, rows: g.rows.filter((r) => !hidden.has(hideKey(r))) }))
    .filter((g) => g.rows.length > 0)
  const collected = groups.collected.filter((r) => !hidden.has(hideKey(r)))
  const openCount = open.reduce((n, g) => n + g.rows.length, 0)
  const active = items
    .filter((i) => !i.done)
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div data-work-view="floor" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <span className="text-[13px] text-fg-muted">
          {WORK_TEXT.floorSummary(openCount, open.length, collected.length)}
        </span>
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded border border-line px-2 text-[13px] text-fg hover:bg-hover"
        >
          <Icon name={WORK_ICONS.print} size={14} />
          {WORK_TEXT.printChecklist}
        </button>
      </div>

      <div data-work-print="" className="flex flex-col gap-3">
        {open.length === 0 ? (
          <p className="text-[13px] text-fg-muted">{WORK_TEXT.nothingOnFloor}</p>
        ) : (
          open.map((g) => (
            <section key={g.place} data-floor-place={g.place} className="rounded border border-line px-3 py-2">
              <h3 className="flex items-center gap-1 text-[13px] font-medium text-fg">
                <Icon name={WORK_ICONS.floor} size={14} />
                {g.place}
                <span className="text-fg-muted">· {g.rows.length}</span>
              </h3>
              <ul className="flex flex-col">
                {g.rows.map((r) => (
                  <OpenRow key={r.key} r={r} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <AddRow items={active} />

      {collected.length > 0 && (
        <section data-floor-collected="" className="flex flex-col print:hidden">
          <h3 className="text-[12px] font-medium text-fg-muted">{WORK_TEXT.collected}</h3>
          <ul className="flex flex-col">
            {collected.map((r) => (
              <CollectedRow key={r.key} r={r} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
