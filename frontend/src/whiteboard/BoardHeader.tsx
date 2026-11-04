/**
 * The board title over the canvas, top left (`.whiteboard-title-fade`; the placement is our
 * choice). Click to rename; Enter or blur
 * commits, Escape cancels. The board `…` menu sits beside it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface BoardHeaderProps {
  title: string
  /** Renaming is off (deleted, or the title isn't loaded yet). */
  readOnly?: boolean
  onRename(title: string): Promise<void> | void
  menu?: ReactNode
  /** Extra actions at the right of the title row (the peek's "Open as page"). */
  actions?: ReactNode
}

export function BoardHeader({ title, readOnly, onRename, menu, actions }: BoardHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = async () => {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === title) return
    try {
      setError(null)
      await onRename(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="whiteboard-title-fade pointer-events-none absolute top-0 right-0 left-0 z-10 flex items-start gap-2 px-4 pt-3 pb-6">
      <div className="pointer-events-auto flex min-w-0 items-center gap-1">
        {editing ? (
          <input
            ref={inputRef}
            aria-label="Title"
            className="min-w-[200px] rounded-md bg-raised px-2 py-1 text-[20px] font-semibold text-fg outline-none"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setEditing(false)
              }
            }}
          />
        ) : (
          <h1
            className="cursor-text truncate rounded-md px-2 py-1 text-[20px] font-semibold text-fg hover:bg-hover"
            data-whiteboard-title=""
            onClick={() => {
              if (readOnly) return
              setDraft(title)
              setEditing(true)
            }}
          >
            {title}
          </h1>
        )}
        {menu}
      </div>
      {error && (
        <p role="alert" className="pointer-events-auto self-center text-[13px] text-red-400">
          {error}
        </p>
      )}
      <div className="pointer-events-auto ml-auto flex items-center gap-1">{actions}</div>
    </div>
  )
}
