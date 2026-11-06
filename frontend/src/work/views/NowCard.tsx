// M23 Task 10: Now's card, the page's one large element: the best item for Gene right now.
// `{energy} energy · ~{minutes} min` (ours, ported), the chips, the title, First tiny step (the
// current step), Blocked on, Hypothesis with its confidence, the step's inline actions, Where you
// left off (the last Activity line, else `Last touched {n} days ago`, ported), `Step {n} of {N}`,
// and Start together, Make it smaller, Not now and Details. An item whose steps are all done
// (turn `close`) offers Close instead (M22's `api.workClose`). A click on the card's empty area
// opens the item panel.
import { useState, type JSX, type MouseEvent, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { Energy, WorkBoardItem, WorkStep } from '@/api/types'
import { Icon } from '@/components/Icon'
import { ItemChips } from '../components/ItemChips'
import { StepActions } from '../components/StepActions'
import { quietDays, STEP_ENERGY, STEP_MINUTES } from '../logic/scoring'
import { settleHidden, useWorkData } from '../state/useWorkData'
import { useWorkOverlay } from '../state/useWorkOverlay'
import { useWorkUi } from '../state/useWorkUi'
import { openItemPanel, workToast } from '../state/workActions'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'

const ENERGY_LABEL: Record<Energy, string> = {
  low: WORK_TEXT.energyLow,
  medium: WORK_TEXT.energyMedium,
  high: WORK_TEXT.energyHigh,
}

const BTN = 'inline-flex h-7 items-center gap-1 rounded border border-line px-2 text-[12px] text-fg hover:bg-hover disabled:opacity-50'

/** The row key Close hides while it runs. */
export const closeKey = (path: string) => `${path}#close`

/** The item's current step (the one step that may offer actions). */
export function currentStepOf(i: WorkBoardItem): WorkStep | null {
  return i.steps.find((s) => s.current) ?? (i.current?.current ? i.current : null)
}

/** `[[a|b]]` shown as `b`, `[[a]]` as `a`. */
const plainLinks = (text: string) => text.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]*)\]\]/g, '$1')

function Section({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5" data-now-section={label}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{label}</span>
      <div className="text-[13px] text-fg">{children}</div>
    </div>
  )
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e))

/** True when a click landed on something of its own (a button, a field, the actions). */
const onControl = (e: MouseEvent) =>
  !!(e.target as HTMLElement).closest('button, a, input, textarea, select, label, [role="group"]')

export function NowCard({ item, now }: { item: WorkBoardItem; now: Date }): JSX.Element {
  const [closing, setClosing] = useState(false)
  const step = currentStepOf(item)
  const closeIt = item.turn === 'close'
  const energy = step && !closeIt ? STEP_ENERGY[step.kind] : null

  const close = async () => {
    if (closing) return
    setClosing(true)
    const key = closeKey(item.path)
    const data = useWorkData.getState()
    data.hide(key)
    try {
      await api.workClose(item.path, item.version)
      settleHidden(key)
      // A ticket then shows its resolution note in the panel.
      if (item.ticket) openItemPanel(item.path)
    } catch (e) {
      useWorkData.getState().unhide(key)
      workToast(message(e))
      void useWorkData.getState().load(['board'])
    } finally {
      setClosing(false)
    }
  }

  return (
    <article
      data-now-card={item.path}
      onClick={(e) => {
        if (!onControl(e)) openItemPanel(item.path)
      }}
      className="flex min-w-0 cursor-default flex-col gap-3 rounded-lg border border-line p-4"
    >
      {energy ? (
        <span data-now-energy={energy} className="inline-flex items-center gap-1 text-[12px] text-fg-muted">
          <Icon name={WORK_ICONS[energy]} size={13} />
          {WORK_TEXT.energyMinutes(ENERGY_LABEL[energy], step ? STEP_MINUTES[step.kind] : 0)}
        </span>
      ) : null}
      <ItemChips item={item} />
      <h2 className="text-[18px] font-semibold leading-snug text-fg">{item.title}</h2>

      {closeIt ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-fg">{WORK_TEXT.everyStepDone}</p>
          {item.deskSays ? <p className="text-[12px] text-fg-muted">{WORK_TEXT.deskSays(item.deskSays)}</p> : null}
          <div>
            <button type="button" className={BTN} disabled={closing} onClick={() => void close()}>
              <Icon name={WORK_ICONS.done} size={13} />
              {WORK_TEXT.close}
            </button>
          </div>
        </div>
      ) : step ? (
        <Section label={WORK_TEXT.firstTinyStep}>
          <span data-now-step={step.n}>{step.text}</span>
        </Section>
      ) : null}

      {item.blockedOn ? <Section label={WORK_TEXT.blockedOn}>{plainLinks(item.blockedOn)}</Section> : null}
      {item.hypothesis ? (
        <Section label={WORK_TEXT.hypothesis}>
          <span>{item.hypothesis}</span>
          {item.confidence ? (
            <span className="ml-2 text-[12px] text-fg-muted">{WORK_TEXT.confidenceOf(item.confidence)}</span>
          ) : null}
        </Section>
      ) : null}

      {step && !closeIt ? <StepActions item={item} step={step} /> : null}

      <Section label={WORK_TEXT.whereYouLeftOff}>
        <span className="text-fg-muted">
          {item.lastActivity ? item.lastActivity.text : WORK_TEXT.lastTouchedDays(quietDays(item, now))}
        </span>
      </Section>
      {step && item.stepCount > 0 ? (
        <span data-now-progress="" className="text-[12px] text-fg-muted">
          {WORK_TEXT.stepOf(step.n, item.stepCount)}
        </span>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN} onClick={() => useWorkOverlay.getState().openSession(item.path)}>
          <Icon name={WORK_ICONS.timer} size={13} />
          {WORK_TEXT.startTogether}
        </button>
        {step && !closeIt ? (
          <button type="button" className={BTN} onClick={() => useWorkOverlay.getState().openSmaller(item.path, step.id)}>
            <Icon name={WORK_ICONS.smaller} size={13} />
            {WORK_TEXT.makeItSmaller}
          </button>
        ) : null}
        <button type="button" className={BTN} onClick={() => useWorkUi.getState().addNotNow(item.path)}>
          {WORK_TEXT.notNow}
        </button>
        <button type="button" className={BTN} onClick={() => openItemPanel(item.path)}>
          {WORK_TEXT.details}
        </button>
      </div>
    </article>
  )
}
