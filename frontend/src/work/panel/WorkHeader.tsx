// M23 Task 14: the item panel's work header, above a work item's own page (spec section 5, "Item
// panel"). It reads `api.workItem(path)` (nothing for an object that isn't a work item) and shows,
// in order: the chips (plus Object's status and "Desk says …"), Open ticket, the current step with
// its actions, Start together and Make it smaller, Waiting on, Findings, Hypothesis and Confidence,
// Verified / Assumed (To raise confidence under them), the step list, Floor items, the note box,
// Close (a close turn), the Resolution note (a ticket) and Activity.
//
// Every write goes through the page's `ObjectWrites.work`, which saves pending body edits first and
// then loads the returned body (with its new Activity line) at the returned version, so the open
// editor never loses a line or 409s. The header adopts the returned item. A write made elsewhere
// (a Work view's step action, another window) announces a change of the path, and the header reads
// the item again.
import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { api, isResync } from '@/api/client'
import type { StepAction, WorkItem, WorkWriteResult } from '@/api/types'
import { Icon } from '@/components/Icon'
import type { ObjectWrites } from '@/object/useObjectWrites'
import { Chip } from '../components/Chip'
import { ItemChips } from '../components/ItemChips'
import { StepActions } from '../components/StepActions'
import { ResolutionNote } from '../ResolutionNote'
import { StepList, type StepActionExtra } from '../StepList'
import { useWorkOverlay } from '../state/useWorkOverlay'
import type { WorkRunner } from '../state/workActions'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'
import { ActivityList } from './ActivityList'
import { ConfidenceMeter } from './ConfidenceMeter'
import { EvidenceColumns } from './EvidenceColumns'
import { FloorList } from './FloorList'
import { NoteBox } from './NoteBox'

const BTN =
  'inline-flex h-7 items-center gap-1 rounded border border-line px-2 text-[12px] text-fg hover:bg-hover disabled:opacity-50'

/** An http(s) link, else null (a ticket's url opens in the browser only when clicked). */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

function Part({ part, title, children }: { part: string; title: string; children: ReactNode }) {
  return (
    <section data-work-part={part} aria-label={title} className="flex flex-col gap-1">
      <h3 className="text-[12px] font-semibold text-fg-muted">{title}</h3>
      {children}
    </section>
  )
}

export function WorkHeader({ path, work }: { path: string; work: ObjectWrites['work'] }): JSX.Element | null {
  const [item, setItem] = useState<WorkItem | null>(null)
  /** The version the shown item belongs to: a change event at it is already shown. */
  const versionRef = useRef<string | null>(null)
  /** Bumped by every read and adopted write: a read that a later one overtook is dropped. */
  const seq = useRef(0)

  const adopt = useCallback((res: WorkWriteResult) => {
    seq.current++
    versionRef.current = res.version
    setItem(res.item)
  }, [])

  const load = useCallback(() => {
    const mine = ++seq.current
    Promise.resolve()
      .then(() => api.workItem(path))
      .then((it) => {
        if (mine !== seq.current) return
        if (!it || it.path !== path) {
          setItem(null)
          return
        }
        versionRef.current = it.version
        setItem(it)
      })
      .catch(() => {
        // Not a work item (422), gone (404) or unreadable: no header.
        if (mine === seq.current) setItem(null)
      })
  }, [path])

  // The page is keyed by its path (`ObjectPage`), so a header lives for one path.
  useEffect(() => {
    load()
    const reads = seq
    return () => {
      reads.current++
    }
  }, [load])

  useEffect(
    () =>
      api.onChange((e) => {
        if (isResync(e, 'types')) {
          load()
          return
        }
        if (e.path !== path || e.kind === 'deleted') return
        if (e.version && e.version === versionRef.current) return
        load()
      }),
    [path, load],
  )

  /** A step, steps, note or floor call through the page's writes (they ignore `baseVersion`). */
  const run: WorkRunner = useCallback(
    async (call) => {
      const res = await work((p) => call(p))
      if (res) adopt(res)
      return res
    },
    [work, adopt],
  )

  if (!item) return null

  const current = item.steps.find((s) => s.current) ?? item.current
  const ticketUrl = safeUrl(item.ticket?.url)

  const onAction = async (stepId: string, stepRev: string, action: StepAction, extra?: StepActionExtra) =>
    !!(await run((p) => api.workStep({ path: p, stepId, stepRev, action, ...(extra ?? {}) })))

  const close = async () => {
    // Close is checked against the object's version: the one the body flush left.
    const res = await work((p, v) => api.workClose(p, v))
    if (res) adopt(res)
  }

  return (
    <div
      role="region"
      aria-label={WORK_TEXT.work}
      data-work-header=""
      className="mb-6 flex flex-col gap-4 rounded-lg border border-line p-3"
    >
      <div data-work-part="chips" className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
        <ItemChips item={item} />
        {item.status && <Chip tone="muted">{item.status}</Chip>}
        {item.deskSays && <Chip tone="ok">{WORK_TEXT.deskSays(item.deskSays)}</Chip>}
      </div>

      {ticketUrl && (
        <div data-work-part="openTicket">
          <a href={ticketUrl} target="_blank" rel="noopener noreferrer" className={BTN}>
            <Icon name={WORK_ICONS.ticket} size={13} />
            {WORK_TEXT.openTicket}
          </a>
        </div>
      )}

      {current && (
        <div data-work-part="current" className="flex flex-col gap-1.5">
          <p className="text-[14px] text-fg">
            <span className="text-fg-muted">{`${WORK_TEXT.stepOf(current.n, item.stepCount)}: `}</span>
            {current.text}
          </p>
          {!item.stepsUnreadable && <StepActions item={item} step={current} run={run} />}
        </div>
      )}

      <div data-work-part="session" className="flex flex-wrap gap-1.5">
        <button type="button" className={BTN} onClick={() => useWorkOverlay.getState().openSession(path)}>
          <Icon name={WORK_ICONS.timer} size={13} />
          {WORK_TEXT.startTogether}
        </button>
        {current && (
          <button type="button" className={BTN} onClick={() => useWorkOverlay.getState().openSmaller(path, current.id)}>
            <Icon name={WORK_ICONS.smaller} size={13} />
            {WORK_TEXT.makeItSmaller}
          </button>
        )}
      </div>

      {item.blockedOn && (
        <Part part="waitingOn" title={WORK_TEXT.waitingOn}>
          <p className="text-[13px] text-fg">{item.blockedOn}</p>
        </Part>
      )}

      {item.findings && (
        <Part part="findings" title={WORK_TEXT.findings}>
          <p className="whitespace-pre-wrap text-[13px] text-fg">{item.findings}</p>
        </Part>
      )}

      {(item.hypothesis || item.confidence) && (
        <Part part="hypothesis" title={WORK_TEXT.hypothesis}>
          {item.hypothesis && <p className="whitespace-pre-wrap text-[13px] text-fg">{item.hypothesis}</p>}
          <ConfidenceMeter confidence={item.confidence} reason={item.confidenceReason} />
        </Part>
      )}

      {(item.verified.length > 0 || item.assumed.length > 0 || item.toRaiseConfidence.length > 0) && (
        <div data-work-part="evidence">
          <EvidenceColumns verified={item.verified} assumed={item.assumed} toRaise={item.toRaiseConfidence} />
        </div>
      )}

      <div data-work-part="steps">
        {item.stepsUnreadable && (
          // Fix pass H: every step write would be refused until the file is fixed: say why, offer none.
          <ul role="alert" className="mb-2 flex flex-col gap-0.5 text-[13px] text-[var(--danger)]">
            {item.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <StepList
          steps={item.steps}
          readOnly={item.stepsUnreadable}
          onOps={async (ops) => !!(await run((p) => api.workSteps(p, ops)))}
          onAction={onAction}
        />
      </div>

      {item.floorItems.length > 0 && (
        <Part part="floor" title={WORK_TEXT.floorItems}>
          <FloorList
            items={item.floorItems}
            onToggle={(f) =>
              run((p) =>
                api.workFloor({ path: p, op: f.collected ? 'uncollect' : 'collect', itemId: f.id, itemRev: f.rev }),
              )
            }
          />
        </Part>
      )}

      <div data-work-part="note">
        <NoteBox onSend={async (kind, text) => !!(await run((p) => api.workNote(p, kind, text)))} />
      </div>

      {item.turn === 'close' && (
        <div data-work-part="close">
          <button type="button" className={BTN} onClick={() => void close()}>
            <Icon name={WORK_ICONS.done} size={13} />
            {WORK_TEXT.close}
          </button>
        </div>
      )}

      {item.ticket && item.resolution && (
        <Part part="resolution" title={WORK_TEXT.resolutionNote}>
          <ResolutionNote note={item.resolution} />
        </Part>
      )}

      {item.activity.length > 0 && (
        <Part part="activity" title={WORK_TEXT.activity}>
          <ActivityList lines={item.activity} />
        </Part>
      )}
    </div>
  )
}
