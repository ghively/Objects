// "Automations" (M14, our section): the space's automation rules, each with a switch, its last run
// and its run log, plus "New automation" (the rule editor). Every string here is ours (contract
// "Settings > Automations" in docs/superpowers/plans/2026-11-05-m14-automations.md).
//
// One row per rule, in the list route's order: the switch (`PUT` of the whole rule with `enabled`
// flipped; a 409 reloads it and tries once more), the name, a one-line summary of the trigger, the
// last run, and a menu with "Edit", "Run log" and "Delete" (to the trash, no confirm). A rule that
// can't be read shows why and no switch. A template's repeat says which template it repeats, and
// "Edit" opens its Repeat dialog. The list follows `automations` and `automationRuns` events.
//
// M21: an agent schedule's summary names the agent it runs (`Runs “{name}” · …`, or "Runs an agent
// that isn't listed · …"), and "Edit" opens the agent page's schedule dialog instead of the rule
// editor. For an agent that isn't listed, the dialog opens with "Save" disabled and the agent
// check's message shown.
import { useEffect, useMemo, useState } from 'react'
import { api, ConflictError } from '@/api/client'
import type { Agent, AutomationRule, AutomationRun, ObjectSummary } from '@/api/types'
import { ScheduleDialog } from '@/agents/ScheduleDialog'
import { useAgents } from '@/agents/useAgents'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { RuleEditorDialog } from '@/automations/RuleEditor'
import { TemplateRepeatDialog, templateDisplayName } from '@/automations/TemplateRepeatDialog'
import { isAgentSchedule, lastRunText, RULE_TEXT, triggerSummary } from '@/automations/ruleModel'
import { reloadAutomations, useAutomations } from '@/automations/useAutomations'
import { openObject } from '@/create/createAndOpen'
import { byPathOf, stemOf, useLinkIndex } from '@/links/linkIndex'
import { cn } from '@/lib/utils'
import { formatDate } from '@/properties/format'
import { useDefinitions } from '@/types/useDefinitions'
import { SectionHeader, SecondaryButton } from '../controls'
import { useSettings } from '../useSettings'
import { useSettingsModal } from '../useSettingsModal'

export const AUTOMATIONS_TEXT = {
  heading: 'Automations', // our string
  description: 'Rules that edit your objects for you, on this computer.', // our string
  create: 'New automation', // our string
  empty: 'No automations yet', // our string
  log: 'Run log', // our string
  edit: 'Edit', // our string
  remove: 'Delete', // our string
  menu: 'Automation menu', // our string
  enabled: 'Turned on', // our string
  back: 'Automations', // our string
  noRuns: 'No runs yet', // our string
  catchUp: 'missed run', // our string
  status: { ok: 'Done', failed: 'Failed', skipped: 'Skipped' }, // our strings
  agentNotListed: "That agent isn't listed any more.", // M21: the agent check's message (agents.NOT_LISTED)
} as const

const T = AUTOMATIONS_TEXT

export const AUTOMATIONS_SEARCH: string[] = [T.create, T.log, 'Repeat']

/** The time the section reads "5 minutes ago" against; ticks once a minute. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** The names of the templates that template repeats point at, by template id. */
function useTemplateNames(rules: readonly AutomationRule[]): Map<string, ObjectSummary> {
  // Refetched when the set of repeated templates changes, not on every run.
  const key = useMemo(
    () => [...new Set(rules.flatMap((r) => (r.templateRepeat ? [`${r.templateRepeat.typeId}\t${r.templateRepeat.templateId}`] : [])))].sort().join('\n'),
    [rules],
  )
  const typeIds = useMemo(() => [...new Set(key ? key.split('\n').map((l) => l.split('\t')[0]) : [])].join('\n'), [key])
  const [found, setFound] = useState<Map<string, ObjectSummary>>(new Map())
  useEffect(() => {
    if (!typeIds) return setFound(new Map())
    let alive = true
    void Promise.all(typeIds.split('\n').map((id) => api.templates(id).catch(() => [] as ObjectSummary[]))).then((lists) => {
      if (!alive) return
      const map = new Map<string, ObjectSummary>()
      for (const t of lists.flat()) if (t?.id) map.set(t.id, t)
      setFound(map)
    })
    return () => {
      alive = false
    }
  }, [typeIds, key])
  return found
}

/** M21: the agent id an agent schedule runs, else null. */
function scheduleAgentId(rule: AutomationRule): string | null {
  const a = rule.actions[0]
  return isAgentSchedule(rule) && a?.kind === 'runAgent' ? a.agentId : null
}

/** M21: a stand-in for an agent that isn't listed, so the schedule dialog opens with "Save" disabled. */
function unlistedAgent(id: string): Agent {
  return {
    id,
    kind: 'local',
    name: '',
    icon: null,
    color: null,
    description: '',
    model: null,
    toolsOff: [],
    learning: null,
    createdAt: null,
    updatedAt: null,
    default: false,
    folder: '',
    inStateDir: false,
    exists: false,
    missing: true,
    readOnlyReason: T.agentNotListed,
    revision: null,
    mcpServers: [],
    remote: null,
  }
}

/** Flip a rule's switch: `PUT` the whole rule; on 409 reload it and try once more. */
export async function setRuleEnabled(rule: AutomationRule, enabled: boolean): Promise<void> {
  try {
    await api.saveAutomation({ ...rule, enabled }, { baseRevision: rule.revision })
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e
    const fresh = await api.automation(rule.id)
    await api.saveAutomation({ ...fresh, enabled }, { baseRevision: fresh.revision })
  }
}

export function AutomationsSection() {
  const { rules, loaded } = useAutomations()
  const [editing, setEditing] = useState<AutomationRule | 'new' | null>(null)
  const [repeating, setRepeating] = useState<{ rule: AutomationRule; template: ObjectSummary } | null>(null)
  const [scheduling, setScheduling] = useState<{ rule: AutomationRule; agent: Agent } | null>(null)
  const [logFor, setLogFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const templates = useTemplateNames(rules)
  const agents = useAgents((s) => s.agents)
  const agentsLoaded = useAgents((s) => s.loaded)
  const hasSchedules = rules.some(isAgentSchedule)

  useEffect(() => {
    if (hasSchedules && !useAgents.getState().loaded) void useAgents.getState().load()
  }, [hasSchedules])

  const logRule = logFor ? rules.find((r) => r.id === logFor) : undefined
  if (logFor) return <RunLog ruleId={logFor} name={logRule?.name ?? ''} onBack={() => setLogFor(null)} />

  const run = (p: Promise<unknown>) =>
    void p
      .then(() => reloadAutomations())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))

  return (
    <div>
      <SectionHeader icon="ph-lightning" heading={T.heading} description={T.description} />
      <div className="flex flex-col gap-3 py-4">
        <SecondaryButton onClick={() => setEditing('new')}>
          <Icon name="ph-plus" size={14} />
          {T.create}
        </SecondaryButton>
        {error && (
          <p role="alert" className="text-[13px] text-[var(--danger)]">
            {error}
          </p>
        )}
        {loaded && rules.length === 0 && <p className="text-[14px] text-fg-muted italic">{T.empty}</p>}
        {rules.length > 0 && (
          <ul aria-label={T.heading} className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {rules.map((r) => {
              const template = r.templateRepeat ? templates.get(r.templateRepeat.templateId) : undefined
              const agentId = scheduleAgentId(r)
              const runs = agentId ? agents.find((a) => a.id === agentId) : undefined
              return (
                <RuleRow
                  key={r.id}
                  rule={r}
                  templateName={template ? templateDisplayName(template) : undefined}
                  agentLine={agentId ? (runs ? RULE_TEXT.runsAgent(runs.name) : agentsLoaded ? RULE_TEXT.runsMissingAgent : null) : null}
                  onToggle={(on) => {
                    setError(null)
                    run(setRuleEnabled(r, on))
                  }}
                  onEdit={() =>
                    agentId
                      ? setScheduling({ rule: r, agent: runs ?? unlistedAgent(agentId) })
                      : r.templateRepeat && template
                        ? setRepeating({ rule: r, template })
                        : setEditing(r)
                  }
                  onLog={() => setLogFor(r.id)}
                  onDelete={() => {
                    setError(null)
                    run(api.deleteAutomation(r.id))
                  }}
                />
              )
            })}
          </ul>
        )}
      </div>
      {editing && (
        <RuleEditorDialog
          open
          rule={editing === 'new' ? null : editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={() => void reloadAutomations()}
        />
      )}
      {scheduling && (
        <ScheduleDialog open agent={scheduling.agent} rule={scheduling.rule} onOpenChange={(o) => !o && setScheduling(null)} />
      )}
      {repeating && (
        <TemplateRepeatDialog
          open
          typeId={repeating.rule.templateRepeat!.typeId}
          template={repeating.template}
          onOpenChange={(o) => !o && setRepeating(null)}
        />
      )}
    </div>
  )
}

function RuleRow({
  rule,
  templateName,
  agentLine,
  onToggle,
  onEdit,
  onLog,
  onDelete,
}: {
  rule: AutomationRule
  templateName?: string
  /** M21: an agent schedule's "Runs “{name}”" (null: not an agent schedule, or the agents aren't loaded yet). */
  agentLine?: string | null
  onToggle(on: boolean): void
  onEdit(): void
  onLog(): void
  onDelete(): void
}) {
  const types = useLinkIndex((s) => s.types)
  const { collections } = useDefinitions()
  const twentyFourHour = useSettings((s) => s.settings.twentyFourHourTime)
  const now = useNow()
  const [menuOpen, setMenuOpen] = useState(false)
  const readOnly = !!rule.readOnlyReason
  const summary = readOnly
    ? rule.readOnlyReason
    : [
        rule.templateRepeat ? RULE_TEXT.repeatsTemplate(templateName ?? rule.name) : null,
        agentLine ?? null,
        triggerSummary(rule.trigger, { types, collections, twentyFourHour }),
      ]
        .filter(Boolean)
        .join(' · ')
  const last = lastRunText(rule.lastRun, now)
  const items = [
    ...(readOnly ? [] : [{ label: T.edit, run: onEdit }]),
    { label: T.log, run: onLog },
    ...(readOnly ? [] : [{ label: T.remove, run: onDelete }]),
  ]
  return (
    <li aria-label={rule.name} data-rule={rule.id} className="flex items-center gap-3 px-3 py-2.5">
      {readOnly ? (
        <Icon name="ph-warning" size={16} />
      ) : (
        <Switch aria-label={`${T.enabled}: ${rule.name}`} checked={rule.enabled} onCheckedChange={(v) => onToggle(v === true)} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-[14px] font-medium', !rule.enabled && 'text-fg-muted')}>{rule.name}</span>
        <span data-testid="rule-summary" className="truncate text-[13px] text-fg-muted">
          {summary}
        </span>
        {!readOnly && (
          <span
            data-testid="rule-last-run"
            className={cn('truncate text-[12px]', rule.lastRun?.status === 'failed' ? 'text-[var(--danger)]' : 'text-fg-muted')}
          >
            {last}
          </span>
        )}
      </div>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={T.menu}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Icon name="ph-dots-three-bold" size={15} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" role="menu" aria-label={T.menu} className="w-40 border-line bg-raised p-1">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                it.run()
              }}
              className="flex w-full items-center rounded px-2 py-1 text-left text-[14px] hover:bg-hover"
            >
              {it.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </li>
  )
}

// ---- Run log ----

function ObjectLink({ path }: { path: string }) {
  const summary = useLinkIndex((s) => byPathOf(s.objects).get(path))
  const title = summary?.title?.trim() || stemOf(path)
  return (
    <button
      type="button"
      onClick={() => {
        useSettingsModal.getState().close()
        openObject(path, { via: 'link' }, summary?.type)
      }}
      className="max-w-full truncate text-left text-fg underline decoration-line underline-offset-2 hover:decoration-fg"
    >
      {title}
    </button>
  )
}

const STATUS_ICON: Record<AutomationRun['status'], string> = {
  ok: 'ph-check-circle',
  failed: 'ph-x-circle',
  skipped: 'ph-minus-circle',
}

/** A rule's run log, newest first; it refreshes on that rule's `automationRuns` events. */
export function RunLog({ ruleId, name, onBack }: { ruleId: string; name: string; onBack(): void }) {
  const [runs, setRuns] = useState<AutomationRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .automationRuns(ruleId)
        .then((r) => {
          if (!alive) return
          setRuns(r)
          setError(null)
        })
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    void load()
    const off = api.onChange((e) => {
      if (e.kind === 'automationRuns' && e.path === ruleId) void load()
    })
    return () => {
      alive = false
      off()
    }
  }, [ruleId])

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Icon name="ph-caret-left" size={13} />
        {T.back}
      </button>
      <SectionHeader icon="ph-list-checks" heading={T.log} description={name} />
      <div className="py-4">
        {error && (
          <p role="alert" className="text-[13px] text-[var(--danger)]">
            {error}
          </p>
        )}
        {runs && runs.length === 0 && <p className="text-[14px] text-fg-muted italic">{T.noRuns}</p>}
        {runs && runs.length > 0 && (
          <ol aria-label={T.log} className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {runs.map((run) => (
              <RunEntry key={run.id} run={run} />
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

function RunEntry({ run }: { run: AutomationRun }) {
  const at = formatDate({ start: run.at, resolution: 'time' })
  const scheduled = run.trigger.scheduledFor ? formatDate({ start: run.trigger.scheduledFor, resolution: 'time' }) : null
  return (
    <li aria-label={at} data-run={run.id} className="flex flex-col gap-1 px-3 py-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name={STATUS_ICON[run.status]} size={14} className={run.status === 'failed' ? 'text-[var(--danger)]' : 'text-fg-muted'} />
        <span className="font-medium">{T.status[run.status]}</span>
        <span className="text-fg-muted">{at}</span>
        <span className="text-fg-muted">·</span>
        <span className="text-fg-muted">{RULE_TEXT.triggers[run.trigger.kind]}</span>
        {run.trigger.path && <ObjectLink path={run.trigger.path} />}
        {scheduled && run.trigger.catchUp && <span className="text-fg-muted">({`${T.catchUp}: ${scheduled}`})</span>}
      </div>
      {run.error && <p className="text-[var(--danger)]">{run.error}</p>}
      {run.actions.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-6">
          {run.actions.map((a) => (
            <li key={a.index} className="flex flex-wrap items-center gap-1.5">
              <Icon name={STATUS_ICON[a.status]} size={12} className={a.status === 'failed' ? 'text-[var(--danger)]' : 'text-fg-muted'} />
              <span>{RULE_TEXT.actions[a.kind]}</span>
              {a.path && <ObjectLink path={a.path} />}
              {a.detail && <span className={a.status === 'failed' ? 'text-[var(--danger)]' : 'text-fg-muted'}>{a.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
