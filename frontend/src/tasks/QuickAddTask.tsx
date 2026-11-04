// The Tasks page's quick add: type a title, Enter (or "Add task")
// creates a Task without opening it, and the field keeps focus for the next one.
import { useRef, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { invalidateLinkIndex } from '@/links/linkIndex'

export const QUICK_ADD_TEXT = {
  placeholder: 'Task title',
  button: 'Add task',
  created: (taskName: string) => `Created task "${taskName}"`,
}

export interface QuickAddTaskProps {
  /** The basic Task type's id (from `types`, never hard-coded). */
  taskTypeId: string | undefined
  /** Values the new task gets so it shows in the current view (`matchingValues`). */
  values?(): Record<string, unknown>
}

export function QuickAddTask({ taskTypeId, values }: QuickAddTaskProps) {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const add = async () => {
    const name = title.trim()
    if (!name || !taskTypeId || busy) return
    setBusy(true)
    try {
      const v = values?.() ?? {}
      await api.createObject(taskTypeId, Object.keys(v).length > 0 ? { title: name, values: v } : { title: name })
      setTitle('')
      setMessage(QUICK_ADD_TEXT.created(name))
      void invalidateLinkIndex()
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
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void add()
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-muted"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={!title.trim() || !taskTypeId}
          className="h-7 rounded-md px-2.5 text-[13px] font-medium hover:bg-hover disabled:opacity-50"
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
