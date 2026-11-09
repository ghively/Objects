/**
 * M18: one skill on the agent page's Skills tab (spec section 5: "editable, with a history of
 * changes and Undo per change"). Its SKILL.md opens in Object's editor and autosaves 1,000 ms
 * after the last change and on blur (as the Memory tab), with the revision it loaded; a 409 keeps
 * the text and shows "Changed elsewhere. Reload?". Its support files open in the same editor; a
 * file that isn't UTF-8 shows "This file isn't text." and no editor. Archive / Restore and Pin /
 * Unpin call their routes; an archived skill shows what it was absorbed into and isn't edited.
 * Below, its History (`LedgerList` with `skill`) with Undo. It reloads on `agentLearning` events
 * for the agent, unless the editor has unsaved text. Opening it writes nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ConflictError, RESYNC_PATH } from '@/api/client'
import type { SkillDetail as SkillDetailData } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { StringEditor } from '@/editor/StringEditor'
import { cn } from '@/lib/utils'
import { LedgerList } from './LedgerList'
import { useFocusedEntries } from './learningFocus'
import { LEARNING_TEXT as T } from './learningText'
import { MEMORY_SAVE_MS } from './MemoryTab'
import { useAgents } from './useAgents'

/** Milliseconds after the last change before a skill file is saved (as the Memory tab). */
export const SKILL_SAVE_MS = MEMORY_SAVE_MS

const SKILL_MD = 'SKILL.md'

/** A file's leading YAML frontmatter (`---` lines, BOM and line endings kept) and the rest. */
export function splitFrontmatter(text: string): [string, string] {
  const m = /^(\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))/.exec(text)
  return m ? [m[1], text.slice(m[1].length)] : ['', text]
}

/** Our strings for this view, beside `LEARNING_TEXT`'s. */
export const SKILL_DETAIL_TEXT = {
  close: 'Close',
  files: 'Files',
  restoreConflict: 'A skill with this name is active.', // the route's 409 text
} as const

export interface SkillDetailProps {
  agentId: string
  name: string
  archived: boolean
  onClose(): void
}

interface Shown {
  path: string
  text: string | null
  revision: string | null
  binary: boolean
  /** Bumped when the text is replaced, so the editor remounts with it. */
  n: number
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** The parent keys it by name and `archived`, so `archived` is read once; Archive and Restore flip it here. */
export function SkillDetail({ agentId, name, archived: archivedProp, onClose }: SkillDetailProps) {
  const [archived, setArchived] = useState(archivedProp)
  const [detail, setDetail] = useState<SkillDetailData | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const [path, setPath] = useState(SKILL_MD)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const highlight = useFocusedEntries(agentId)
  const agentReadOnly = useAgents((s) => s.agents.find((a) => a.id === agentId)?.readOnlyReason ?? null) !== null

  const revision = useRef<string | null>(null)
  const pending = useRef<string | null>(null)
  const inflight = useRef(0)
  const blocked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())

  const unsavedRef = useRef(() => pending.current !== null || inflight.current > 0 || blocked.current)

  /** Load the skill and the shown file; `force` replaces unsaved text (Reload). */
  const load = useCallback(
    async (force = false) => {
      try {
        const d = await api.agentSkill(agentId, name, archived)
        setDetail(d)
        setError(null)
        let next: Omit<Shown, 'n'>
        if (path === SKILL_MD) {
          next = { path, text: d.text, revision: d.revision, binary: false }
        } else {
          const f = await api.agentSkillFile(agentId, name, path, archived)
          next = { path, text: f.binary ? null : f.text, revision: f.revision, binary: f.binary }
        }
        setShown((prev) => {
          if (prev && prev.path === next.path && !force && unsavedRef.current()) return prev
          if (prev && prev.path === next.path && prev.text === next.text) {
            revision.current = next.revision
            return { ...next, n: prev.n }
          }
          revision.current = next.revision
          pending.current = null
          blocked.current = false
          setConflict(false)
          return { ...next, n: (prev?.n ?? 0) + 1 }
        })
      } catch (e) {
        setError(message(e))
      }
    },
    [agentId, name, archived, path],
  )
  useEffect(() => {
    let live = true
    void load()
    const off = api.onChange((e) => {
      if (live && e.kind === 'agentLearning' && (e.path === agentId || e.path === RESYNC_PATH)) void load()
    })
    return () => {
      live = false
      off()
    }
  }, [load, agentId])

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (pending.current === null || blocked.current || !shown) return saving.current
    const next = pending.current
    const file = shown.path
    pending.current = null
    inflight.current += 1
    saving.current = saving.current.then(async () => {
      try {
        const res = await api.saveAgentSkillFile(agentId, name, file, next, revision.current)
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
  }, [agentId, name, shown])

  // Leaving the skill (or the file) saves what is left.
  useEffect(
    () => () => {
      void flush()
    },
    [flush],
  )

  const onChange = (value: string) => {
    pending.current = value
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SKILL_SAVE_MS)
  }

  const openFile = async (next: string) => {
    if (next === path) return
    await flush()
    setPath(next)
  }

  const act = async (run: () => Promise<unknown>, after?: () => void) => {
    setBusy(true)
    setActionError(null)
    try {
      await run()
      after?.()
    } catch (e) {
      setActionError(e instanceof ConflictError ? SKILL_DETAIL_TEXT.restoreConflict : message(e))
    } finally {
      setBusy(false)
    }
  }

  const archive = () =>
    act(
      async () => {
        await flush()
        await api.archiveAgentSkill(agentId, name)
      },
      () => {
        setPath(SKILL_MD)
        setArchived(true)
      },
    )
  const restore = () =>
    act(
      () => api.restoreAgentSkill(agentId, name),
      () => {
        setPath(SKILL_MD)
        setArchived(false)
      },
    )
  const pin = (pinned: boolean) =>
    act(async () => {
      const summary = await api.pinAgentSkill(agentId, name, pinned)
      setDetail((d) => (d ? { ...d, pinned: summary?.pinned ?? pinned } : d))
    })

  const readOnly = agentReadOnly || archived
  const files = detail?.files ?? [{ path: SKILL_MD, size: 0 }]
  // The Markdown editor would read YAML frontmatter as text (and save it back as a heading), so it
  // shows only the body; the frontmatter is shown as written and saved back byte for byte.
  const [head, body] = shown?.text ? splitFrontmatter(shown.text) : ['', shown?.text ?? '']
  const onBodyChange = (value: string) => onChange(head + value)

  return (
    <div className="flex flex-col gap-4" data-skill={name} data-archived={archived ? '' : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{name}</h3>
        {!archived && detail && (
          <Button type="button" variant="outline" size="sm" disabled={agentReadOnly || busy} onClick={() => void pin(!detail.pinned)}>
            <Icon name={detail.pinned ? 'ph-push-pin-slash' : 'ph-push-pin'} size={14} />
            {detail.pinned ? T.unpin : T.pin}
          </Button>
        )}
        {archived ? (
          <Button type="button" variant="outline" size="sm" disabled={agentReadOnly || busy} onClick={() => void restore()}>
            {T.restore}
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={agentReadOnly || busy} onClick={() => void archive()}>
            {T.archive}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {SKILL_DETAIL_TEXT.close}
        </Button>
      </div>
      {detail && <p className="text-[14px] text-fg-muted">{detail.description}</p>}
      {archived && detail?.absorbedInto && <p className="text-[14px]">{T.absorbedInto(detail.absorbedInto)}</p>}
      {actionError && (
        <p role="alert" className="text-[13px] text-danger">
          {actionError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      {files.length > 1 && (
        <div role="group" aria-label={SKILL_DETAIL_TEXT.files} className="flex flex-wrap gap-1">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              aria-pressed={f.path === path}
              onClick={() => void openFile(f.path)}
              className={cn(
                'h-8 rounded-md px-2 font-mono text-[13px]',
                f.path === path ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {f.path}
            </button>
          ))}
        </div>
      )}

      {conflict && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[14px]">
          <span className="flex-1">{T.conflict}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load(true)}>
            {T.reload}
          </Button>
        </div>
      )}

      {!shown ? (
        !error && <p className="text-[14px] text-fg-muted">{T.loading}</p>
      ) : shown.binary || shown.text === null ? (
        <p className="text-[14px] text-fg-muted" data-binary="">
          {T.notText}
        </p>
      ) : (
        <div className="min-h-[200px] rounded-md border border-line px-3 py-2" data-file={shown.path}>
          {head && (
            <pre data-frontmatter="" className="mb-2 whitespace-pre-wrap font-mono text-[12px] text-fg-muted">
              {head.replace(/\r\n/g, '\n').trimEnd()}
            </pre>
          )}
          <StringEditor
            key={`${shown.path}:${shown.n}`}
            value={body}
            onChange={onBodyChange}
            onBlur={() => void flush()}
            readOnly={readOnly}
            ariaLabel={shown.path}
          />
        </div>
      )}

      <LedgerList agentId={agentId} query={{ skill: name }} highlight={highlight} readOnly={agentReadOnly} />
    </div>
  )
}
