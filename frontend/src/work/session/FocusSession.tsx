// M23 Task 15: the focus session (spec section 5): a full-window dialog for one item with a
// 25-minute timer, Step done (by the current step's kind), Pause, Too big and "Tell the agent what
// you see". Captures go through the M24 seam (`api.workCapture`), which answers 501 in M23.
import { useEffect, useRef, useState, type JSX } from 'react'
import { api, UnavailableError } from '@/api/client'
import type { TicketInfo, WorkBoardItem, WorkItem, WorkStep, WorkWriteResult } from '@/api/types'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Icon } from '@/components/Icon'
import { StepActions } from '../components/StepActions'
import { itemRef } from '../logic/splitStep'
import { useWorkOverlay } from '../state/useWorkOverlay'
import { directRunner, stepAction, workToast, type WorkRunner } from '../state/workActions'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'

/** The session's length (Global Constraints: 25 minutes). */
const SESSION_SECONDS = 25 * 60

/** What an overlay needs of an item: its board row, or the item itself when the board lacks it. */
export type OverlayItem = Pick<WorkBoardItem | WorkItem, 'path' | 'title' | 'ticket' | 'steps'>

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e))

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

const BTN = 'h-8 rounded border border-line px-3 text-[13px] text-fg hover:bg-hover disabled:opacity-50'

/** The countdown and its ring. */
function Timer({ left }: { left: number }): JSX.Element {
  const r = 52
  const length = 2 * Math.PI * r
  const gone = (SESSION_SECONDS - left) / SESSION_SECONDS
  return (
    <div className="relative grid size-[128px] place-items-center" data-work-timer="">
      <svg viewBox="0 0 120 120" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="6" stroke="currentColor" className="text-line" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={length}
          strokeDashoffset={length * gone}
          className="text-[var(--work-you)] transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span className="relative font-mono text-[22px] tabular-nums text-fg" role="timer">
        {left > 0 ? clock(left) : WORK_TEXT.timesUp}
      </span>
    </div>
  )
}

function useCountdown(): number {
  const [start] = useState(() => Date.now())
  const [at, setAt] = useState(start)
  const left = Math.max(0, SESSION_SECONDS - Math.floor((at - start) / 1000))
  useEffect(() => {
    if (left <= 0) return
    const t = setInterval(() => setAt(Date.now()), 1000)
    return () => clearInterval(t)
  }, [left <= 0]) // eslint-disable-line react-hooks/exhaustive-deps
  return left
}

/** Send a capture about this item; a failure rejects with the server's detail. */
function sessionCapture(text: string, path: string) {
  return api.workCapture({ text, fromView: 'focusSession', linkedPath: path })
}

function SessionBody({ item, step }: { item: OverlayItem; step: WorkStep | null }): JSX.Element {
  const left = useCountdown()
  const [reveal, setReveal] = useState(false)
  const [tell, setTell] = useState('')
  const [tellError, setTellError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const closed = useRef(false)
  const ref = itemRef(item as { ticket: TicketInfo | null; title: string })

  const close = () => {
    if (closed.current) return
    closed.current = true
    useWorkOverlay.getState().close()
  }

  // The session closes once a step action lands (the Undo's reopen goes through it again: no-op).
  const run: WorkRunner = async (call) => {
    const res: WorkWriteResult | null = await directRunner(item.path)(call)
    if (res) close()
    return res
  }

  const stepDone = async () => {
    if (!step) return
    if (step.kind === 'question' || step.kind === 'approve') {
      setReveal(true)
      return
    }
    setBusy(true)
    try {
      await stepAction({ item, step, action: 'done', run })
    } finally {
      setBusy(false)
    }
  }

  const pause = () => {
    close()
    sessionCapture(WORK_TEXT.pausedCapture(ref), item.path).catch((e) => {
      if (!(e instanceof UnavailableError)) workToast(message(e))
    })
  }

  const sendTell = async () => {
    const text = tell.trim()
    if (!text) return
    try {
      await sessionCapture(WORK_TEXT.sessionCapture(ref, text), item.path)
      setTell('')
      setTellError(null)
    } catch (e) {
      setTellError(message(e))
    }
  }

  const doneOffered = step
    ? step.kind === 'question' || step.kind === 'approve'
      ? step.actions.length > 0
      : step.actions.includes('done')
    : false

  return (
    <div className="flex w-full max-w-[560px] flex-col items-center gap-5 text-center">
      <DialogTitle className="text-[20px] font-semibold text-fg">{item.title}</DialogTitle>
      {step ? (
        <p className="text-[15px] text-fg" data-work-session-step="">
          {step.text}
        </p>
      ) : null}
      <Timer left={left} />
      {reveal && step ? (
        <div className="w-full">
          <StepActions item={item as { path: string; title: string; ticket: TicketInfo | null }} step={step} run={run} />
        </div>
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={BTN} onClick={() => void stepDone()} disabled={!doneOffered || busy}>
          <Icon name={WORK_ICONS.done} size={14} className="mr-1 inline" />
          {WORK_TEXT.stepDone}
        </button>
        <button type="button" className={BTN} onClick={pause}>
          {WORK_TEXT.pause}
        </button>
        <button
          type="button"
          className={BTN}
          disabled={!step}
          onClick={() => step && useWorkOverlay.getState().openSmaller(item.path, step.id)}
        >
          <Icon name={WORK_ICONS.smaller} size={14} className="mr-1 inline" />
          {WORK_TEXT.tooBig}
        </button>
      </div>
      <div className="w-full text-left">
        <label className="flex h-9 items-center gap-2 rounded border border-line px-2 focus-within:border-[var(--work-capture)]">
          <Icon name={WORK_ICONS.capture} size={14} className="text-[var(--work-capture)]" />
          <input
            type="text"
            aria-label={WORK_TEXT.tellTheAgent}
            placeholder={WORK_TEXT.tellTheAgent}
            value={tell}
            maxLength={8000}
            onChange={(e) => setTell(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void sendTell()
              }
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-muted"
          />
        </label>
        {tellError ? <p className="mt-1 text-[12px] text-fg-muted">{tellError}</p> : null}
      </div>
    </div>
  )
}

/** The focus session for `item` (`useWorkOverlay.session`; null while it loads). Esc closes it. */
export function FocusSession({ item }: { item: OverlayItem | null }): JSX.Element {
  const step = item?.steps.find((s) => s.current) ?? null
  return (
    <Dialog open onOpenChange={(open) => !open && useWorkOverlay.getState().close()}>
      <DialogContent
        aria-describedby={undefined}
        data-work-session=""
        className="grid h-[calc(100vh-2rem)] max-w-[calc(100%-2rem)] place-items-center border-line bg-raised-2 text-fg sm:max-w-[calc(100%-2rem)]"
      >
        {item ? <SessionBody item={item} step={step} /> : <DialogTitle className="sr-only">{WORK_TEXT.startTogether}</DialogTitle>}
      </DialogContent>
    </Dialog>
  )
}
