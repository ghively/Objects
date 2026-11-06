/**
 * M17: the agent page's Instructions tab (spec section 2): the agent's soul, its `CLAUDE.md`, in
 * Object's editor (`StringEditor`). It autosaves 1,000 ms after the last change and on blur, with
 * the revision it loaded (`PUT /agents/{id}/instructions`). A 409 keeps the text as typed and
 * shows "Changed elsewhere. Reload?"; Reload loads the file's current text. A read-only agent's
 * editor can't be edited.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ConflictError } from '@/api/client'
import type { Agent } from '@/api/types'
import { Button } from '@/components/ui/button'
import { StringEditor } from '@/editor/StringEditor'

/** Milliseconds after the last change before the instructions are saved (plan). */
export const INSTRUCTIONS_SAVE_MS = 1000

// Our strings ("Changed elsewhere. Reload?" is the plan's).
export const INSTRUCTIONS_TEXT = {
  editor: 'Instructions',
  intro: "Who this agent is and how it works. Saved as the CLAUDE.md in the agent's folder.",
  placeholder: 'Who this agent is and how it should work.',
  conflict: 'Changed elsewhere. Reload?',
  reload: 'Reload',
  loading: 'Loading…',
} as const

interface Loaded {
  text: string
  /** Bumped on each load, so a reload remounts the editor with the file's text. */
  n: number
}

export function InstructionsTab({ agent }: { agent: Agent }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revision = useRef<string | null>(null)
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const blocked = useRef(false)
  const id = agent.id

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await api.agentInstructions(id)
      revision.current = res?.revision ?? null
      pending.current = null
      blocked.current = false
      setConflict(false)
      setLoaded((prev) => ({ text: res?.text ?? '', n: (prev?.n ?? 0) + 1 }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (pending.current === null || blocked.current) return saving.current
    const text = pending.current
    pending.current = null
    saving.current = saving.current.then(async () => {
      try {
        const res = await api.saveAgentInstructions(id, text, revision.current)
        revision.current = res?.revision ?? revision.current
        setError(null)
      } catch (e) {
        // Keep what was typed: it is saved again after a reload, or by the next edit.
        if (pending.current === null) pending.current = text
        if (e instanceof ConflictError) {
          blocked.current = true
          setConflict(true)
        } else {
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    })
    return saving.current
  }, [id])

  // Leaving the tab (or the page) saves what is left.
  useEffect(
    () => () => {
      void flush()
    },
    [flush],
  )

  const onChange = (next: string) => {
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), INSTRUCTIONS_SAVE_MS)
  }

  return (
    <div className="flex flex-col gap-3" data-agent-tab="instructions">
      <p className="text-[14px] text-fg-muted">{INSTRUCTIONS_TEXT.intro}</p>
      {conflict && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[14px]">
          <span className="flex-1">{INSTRUCTIONS_TEXT.conflict}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            {INSTRUCTIONS_TEXT.reload}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {loaded ? (
        <div className="min-h-[240px] rounded-md border border-line px-3 py-2">
          <StringEditor
            key={loaded.n}
            value={loaded.text}
            onChange={onChange}
            onBlur={() => void flush()}
            readOnly={agent.readOnlyReason !== null}
            placeholder={INSTRUCTIONS_TEXT.placeholder}
            ariaLabel={INSTRUCTIONS_TEXT.editor}
          />
        </div>
      ) : (
        !error && <p className="text-[14px] text-fg-muted">{INSTRUCTIONS_TEXT.loading}</p>
      )}
    </div>
  )
}
