// M23 Task 8: a step's inline actions, wherever the step shows (Now, the queues, the panel). Only a
// current step offers anything, and only the actions the server lists in `step.actions`:
//   Question → an answer box and Send (Enter sends); Do → Done and a note box (sent as `text`);
//   Approve open → Approve (two presses), Not before (a date-time going with the second press),
//   Decline (a reason box and a confirming Decline); Approve approved → Withdraw (`reopen`);
//   Agent open → Run now and Done; Agent approved → Done.
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { StepAction, TicketInfo, WorkStep } from '@/api/types'
import { zonedInstant } from '@/lib/zonedTime'
import { cn } from '@/lib/utils'
import { APPROVE_ARM_MS, stepAction, type WorkRunner } from '../state/workActions'
import { WORK_TEXT } from '../workText'

export interface StepActionsProps {
  item: { path: string; title: string; ticket: TicketInfo | null }
  step: WorkStep
  run?: WorkRunner
  compact?: boolean
}

/** A `datetime-local` value (`YYYY-MM-DDTHH:MM`), read in the space zone, as a UTC instant. */
function localToInstant(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  return zonedInstant(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0)).toISOString()
}

const BTN = 'h-7 rounded border border-line px-2 text-[12px] text-fg hover:bg-hover disabled:opacity-50'
const BOX = 'h-7 min-w-0 flex-1 rounded border border-line bg-transparent px-2 text-[13px] text-fg outline-none placeholder:text-fg-muted'

export function StepActions({ item, step, run, compact = false }: StepActionsProps): JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState('')
  const [note, setNote] = useState('')
  const [armed, setArmed] = useState(false)
  const [notBeforeOpen, setNotBeforeOpen] = useState(false)
  const [notBefore, setNotBefore] = useState('')
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (armTimer.current !== null) clearTimeout(armTimer.current)
    },
    [],
  )

  if (!step.current) return null
  const can = (a: StepAction) => step.actions.includes(a)

  const act = async (action: StepAction, extra: { text?: string; notBefore?: string } = {}) => {
    if (busy) return false
    setBusy(true)
    try {
      return await stepAction({ item, step, action, run, ...extra })
    } finally {
      setBusy(false)
    }
  }

  const sendAnswer = async () => {
    const text = answer.trim()
    if (!text) return
    if (await act('answer', { text })) setAnswer('')
  }

  const pressApprove = () => {
    if (!armed) {
      setArmed(true)
      if (armTimer.current !== null) clearTimeout(armTimer.current)
      armTimer.current = setTimeout(() => {
        armTimer.current = null
        setArmed(false)
      }, APPROVE_ARM_MS)
      return
    }
    if (armTimer.current !== null) clearTimeout(armTimer.current)
    armTimer.current = null
    setArmed(false)
    const at = notBeforeOpen ? localToInstant(notBefore) : null
    void act('approve', at ? { notBefore: at } : {})
  }

  const confirmDecline = async () => {
    const text = reason.trim()
    if (await act('decline', text ? { text } : {})) {
      setDeclining(false)
      setReason('')
    }
  }

  const onEnter = (fn: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      fn()
    }
  }

  const parts: JSX.Element[] = []
  const { kind, state } = step

  if (kind === 'question' && can('answer')) {
    parts.push(
      <span key="answer" className="flex min-w-0 flex-1 items-center gap-1.5">
        <input
          aria-label={WORK_TEXT.typeTheAnswer}
          placeholder={WORK_TEXT.typeTheAnswer}
          value={answer}
          maxLength={8000}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={onEnter(() => void sendAnswer())}
          className={BOX}
        />
        <button type="button" className={BTN} disabled={busy} onClick={() => void sendAnswer()}>
          {WORK_TEXT.send}
        </button>
      </span>,
    )
  }

  if (kind === 'do' && can('done')) {
    const done = () => {
      const text = note.trim()
      void act('done', text ? { text } : {}).then((ok) => ok && setNote(''))
    }
    parts.push(
      <span key="done" className="flex min-w-0 flex-1 items-center gap-1.5">
        {!compact && (
          <input
            aria-label={WORK_TEXT.whatYouFound}
            placeholder={WORK_TEXT.whatYouFound}
            value={note}
            maxLength={8000}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={onEnter(done)}
            className={BOX}
          />
        )}
        <button type="button" className={BTN} disabled={busy} onClick={done}>
          {WORK_TEXT.done}
        </button>
      </span>,
    )
  }

  if (kind === 'approve' && state === 'open') {
    if (can('approve')) {
      parts.push(
        <button
          key="approve"
          type="button"
          data-armed={armed ? '' : undefined}
          className={cn(BTN, 'text-[var(--work-approve)]', armed && 'border-[var(--work-approve)] font-medium')}
          disabled={busy}
          onClick={pressApprove}
        >
          {armed ? WORK_TEXT.approveArmed : WORK_TEXT.approve}
        </button>,
      )
      parts.push(
        notBeforeOpen ? (
          <label key="notBefore" className="inline-flex items-center gap-1 text-[12px] text-fg-muted">
            {WORK_TEXT.notBefore}
            <input
              type="datetime-local"
              aria-label={WORK_TEXT.notBefore}
              value={notBefore}
              onChange={(e) => setNotBefore(e.target.value)}
              className="h-7 rounded border border-line bg-transparent px-1 text-fg"
            />
          </label>
        ) : (
          <button key="notBefore" type="button" className={BTN} disabled={busy} onClick={() => setNotBeforeOpen(true)}>
            {WORK_TEXT.notBefore}
          </button>
        ),
      )
    }
    if (can('decline')) {
      parts.push(
        declining ? (
          <span key="decline" className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              aria-label={WORK_TEXT.reasonOptional}
              placeholder={WORK_TEXT.reasonOptional}
              autoFocus
              value={reason}
              maxLength={8000}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setDeclining(false)
                  return
                }
                onEnter(() => void confirmDecline())(e)
              }}
              className={BOX}
            />
            <button type="button" className={BTN} disabled={busy} onClick={() => void confirmDecline()}>
              {WORK_TEXT.decline}
            </button>
          </span>
        ) : (
          <button key="decline" type="button" className={BTN} disabled={busy} onClick={() => setDeclining(true)}>
            {WORK_TEXT.decline}
          </button>
        ),
      )
    }
  }

  if (kind === 'approve' && state === 'approved' && can('reopen')) {
    parts.push(
      <button key="withdraw" type="button" className={BTN} disabled={busy} onClick={() => void act('reopen')}>
        {WORK_TEXT.withdraw}
      </button>,
    )
  }

  if (kind === 'agent') {
    if (state === 'open' && can('run')) {
      parts.push(
        <button key="run" type="button" className={cn(BTN, 'text-[var(--work-agent)]')} disabled={busy} onClick={() => void act('run')}>
          {WORK_TEXT.runNow}
        </button>,
      )
    }
    if ((state === 'open' || state === 'approved') && can('done')) {
      parts.push(
        <button key="done" type="button" className={BTN} disabled={busy} onClick={() => void act('done')}>
          {WORK_TEXT.done}
        </button>,
      )
    }
  }

  if (!parts.length) return null
  return (
    <div
      role="group"
      aria-label={`Step ${step.n} actions`}
      data-work-step-actions=""
      className={cn('flex flex-wrap items-center gap-1.5', compact && 'gap-1')}
    >
      {parts}
    </div>
  )
}
