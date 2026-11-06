// M23 Task 14: the work header's note box: Add note (`note`) and Ask the agent (`request`, M22's
// request note), and the M24 seam row: the agent status's note while no agent runs the queue.
import { useEffect, useState, type JSX } from 'react'
import { api } from '@/api/client'
import { WORK_TEXT } from '../workText'

const BTN = 'h-7 rounded border border-line px-2 text-[12px] text-fg hover:bg-hover disabled:opacity-50'

export function NoteBox({
  onSend,
}: {
  /** Send the text; resolves true when the server took it (the box is then cleared). */
  onSend: (kind: 'note' | 'request', text: string) => Promise<boolean>
}): JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [seam, setSeam] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.resolve()
      .then(() => api.workAgent())
      .then((s) => {
        if (alive) setSeam(s && !s.available ? s.note : null)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const send = async (kind: 'note' | 'request') => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      if (await onSend(kind, t)) setText('')
    } finally {
      setBusy(false)
    }
  }

  const empty = text.trim() === ''
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        aria-label={WORK_TEXT.addNote}
        value={text}
        maxLength={8000}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        className="min-h-[52px] w-full resize-y rounded border border-line bg-transparent px-2 py-1 text-[13px] text-fg outline-none"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={BTN} disabled={busy || empty} onClick={() => void send('note')}>
          {WORK_TEXT.addNote}
        </button>
        <button
          type="button"
          className={`${BTN} text-[var(--work-agent)]`}
          disabled={busy || empty}
          onClick={() => void send('request')}
        >
          {WORK_TEXT.askTheAgent}
        </button>
        {seam && (
          <span data-work-seam="" className="text-[12px] text-fg-muted">
            {seam}
          </span>
        )}
      </div>
    </div>
  )
}
