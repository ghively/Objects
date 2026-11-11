// The quick add ("Add a task"): type a title, Enter (or "Add task") creates a Task without opening
// it, and the field keeps focus for the next one.
//
// M32: date words anywhere in the text ("Call Pat friday", "nov 20", "next week", "in 3 days";
// `findDate.ts`) set the task's date. While typing they show as a chip beside the field; Backspace
// at the start of the field, or the chip's ×, removes the chip, and the words then stay in the
// title as typed. The new file's body is sent empty, so its text does not repeat the title (the
// server would write `# <title>` there); a type with a default template keeps the template's body.
import { useMemo, useRef, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { useZonedToday } from '@/lib/zonedShell'
import { invalidateLinkIndex, typeOf } from '@/links/linkIndex'
import { formatDate } from '@/properties/format'
import { findDatePhrase } from './findDate'

export const QUICK_ADD_TEXT = {
  placeholder: 'Add a task',
  button: 'Add task',
  created: (taskName: string) => `Created task "${taskName}"`,
  /** The date chip's × (our string). */
  removeDate: 'Remove date',
}

export interface QuickAddTaskProps {
  /** The basic Task type's id (from `types`, never hard-coded). */
  taskTypeId: string | undefined
  /** Values the new task gets so it shows in the current view (`matchingValues`). */
  values?(): Record<string, unknown>
  /** M32: the task was created (the owner may show it at once). */
  onAdded?(path: string): void
}

export function QuickAddTask({ taskTypeId, values, onAdded }: QuickAddTaskProps) {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The date words whose chip was removed: they stay words until other date words are typed. */
  const [ignored, setIgnored] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const today = useZonedToday()
  const found = useMemo(() => findDatePhrase(title, today), [title, today])
  const dated = found && found.phrase.toLowerCase() !== ignored ? found : null

  const removeDate = () => {
    if (found) setIgnored(found.phrase.toLowerCase())
    input.current?.focus()
  }

  const add = async () => {
    const name = (dated ? dated.title : title).trim()
    if (!name || !taskTypeId || busy) return
    setBusy(true)
    try {
      const v = { ...(values?.() ?? {}), ...(dated ? { date: { start: dated.day, resolution: 'day' } } : {}) }
      const req: { title: string; body?: string; values?: Record<string, unknown> } = { title: name }
      // No template to fill the body: send it empty instead of the server's `# <title>`.
      if (!typeOf(taskTypeId)?.templates?.defaultTemplateId) req.body = ''
      if (Object.keys(v).length > 0) req.values = v
      const res = await api.createObject(taskTypeId, req)
      setTitle('')
      setIgnored(null)
      setMessage(QUICK_ADD_TEXT.created(name))
      void invalidateLinkIndex()
      if (res?.path) onAdded?.(res.path)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-9 items-center gap-2 rounded-lg border border-line bg-raised px-2.5 focus-within:border-fg-muted">
        <Icon name="ph-plus" size={14} className="text-fg-muted" />
        <input
          ref={input}
          aria-label={QUICK_ADD_TEXT.placeholder}
          placeholder={QUICK_ADD_TEXT.placeholder}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            if (!e.target.value) setIgnored(null)
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            } else if (e.key === 'Backspace' && dated && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
              // Nothing before the caret to delete: the chip goes, the words stay.
              e.preventDefault()
              removeDate()
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-muted"
        />
        {dated && (
          <span
            data-testid="quick-add-date"
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-hover-2 pr-1 pl-2 text-[13px] text-fg"
          >
            <Icon name="ph-calendar" size={13} className="text-fg-muted" />
            {formatDate({ start: dated.day, resolution: 'day' })}
            <button
              type="button"
              aria-label={QUICK_ADD_TEXT.removeDate}
              title={QUICK_ADD_TEXT.removeDate}
              onClick={removeDate}
              className="flex size-4 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"
            >
              <Icon name="ph-x" size={10} />
            </button>
          </span>
        )}
        <button
          type="button"
          onClick={() => void add()}
          disabled={!title.trim() || !taskTypeId}
          className="h-7 shrink-0 rounded-md px-2.5 text-[13px] font-medium hover:bg-hover disabled:opacity-50"
        >
          {QUICK_ADD_TEXT.button}
        </button>
      </div>
      {message && (
        <p role="status" className="px-1 text-[13px] text-fg-muted">
          {message}
        </p>
      )}
    </div>
  )
}
