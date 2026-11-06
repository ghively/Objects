/**
 * M18: the agent page's Skills tab (spec section 2: "list with state active/stale/archived,
 * pinned, use count, last used"; spec section 5: "editable, with a history of changes and Undo per
 * change"; "Tidy up now"). The list's columns are Name, Description, State, Pinned, Uses, Last used
 * and Made by; "Show archived" adds the archived skills, "Filter skills" narrows by name or
 * description. Opening a skill shows `SkillDetail`. "New skill" writes one by hand. "Tidy up now"
 * runs the curator's consolidation pass once; while it runs the button says "Tidying up…", and
 * the last report shows under the list. The tab reloads on `agentLearning` events for the agent.
 * A focus from a chat's "Learning" line opens the skill of the first highlighted entry. Opening
 * the tab writes nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ConflictError, RESYNC_PATH } from '@/api/client'
import type { Agent, CuratorState, SkillSummary } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { NewSkillDialog } from './NewSkillDialog'
import { SkillDetail } from './SkillDetail'
import { useFocusedEntries } from './learningFocus'
import { LEARNING_TEXT as T, learningDate } from './learningText'

/** The route's 409 text (the client's `ConflictError` doesn't carry it). */
export const TIDY_BUSY = 'Tidying up is already running.'

function message(e: unknown): string {
  if (e instanceof ConflictError) return TIDY_BUSY
  return e instanceof Error ? e.message : String(e)
}

interface Open {
  name: string
  archived: boolean
}

export function SkillsTab({ agent }: { agent: Agent }) {
  const id = agent.id
  const readOnly = agent.readOnlyReason !== null
  const [skills, setSkills] = useState<SkillSummary[] | null>(null)
  const [archivedSkills, setArchivedSkills] = useState<SkillSummary[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [filter, setFilter] = useState('')
  const [curator, setCurator] = useState<CuratorState | null>(null)
  const [tidying, setTidying] = useState(false)
  const [tidyError, setTidyError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Open | null>(null)
  const [creating, setCreating] = useState(false)
  const highlight = useFocusedEntries(id)
  /** "Tidy up now" was pressed; cleared once an event shows the run is over. */
  const started = useRef(false)

  const load = useCallback(
    async (fromEvent = false) => {
      try {
        const [active, archived, learning] = await Promise.all([
          api.agentSkills(id),
          showArchived ? api.agentSkills(id, true) : Promise.resolve<SkillSummary[]>([]),
          api.agentLearning(id),
        ])
        setSkills(active)
        setArchivedSkills(archived)
        setCurator(learning.curator)
        if (fromEvent && started.current && !learning.curator.running) {
          started.current = false
          setTidying(false)
        }
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [id, showArchived],
  )

  useEffect(() => {
    let live = true
    void load()
    const off = api.onChange((e) => {
      if (live && e.kind === 'agentLearning' && (e.path === id || e.path === RESYNC_PATH)) void load(true)
    })
    return () => {
      live = false
      off()
    }
  }, [load, id])

  // A focus from a chat's "Learning" line: open the skill its first entry changed.
  const focusKey = highlight.join(',')
  useEffect(() => {
    if (!focusKey) return
    let live = true
    void (async () => {
      try {
        const entry = await api.agentLedgerEntry(id, focusKey.split(',')[0])
        if (!live || entry.target !== 'skill' || !entry.skill) return
        const active = await api.agentSkills(id)
        if (!live) return
        setOpen({ name: entry.skill, archived: !active.some((s) => s.name === entry.skill) })
      } catch {
        // The entry or the skill is gone: the list stays.
      }
    })()
    return () => {
      live = false
    }
  }, [focusKey, id])

  const tidy = async () => {
    setTidyError(null)
    setTidying(true)
    started.current = true
    try {
      await api.tidyAgentSkills(id)
    } catch (e) {
      started.current = false
      setTidying(false)
      setTidyError(message(e))
    }
  }

  const rows = useMemo(() => {
    const all = [...(skills ?? []), ...(showArchived ? archivedSkills : [])]
    const q = filter.trim().toLowerCase()
    return q ? all.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) : all
  }, [skills, archivedSkills, showArchived, filter])

  if (open) {
    return (
      <div data-agent-tab="skills">
        <SkillDetail
          key={`${open.name}:${open.archived}`}
          agentId={id}
          name={open.name}
          archived={open.archived}
          onClose={() => {
            setOpen(null)
            void load()
          }}
        />
      </div>
    )
  }

  const running = tidying || curator?.running === true
  const report = curator?.report ?? null

  return (
    <div className="flex flex-col gap-4" data-agent-tab="skills">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filter}
          placeholder={T.filterSkills}
          aria-label={T.filterSkills}
          onChange={(e) => setFilter(e.target.value)}
          className="h-9 min-w-[180px] flex-1 rounded-md border border-line bg-transparent px-2 text-[14px] outline-none focus:border-fg-muted"
        />
        <label className="flex items-center gap-2 text-[14px]">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label={T.showArchived} />
          {T.showArchived}
        </label>
        <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={() => setCreating(true)}>
          {T.newSkill}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={readOnly || running} onClick={() => void tidy()}>
          {running && <Icon name="ph-spinner-gap" size={14} className="animate-spin" />}
          {running ? T.tidying : T.tidyUp}
        </Button>
      </div>
      {tidyError && (
        <p role="alert" className="text-[13px] text-danger">
          {tidyError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      {skills === null ? (
        !error && <p className="text-[14px] text-fg-muted">{T.loading}</p>
      ) : (
        <table className="w-full border-collapse text-left text-[14px]" aria-label={T.skillsTab}>
          <thead className="text-[13px] text-fg-muted">
            <tr className="border-b border-line">
              <th className="py-1.5 pr-3 font-medium">{T.skillName}</th>
              <th className="py-1.5 pr-3 font-medium">{T.skillDescription}</th>
              <th className="py-1.5 pr-3 font-medium">{T.skillState}</th>
              <th className="py-1.5 pr-3 font-medium">{T.skillPinned}</th>
              <th className="py-1.5 pr-3 font-medium">{T.skillUses}</th>
              <th className="py-1.5 pr-3 font-medium">{T.skillLastUsed}</th>
              <th className="py-1.5 font-medium">{T.skillMadeBy}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={`${s.state === 'archived' ? 'a' : 's'}:${s.name}`} data-skill={s.name} className="border-b border-line/60">
                <td className="py-1.5 pr-3">
                  <button
                    type="button"
                    className="font-mono text-[13px] hover:underline"
                    onClick={() => setOpen({ name: s.name, archived: s.state === 'archived' })}
                  >
                    {s.name}
                  </button>
                </td>
                <td className="py-1.5 pr-3 text-fg-muted">{s.description}</td>
                <td className={cn('py-1.5 pr-3', s.state !== 'active' && 'text-fg-muted')}>{T.states[s.state]}</td>
                <td className="py-1.5 pr-3">
                  {s.pinned && (
                    <span role="img" aria-label={T.skillPinned} title={T.skillPinned}>
                      <Icon name="ph-push-pin" size={14} />
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">{s.uses}</td>
                <td className="py-1.5 pr-3">{s.lastUsed ? learningDate(s.lastUsed) : T.never}</td>
                <td className="py-1.5">{T.madeBy[s.createdBy]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {report && (
        <section className="flex flex-col gap-1" data-tidy-report="">
          <h3 className="text-[15px] font-semibold">{T.lastTidy(learningDate(report.at))}</h3>
          <p className="whitespace-pre-wrap text-[14px]">{report.text}</p>
        </section>
      )}

      <NewSkillDialog
        agentId={id}
        open={creating}
        onOpenChange={(o) => {
          setCreating(o)
          if (!o) void load()
        }}
      />
    </div>
  )
}
