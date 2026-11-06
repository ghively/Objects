// M23 Task 9: Edit the day's focus lines: one line per focus line (the raw text, links as [[…]]).
// Save focus replaces only the Focus section's list lines (the server creates the daily note when
// it is missing); a stale version shows "Today's note changed. Look again." and reloads the lines.
import { useState, type JSX } from 'react'
import { api, ConflictError } from '@/api/client'
import type { FocusDay } from '@/api/types'
import { zonedToday } from '@/lib/zonedTime'
import { useWorkData } from '../state/useWorkData'
import { WORK_TEXT } from '../workText'

/** The text area's name (ours; not in `WORK_TEXT` yet, kept here until the review). */
const FOCUS_LINES_LABEL = 'Focus lines'

const BTN ='h-7 rounded border border-line px-2 text-[12px] text-fg hover:bg-hover disabled:opacity-50'

export function FocusEditor({ focus, onClose }: { focus: FocusDay | null; onClose(): void }): JSX.Element {
  const [text, setText] = useState(() => (focus?.lines ?? []).map((l) => l.text).join('\n'))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (busy) return
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '')
    if (!lines.length) {
      setError(WORK_TEXT.writeOneLine)
      return
    }
    setBusy(true)
    try {
      const day = focus?.day ?? useWorkData.getState().board?.today ?? zonedToday()
      const res = await api.saveWorkFocus(day, lines, focus?.version ?? null)
      useWorkData.setState({ focus: res })
      onClose()
    } catch (e) {
      if (e instanceof ConflictError) {
        setError(WORK_TEXT.focusChanged)
        void useWorkData.getState().load(['focus'])
      } else {
        setError(e instanceof Error && e.message ? e.message : String(e))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2" data-work-focus-editor="">
      <textarea
        aria-label={FOCUS_LINES_LABEL}
        rows={Math.min(10, Math.max(3, text.split('\n').length + 1))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded border border-line bg-transparent px-2 py-1 text-[13px] text-fg outline-none focus:border-[var(--work-you)]"
      />
      {error ? <p className="text-[12px] text-fg-muted">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" className={BTN} disabled={busy} onClick={() => void save()}>
          {WORK_TEXT.saveFocus}
        </button>
        <button type="button" className={BTN} onClick={onClose}>
          {WORK_TEXT.cancel}
        </button>
      </div>
    </div>
  )
}
