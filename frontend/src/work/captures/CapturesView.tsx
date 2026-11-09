// M24 Task 10: Captures: brain dumps with their filing state; a Needs you row shows the agent's
// question with a reply box (Send) and Mark filed. A 409 reloads and toasts; success shows nothing.
import { useEffect, useRef, useState, type JSX } from 'react'
import { api, ConflictError } from '@/api/client'
import type { CaptureItem } from '@/api/types'
import { Chip } from '../components/Chip'
import { openItemPanel } from '../state/workActions'
import { workToast } from '../state/workToasts'
import type { WorkViewProps } from '../views/registry'
import { CAPTURE_TEXT } from './captureText'
import { useCaptures } from './useCaptures'

type Filter = 'all' | CaptureItem['status']

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: CAPTURE_TEXT.filterAll },
  { id: 'new', label: CAPTURE_TEXT.filterNew },
  { id: 'needsYou', label: CAPTURE_TEXT.filterNeedsYou },
  { id: 'filed', label: CAPTURE_TEXT.filterFiled },
]

function StatusChip({ status }: { status: CaptureItem['status'] }): JSX.Element {
  if (status === 'filed') return <Chip tone="ok">{CAPTURE_TEXT.statusFiled}</Chip>
  if (status === 'needsYou') return <Chip tone="approve">{CAPTURE_TEXT.statusNeedsYou}</Chip>
  return <Chip tone="capture">{CAPTURE_TEXT.statusNew}</Chip>
}

function CaptureRow({ c, onChanged, focusReply }: { c: CaptureItem; onChanged: () => Promise<void>; focusReply?: boolean }): JSX.Element {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLInputElement>(null)

  // Fix pass H: the row a parked dump on Now asked for: its reply box takes the focus once.
  useEffect(() => {
    if (!focusReply || !box.current) return
    box.current.focus()
    box.current.scrollIntoView?.({ block: 'nearest' })
    useCaptures.getState().reply(null)
  }, [focusReply])

  const act = async (call: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await call()
      setReply('')
    } catch (e) {
      workToast(e instanceof ConflictError ? CAPTURE_TEXT.changed : e instanceof Error && e.message ? e.message : String(e))
    } finally {
      await onChanged()
      setBusy(false)
    }
  }

  return (
    <li data-capture-row={c.path} className="flex min-w-0 flex-col border-b border-line px-1 py-1 text-[13px]">
      <div className="flex min-h-9 min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-fg">{c.title}</span>
        <span className="shrink-0 text-[12px] text-fg-muted" title={CAPTURE_TEXT.capturedAt}>
          {c.capturedAt.slice(0, 10)}
        </span>
        {c.fromView && <span className="shrink-0 text-[12px] text-fg-muted">{CAPTURE_TEXT.fromView} {c.fromView}</span>}
        <StatusChip status={c.status} />
        {c.filedTo && (
          <button
            type="button"
            aria-label={`${CAPTURE_TEXT.filedTo} ${c.filedTo.title}`}
            onClick={() => openItemPanel(c.filedTo!.path)}
            className="shrink-0 text-[12px] text-fg hover:underline"
          >
            {c.filedTo.title}
          </button>
        )}
        {c.linkedPath && (
          <button
            type="button"
            aria-label={`${CAPTURE_TEXT.linkedItem} ${c.linkedTitle ?? c.linkedPath}`}
            onClick={() => openItemPanel(c.linkedPath!)}
            className="shrink-0 text-[12px] text-fg hover:underline"
          >
            {c.linkedTitle ?? c.linkedPath}
          </button>
        )}
      </div>
      {c.status === 'needsYou' && (
        <div className="flex min-w-0 flex-col gap-1 pb-1">
          {c.question && (
            <p className="text-[12px] text-fg-muted">
              {CAPTURE_TEXT.question}: {c.question}
            </p>
          )}
          <div className="flex items-center gap-2">
            <input
              ref={box}
              type="text"
              aria-label={CAPTURE_TEXT.replyLabel}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              className="h-7 min-w-0 flex-1 rounded border border-line bg-transparent px-2 text-[13px] text-fg outline-none"
            />
            <button
              type="button"
              disabled={busy || !reply.trim()}
              onClick={() => void act(() => api.replyCapture(c.path, c.version, reply.trim()))}
              className="h-7 shrink-0 rounded border border-line px-2 text-[12px] text-fg hover:bg-hover disabled:opacity-50"
            >
              {CAPTURE_TEXT.send}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => api.markCaptureFiled(c.path, c.version))}
              className="h-7 shrink-0 rounded border border-line px-2 text-[12px] text-fg hover:bg-hover disabled:opacity-50"
            >
              {CAPTURE_TEXT.markFiled}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

export function CapturesView(_props: WorkViewProps): JSX.Element {
  const items = useCaptures((s) => s.items)
  const loaded = useCaptures((s) => s.loaded)
  const load = useCaptures((s) => s.load)
  const replyTo = useCaptures((s) => s.replyTo)
  const [filter, setFilter] = useState<Filter>(() => (useCaptures.getState().replyTo ? 'needsYou' : 'all'))

  useEffect(() => {
    void load()
  }, [load])

  const shown = filter === 'all' ? items : items.filter((c) => c.status === filter)

  return (
    <div data-work-view="captures" className="flex min-w-0 flex-col gap-3">
      <div role="group" aria-label={CAPTURE_TEXT.label} className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className="h-7 rounded border border-line px-2 text-[12px] text-fg hover:bg-hover aria-pressed:bg-hover"
          >
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 && loaded ? (
        <p className="text-[13px] text-fg-muted">{CAPTURE_TEXT.empty}</p>
      ) : (
        <ul className="flex min-w-0 flex-col">
          {shown.map((c) => (
            <CaptureRow key={c.path} c={c} onChanged={load} focusReply={replyTo === c.path} />
          ))}
        </ul>
      )}
    </div>
  )
}
