// M23 Task 15: Make it smaller (spec section 5): the step's text and 2-4 drafts (`splitStep`, each
// editable, each ~2 min), "Replace the step with these" (ours: one steps write, the drafts as Do
// steps before the step and then its removal; open steps only) and "Ask the agent to break it
// down" (the spec's capture `Break down {ref} step {n}: {text}`, 501 until M24).
import { useState, type JSX } from 'react'
import { api } from '@/api/client'
import type { StepOp, TicketInfo } from '@/api/types'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { itemRef, splitStep } from '../logic/splitStep'
import { useWorkOverlay } from '../state/useWorkOverlay'
import { useWorkUi } from '../state/useWorkUi'
import { workToast } from '../state/workActions'
import { WORK_TEXT } from '../workText'
import type { OverlayItem } from './FocusSession'

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e))

const BTN = 'h-8 rounded border border-line px-3 text-[13px] text-fg hover:bg-hover disabled:opacity-50'

/** Make it smaller for step `stepId` of `item` (`useWorkOverlay.smaller`; null while it loads). */
export function MakeSmallerDialog({ item, stepId }: { item: OverlayItem | null; stepId: string }): JSX.Element {
  const path = item?.path ?? ''
  const step = item?.steps.find((s) => s.id === stepId) ?? null
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const close = () => useWorkOverlay.getState().close()

  // The drafts start from the step's text (and start over should that text change).
  const stepText = step?.text ?? null
  const [edited, setEdited] = useState<{ from: string | null; list: string[] }>({ from: null, list: [] })
  const drafts = edited.from === stepText && stepText !== null ? edited.list : stepText === null ? [] : splitStep(stepText)
  const setDraft = (i: number, value: string) =>
    setEdited({ from: stepText, list: drafts.map((x, j) => (j === i ? value : x)) })

  const replace = async () => {
    if (!step) return
    const texts = drafts.map((d) => d.trim()).filter(Boolean)
    if (!texts.length) return
    const ops: StepOp[] = [
      ...texts.map((text): StepOp => ({ op: 'add', kind: 'do', text, before: step.id })),
      { op: 'remove', stepId: step.id, stepRev: step.rev },
    ]
    setBusy(true)
    try {
      await api.workSteps(path, ops)
      close()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const askAgent = async () => {
    if (!item || !step) return
    setBusy(true)
    try {
      await api.workCapture({
        text: WORK_TEXT.breakDown(itemRef(item as { ticket: TicketInfo | null; title: string }), step.n, step.text),
        fromView: useWorkUi.getState().view,
        linkedPath: path,
      })
      close()
    } catch (e) {
      workToast(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        data-work-smaller="" className="border-line bg-raised-2 text-fg sm:max-w-[520px]">
        <DialogTitle className="text-[18px]">{WORK_TEXT.makeItSmaller}</DialogTitle>
        {step ? (
          <div className="flex flex-col gap-3">
            <p className="text-[14px] text-fg-muted">{step.text}</p>
            <ol className="flex flex-col gap-1.5">
              {drafts.map((d, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label={`Draft ${i + 1}`}
                    value={d}
                    maxLength={2000}
                    onChange={(e) => setDraft(i, e.target.value)}
                    className="h-8 min-w-0 flex-1 rounded border border-line bg-transparent px-2 text-[13px] text-fg outline-none focus:border-fg-muted"
                  />
                  <span className="shrink-0 text-[12px] text-fg-muted">{WORK_TEXT.twoMinutes}</span>
                </li>
              ))}
            </ol>
            {error ? (
              <p role="alert" className="text-[13px] text-[var(--work-critical)]">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {step && step.state === 'open' ? (
            <button type="button" className={BTN} disabled={busy} onClick={() => void replace()}>
              {WORK_TEXT.replaceStep}
            </button>
          ) : null}
          <button type="button" className={BTN} disabled={busy || !step} onClick={() => void askAgent()}>
            {WORK_TEXT.askBreakDown}
          </button>
          <button type="button" className={BTN} onClick={close}>
            {WORK_TEXT.close}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
