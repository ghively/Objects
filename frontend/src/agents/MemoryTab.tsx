/**
 * M18: the agent page's Memory tab (spec section 2: "both files, editable, with their size against
 * the cap"). Two sections, "Memory" (MEMORY.md) and "About you" (USER.md), each Object's editor
 * over the file's text. It autosaves 1,000 ms after the last change and on blur, with the revision
 * it loaded (as the Instructions tab); a 409 keeps the text and shows "Changed elsewhere. Reload?".
 * The size line counts characters against the cap and turns red past it. Below, the History of
 * both files with Undo. The tab reloads on `agentLearning` events for the agent, except for a
 * section with unsaved text. Opening it writes nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ConflictError, RESYNC_PATH } from '@/api/client'
import type { Agent, MemoryFile } from '@/api/types'
import { Button } from '@/components/ui/button'
import { StringEditor } from '@/editor/StringEditor'
import { cn } from '@/lib/utils'
import { INSTRUCTIONS_SAVE_MS } from './InstructionsTab'
import { LedgerList } from './LedgerList'
import { useFocusedEntries } from './learningFocus'
import { LEARNING_TEXT as T } from './learningText'

/** Milliseconds after the last change before a memory file is saved (as the Instructions tab). */
export const MEMORY_SAVE_MS = INSTRUCTIONS_SAVE_MS

type Target = MemoryFile['target']
const TARGETS: Target[] = ['memory', 'user']

/** Characters as the server counts them (code points). */
export function chars(text: string): number {
  return Array.from(text).length
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

interface Shown {
  file: MemoryFile
  /** Bumped when the text is replaced, so the editor remounts with it. */
  n: number
}

interface SectionProps {
  agentId: string
  shown: Shown
  readOnly: boolean
  /** Tell the tab whether this section has text not yet saved. */
  register(target: Target, unsaved: () => boolean): void
  onReload(target: Target): void
}

function MemorySection({ agentId, shown, readOnly, register, onReload }: SectionProps) {
  const { file, n } = shown
  const target = file.target
  const [text, setText] = useState(file.text)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revision = useRef<string | null>(file.revision)
  const pending = useRef<string | null>(null)
  const inflight = useRef(0)
  const blocked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    register(target, () => pending.current !== null || inflight.current > 0 || blocked.current)
  }, [register, target])

  // A new text from the server (a load or a reload): start again from it.
  useEffect(() => {
    setText(file.text)
    pending.current = null
    blocked.current = false
    setConflict(false)
    // `file.revision` is read here on purpose only when the text is replaced; see below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n])

  // The same text with a newer revision (our own save's event, or a reload): take the revision.
  useEffect(() => {
    revision.current = file.revision
  }, [file.revision, n])

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (pending.current === null || blocked.current) return saving.current
    const next = pending.current
    pending.current = null
    inflight.current += 1
    saving.current = saving.current.then(async () => {
      try {
        const res = await api.saveAgentMemory(agentId, target, next, revision.current)
        revision.current = res?.revision ?? revision.current
        setError(null)
      } catch (e) {
        // Keep what was typed: it is saved again after a reload, or by the next edit.
        if (pending.current === null) pending.current = next
        if (e instanceof ConflictError) {
          blocked.current = true
          setConflict(true)
        } else {
          setError(message(e))
        }
      } finally {
        inflight.current -= 1
      }
    })
    return saving.current
  }, [agentId, target])

  // Leaving the tab (or the page) saves what is left.
  useEffect(
    () => () => {
      void flush()
    },
    [flush],
  )

  const onChange = (value: string) => {
    pending.current = value
    setText(value)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), MEMORY_SAVE_MS)
  }

  const size = chars(text)
  const over = size > file.cap
  const title = target === 'memory' ? T.memory : T.user
  const intro = target === 'memory' ? T.memoryIntro : T.userIntro

  return (
    <section className="flex flex-col gap-2" data-memory={target} aria-label={title}>
      <div>
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <p className="text-[14px] text-fg-muted">{intro}</p>
      </div>
      {conflict && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[14px]">
          <span className="flex-1">{T.conflict}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => onReload(target)}>
            {T.reload}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="min-h-[120px] rounded-md border border-line px-3 py-2">
        <StringEditor
          key={n}
          value={file.text}
          onChange={onChange}
          onBlur={() => void flush()}
          readOnly={readOnly}
          placeholder={T.memoryPlaceholder}
          ariaLabel={title}
        />
      </div>
      <p data-size="" data-over={over ? '' : undefined} className={cn('text-[13px]', over ? 'text-danger' : 'text-fg-muted')}>
        {T.size(size, file.cap)}
        {over && <span className="block">{T.overCap}</span>}
      </p>
    </section>
  )
}

export function MemoryTab({ agent }: { agent: Agent }) {
  const [shown, setShown] = useState<Record<Target, Shown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const unsaved = useRef<Partial<Record<Target, () => boolean>>>({})
  const id = agent.id
  const highlight = useFocusedEntries(id)

  const register = useCallback((target: Target, fn: () => boolean) => {
    unsaved.current[target] = fn
  }, [])

  /** Load both files; `force` replaces that one's text even with unsaved changes (Reload). */
  const load = useCallback(
    async (force?: Target) => {
      try {
        const res = await api.agentMemory(id)
        setError(null)
        setShown((prev) => {
          const next = { ...(prev ?? {}) } as Record<Target, Shown>
          for (const t of TARGETS) {
            const file = res[t]
            const old = prev?.[t]
            if (!old) next[t] = { file, n: 1 }
            else if (t !== force && unsaved.current[t]?.()) next[t] = old
            else if (t !== force && old.file.text === file.text) next[t] = { file, n: old.n }
            else next[t] = { file, n: old.n + 1 }
          }
          return next
        })
      } catch (e) {
        setError(message(e))
      }
    },
    [id],
  )

  useEffect(() => {
    let live = true
    void load()
    const off = api.onChange((e) => {
      if (live && e.kind === 'agentLearning' && (e.path === id || e.path === RESYNC_PATH)) void load()
    })
    return () => {
      live = false
      off()
    }
  }, [load, id])

  const readOnly = agent.readOnlyReason !== null

  return (
    <div className="flex flex-col gap-6" data-agent-tab="memory">
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {shown ? (
        TARGETS.map((t) => (
          <MemorySection
            key={t}
            agentId={id}
            shown={shown[t]}
            readOnly={readOnly}
            register={register}
            onReload={(target) => void load(target)}
          />
        ))
      ) : (
        !error && <p className="text-[14px] text-fg-muted">{T.loading}</p>
      )}
      <LedgerList agentId={id} query={{ target: 'memory,user' }} highlight={highlight} readOnly={readOnly} />
    </div>
  )
}
