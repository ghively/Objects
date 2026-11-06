// M22: the step list editor (plan `2026-11-05-m22-work-model.md`, Contract "Editors"). Rows with a
// kind chip and a state chip (text and a dot), the current step highlighted with the accent, a drag
// handle to reorder (`move`), inline text edit (`edit`), a row menu (Change kind, Remove) and
// "+ Add step" with a kind picker. The state chip opens the step's actions (what the user may do on
// it now, from `allowedActions`): Answer…, Mark done, Approve (pressed twice), Decline…, Run now,
// Withdraw, Reopen. Every change is shown at once and put back when the write fails. The server
// decides; M23 reuses this list in the work header.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { StepAction, StepKind, StepOp, StepState, StepValue } from '@/api/types'
import { STEP_KIND_LABELS, STEP_STATE_LABELS } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { lineColor } from '@/theme/palette'
import { allowedActions, applyAction, currentIndex, type RuleStep } from './stepRules'

export interface StepActionExtra {
  text?: string
  notBefore?: string
}

export interface StepListProps {
  steps: readonly StepValue[]
  readOnly?: boolean
  /** Resolves false when the write failed (the list is put back). */
  onOps(ops: StepOp[]): Promise<boolean>
  /** Resolves false when the write failed (the row is put back). */
  onAction(stepId: string, stepRev: string, action: StepAction, extra?: StepActionExtra): Promise<boolean>
}

/** `StepValue` has no index signature; the rules take any step-shaped row. */
const asRules = (steps: readonly StepValue[]) => steps as unknown as readonly RuleStep[]

const KINDS: StepKind[] = ['question', 'do', 'approve', 'agent']

const KIND_COLOR: Record<StepKind, string> = { question: 'purple', do: 'gray', approve: 'orange', agent: 'blue' }
const STATE_COLOR: Record<StepState, string> = { open: 'gray', approved: 'blue', done: 'green', declined: 'red' }

/** The accent of the current step. */
const ACCENT = lineColor('blue')

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: lineColor(color) }} />
}

/** The label of an action button for this step. */
function actionLabel(action: StepAction, step: StepValue): string {
  switch (action) {
    case 'answer':
      return 'Answer…'
    case 'done':
      return 'Mark done'
    case 'approve':
      return 'Approve'
    case 'decline':
      return 'Decline…'
    case 'run':
      return 'Run now'
    case 'reopen':
      return step.state === 'approved' ? 'Withdraw' : 'Reopen'
    default:
      return action
  }
}

/** A datetime-local value ("2026-11-05T14:30") as an ISO UTC instant; '' → undefined. */
function toInstant(local: string): string | undefined {
  if (!local) return undefined
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export function StepList({ steps, readOnly, onOps, onAction }: StepListProps) {
  const [shown, setShown] = useState<StepValue[]>(() => [...steps])
  useEffect(() => setShown([...steps]), [steps])

  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const dragged = useRef<string | null>(null)
  const [dropOver, setDropOver] = useState<string | null>(null)

  const current = currentIndex(shown)

  /** Show `next` now; put `prev` back when the write fails. */
  const optimistic = async (prev: StepValue[], next: StepValue[], write: () => Promise<boolean>) => {
    setShown(next)
    let ok = false
    try {
      ok = await write()
    } catch {
      ok = false
    }
    if (!ok) setShown(prev)
    return ok
  }

  const sendOps = (ops: StepOp[], next: StepValue[]) => optimistic(shown, next, () => onOps(ops))

  const act = (i: number, action: StepAction, extra?: StepActionExtra) => {
    const s = shown[i]
    let next: StepValue[] = shown
    try {
      next = applyAction(asRules(shown), i, action, 'user', {
        now: new Date(),
        text: extra?.text ?? null,
        notBefore: extra?.notBefore ?? null,
      }) as unknown as StepValue[]
    } catch {
      next = shown
    }
    setOpenMenu(null)
    return optimistic(shown, next, () => onAction(s.id, s.rev, action, extra))
  }

  const move = (stepId: string, before: string | null) => {
    if (stepId === before) return
    const s = shown.find((x) => x.id === stepId)
    if (!s) return
    const rest = shown.filter((x) => x.id !== stepId)
    const at = before === null ? rest.length : rest.findIndex((x) => x.id === before)
    if (at < 0) return
    const next = [...rest.slice(0, at), s, ...rest.slice(at)]
    if (next.every((x, k) => x.id === shown[k].id)) return
    void sendOps([{ op: 'move', stepId, stepRev: s.rev, before }], next)
  }

  const edit = (s: StepValue, text: string) => {
    setEditing(null)
    const t = text.trim()
    if (!t || t === s.text) return
    void sendOps(
      [{ op: 'edit', stepId: s.id, stepRev: s.rev, text: t }],
      shown.map((x) => (x.id === s.id ? { ...x, text: t } : x)),
    )
  }

  const changeKind = (s: StepValue, kind: StepKind) => {
    setRowMenu(null)
    if (kind === s.kind) return
    void sendOps(
      [{ op: 'edit', stepId: s.id, stepRev: s.rev, kind }],
      shown.map((x) => (x.id === s.id ? { ...x, kind } : x)),
    )
  }

  const remove = (s: StepValue) => {
    setRowMenu(null)
    void sendOps([{ op: 'remove', stepId: s.id, stepRev: s.rev }], shown.filter((x) => x.id !== s.id))
  }

  const add = (kind: StepKind, text: string) => {
    const t = text.trim()
    if (!t) return false
    const draft: StepValue = {
      id: `@${shown.length + 1}`,
      rev: '',
      kind,
      state: 'open',
      text: t,
      notBefore: null,
      answer: null,
      result: null,
      addedAt: new Date().toISOString(),
      approvedAt: null,
      doneAt: null,
      declinedAt: null,
    }
    void sendOps([{ op: 'add', kind, text: t }], [...shown, draft])
    return true
  }

  return (
    <div className="flex flex-col gap-0.5 py-0.5">
      <ol className="flex flex-col gap-0.5">
        {shown.map((s, i) => {
          const isCurrent = i === current
          const actions = readOnly ? [] : allowedActions(asRules(shown), i, 'user')
          const approvedOrDoneApprove = s.kind === 'approve' && (s.state === 'approved' || s.state === 'done')
          const textEditable = !readOnly && !approvedOrDoneApprove && s.state !== 'approved'
          const n = i + 1
          return (
            <li
              key={s.id}
              aria-current={isCurrent ? 'step' : undefined}
              data-drop-over={dropOver === s.id || undefined}
              onDragOver={(e) => {
                if (readOnly || !dragged.current) return
                e.preventDefault()
                setDropOver(s.id)
              }}
              onDragLeave={() => setDropOver((d) => (d === s.id ? null : d))}
              onDrop={(e) => {
                if (readOnly || !dragged.current) return
                e.preventDefault()
                const from = dragged.current
                dragged.current = null
                setDropOver(null)
                move(from, s.id)
              }}
              className={cn(
                'group relative flex flex-col rounded-md px-1 py-0.5 text-[14px]',
                isCurrent && 'bg-hover',
                dropOver === s.id && 'ring-1 ring-ring',
              )}
              style={isCurrent ? { boxShadow: `inset 2px 0 0 ${ACCENT}` } : undefined}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                {!readOnly && (
                  <button
                    type="button"
                    draggable
                    aria-label="Drag to reorder"
                    onDragStart={(e) => {
                      dragged.current = s.id
                      try {
                        e.dataTransfer?.setData('text/plain', s.id)
                        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                      } catch {
                        // a test's DataTransfer stand-in
                      }
                    }}
                    onDragEnd={() => {
                      dragged.current = null
                      setDropOver(null)
                    }}
                    className="flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-fg-muted opacity-60 hover:opacity-100"
                  >
                    <Icon name="ph-dots-six-vertical" size={12} />
                  </button>
                )}
                <span className="w-4 shrink-0 text-right text-[12px] text-fg-muted">{n}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-fg-muted">
                  <Dot color={KIND_COLOR[s.kind]} />
                  {STEP_KIND_LABELS[s.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  {editing === s.id ? (
                    <EditBox
                      label={`Step ${n} text`}
                      initial={s.text}
                      onCommit={(t) => edit(s, t)}
                      onCancel={() => setEditing(null)}
                    />
                  ) : textEditable ? (
                    <button
                      type="button"
                      aria-label={`Edit step ${n}`}
                      onClick={() => setEditing(s.id)}
                      className={cn('w-full truncate text-left text-fg', s.state === 'declined' && 'text-fg-muted line-through')}
                    >
                      {s.text}
                    </button>
                  ) : (
                    <span className={cn('block truncate text-fg', s.state === 'declined' && 'text-fg-muted line-through')}>{s.text}</span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`State: ${STEP_STATE_LABELS[s.state]}`}
                  aria-expanded={openMenu === s.id}
                  disabled={actions.length === 0}
                  onClick={() => setOpenMenu((m) => (m === s.id ? null : s.id))}
                  className="inline-flex shrink-0 items-center gap-1 rounded px-1 text-[12px] text-fg-muted enabled:hover:bg-hover enabled:hover:text-fg"
                >
                  <Dot color={STATE_COLOR[s.state]} />
                  {STEP_STATE_LABELS[s.state]}
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={`Step ${n} menu`}
                    aria-expanded={rowMenu === s.id}
                    onClick={() => setRowMenu((m) => (m === s.id ? null : s.id))}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-muted opacity-60 hover:bg-hover hover:opacity-100"
                  >
                    <Icon name="ph-dots-three" size={14} />
                  </button>
                )}
              </div>
              {s.answer && <p className="ml-10 truncate text-[12px] text-fg-muted">{s.answer}</p>}
              {s.result && <p className="ml-10 truncate text-[12px] text-fg-muted">{s.result}</p>}
              {openMenu === s.id && actions.length > 0 && (
                <ActionRow n={n} step={s} actions={actions} onAct={(a, extra) => void act(i, a, extra)} onClose={() => setOpenMenu(null)} />
              )}
              {rowMenu === s.id && !readOnly && (
                <div role="group" aria-label={`Step ${n} menu`} className="ml-10 mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                  {s.state === 'open' && (
                    <label className="inline-flex items-center gap-1 text-fg-muted">
                      Change kind
                      <select
                        aria-label="Change kind"
                        value={s.kind}
                        onChange={(e) => changeKind(s, e.target.value as StepKind)}
                        className="rounded border border-line bg-raised px-1 text-fg"
                      >
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {STEP_KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button type="button" onClick={() => remove(s)} className="rounded px-1.5 text-fg-muted hover:bg-hover hover:text-fg">
                    Remove
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {!readOnly && shown.length > 0 && (
        <div
          aria-hidden
          className={cn('h-1.5 rounded', dropOver === '@end' && 'bg-hover')}
          onDragOver={(e) => {
            if (!dragged.current) return
            e.preventDefault()
            setDropOver('@end')
          }}
          onDragLeave={() => setDropOver((d) => (d === '@end' ? null : d))}
          onDrop={(e) => {
            if (!dragged.current) return
            e.preventDefault()
            const from = dragged.current
            dragged.current = null
            setDropOver(null)
            move(from, null)
          }}
        />
      )}
      {!readOnly &&
        (adding ? (
          <AddStep onAdd={add} onDone={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="self-start rounded px-1 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
          >
            + Add step
          </button>
        ))}
    </div>
  )
}

/** A one-line text box: Enter commits, Escape cancels, blur commits. */
function EditBox({ label, initial, onCommit, onCancel }: { label: string; initial: string; onCommit(t: string): void; onCancel(): void }) {
  const [text, setText] = useState(initial)
  const done = useRef(false)
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit) onCommit(text)
    else onCancel()
  }
  return (
    <input
      aria-label={label}
      autoFocus
      value={text}
      maxLength={500}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      className="w-full bg-transparent text-fg outline-none"
    />
  )
}

function AddStep({ onAdd, onDone }: { onAdd(kind: StepKind, text: string): boolean; onDone(): void }) {
  const [kind, setKind] = useState<StepKind>('do')
  const [text, setText] = useState('')
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (onAdd(kind, text)) setText('')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onDone()
    }
  }
  return (
    <div className="flex items-center gap-1.5 px-1 text-[14px]">
      <select
        aria-label="Kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as StepKind)}
        className="rounded border border-line bg-raised px-1 text-[12px] text-fg"
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {STEP_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <input
        aria-label="New step"
        autoFocus
        value={text}
        maxLength={500}
        placeholder="New step"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={key}
        onBlur={(e) => {
          // Picking a kind keeps the row open; leaving it empty closes it.
          if (!text.trim() && !e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) onDone()
        }}
        className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-muted"
      />
    </div>
  )
}

/** The actions of one step: plain buttons, Approve pressed twice, Answer and Decline with a box. */
function ActionRow({
  n,
  step,
  actions,
  onAct,
  onClose,
}: {
  n: number
  step: StepValue
  actions: StepAction[]
  onAct(action: StepAction, extra?: StepActionExtra): void
  onClose(): void
}) {
  const [armed, setArmed] = useState(false)
  const [asking, setAsking] = useState<'answer' | 'decline' | null>(null)
  const [text, setText] = useState('')
  const [notBefore, setNotBefore] = useState('')

  const btn = 'rounded border border-line bg-raised px-1.5 text-[12px] text-fg hover:bg-hover'

  const submitBox = () => {
    const t = text.trim()
    if (asking === 'answer') {
      if (!t) return
      onAct('answer', { text: t })
    } else if (asking === 'decline') {
      onAct('decline', t ? { text: t } : undefined)
    }
  }

  return (
    <div
      role="group"
      aria-label={`Step ${n} actions`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      className="ml-10 mt-0.5 flex flex-wrap items-center gap-1.5"
    >
      {actions.map((a) => {
        if (a === 'approve') {
          return (
            <span key={a} className="inline-flex items-center gap-1.5">
              <button
                type="button"
                className={btn}
                onClick={() => {
                  if (!armed) {
                    setArmed(true)
                    return
                  }
                  const at = toInstant(notBefore)
                  onAct('approve', at ? { notBefore: at } : undefined)
                }}
              >
                {armed ? 'Press again to approve' : 'Approve'}
              </button>
              <label className="inline-flex items-center gap-1 text-[12px] text-fg-muted">
                Not before
                <input
                  type="datetime-local"
                  aria-label="Not before"
                  value={notBefore}
                  onChange={(e) => setNotBefore(e.target.value)}
                  className="rounded border border-line bg-raised px-1 text-fg"
                />
              </label>
            </span>
          )
        }
        if (a === 'answer' || a === 'decline') {
          return (
            <button key={a} type="button" className={btn} onClick={() => setAsking(a)}>
              {actionLabel(a, step)}
            </button>
          )
        }
        return (
          <button key={a} type="button" className={btn} onClick={() => onAct(a)}>
            {actionLabel(a, step)}
          </button>
        )
      })}
      {asking && (
        <span className="inline-flex w-full items-center gap-1.5">
          <input
            aria-label={asking === 'answer' ? 'Answer' : 'Reason'}
            autoFocus
            value={text}
            maxLength={8000}
            placeholder={asking === 'answer' ? 'Answer' : 'Reason (optional)'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitBox()
              }
            }}
            className="min-w-0 flex-1 rounded border border-line bg-raised px-1.5 text-[13px] text-fg outline-none"
          />
          <button type="button" className={btn} disabled={asking === 'answer' && !text.trim()} onClick={submitBox}>
            {asking === 'answer' ? 'Answer' : 'Decline'}
          </button>
        </span>
      )}
    </div>
  )
}
