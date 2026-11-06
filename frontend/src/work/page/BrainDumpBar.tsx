// M23 Task 9: the brain-dump bar: one line, Enter saves it as a capture from the current view.
// Success clears the field (no toast); a failure keeps the text and shows why under the field
// (in M23 the capture seam answers 501 "Saving a brain dump comes with M24.").
import { useState, type JSX } from 'react'
import { api } from '@/api/client'
import type { WorkViewId } from '@/api/types'
import { Icon } from '@/components/Icon'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'

export function BrainDumpBar({ view }: { view: WorkViewId }): JSX.Element {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async () => {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      await api.workCapture({ text: value, fromView: view })
      setText('')
      setError(null)
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label className="flex h-9 items-center gap-2 rounded border border-line px-2 focus-within:border-[var(--work-capture)] focus-within:ring-1 focus-within:ring-[var(--work-capture)]">
        <Icon name={WORK_ICONS.capture} size={14} className="text-[var(--work-capture)]" />
        <input
          type="text"
          data-work-brain-dump=""
          aria-label={WORK_TEXT.brainDump}
          placeholder={WORK_TEXT.brainDumpPlaceholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-muted"
        />
      </label>
      {error ? <p className="mt-1 text-[12px] text-fg-muted">{error}</p> : null}
    </div>
  )
}

/** Focus the brain-dump bar (`B`). */
export function focusBrainDumpField(): void {
  document.querySelector<HTMLInputElement>('[data-work-brain-dump]')?.focus()
}
