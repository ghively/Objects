// M21: the agent page's Schedules tab (spec section 9): the open space's schedules of this agent,
// each with its switch, name, trigger summary and last run, and a menu with "Edit", "Run log" and
// "Delete" (to the trash, no confirm, as M14 does). "New schedule" and "Edit" open the schedule
// dialog; "Run log" shows M14's run log inside the tab. A schedule that can't be read shows why and
// no switch. A read-only or missing agent disables "New schedule" and the switches. The list
// follows `automations` and `automationRuns` events through M14's store. Every string is ours.
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { Agent, AutomationRule } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { lastRunText, schedulesOf, triggerSummary } from '@/automations/ruleModel'
import { reloadAutomations, useAutomations } from '@/automations/useAutomations'
import { cn } from '@/lib/utils'
import { RunLog, setRuleEnabled } from '@/settings/sections/Automations'
import { useSettings } from '@/settings/useSettings'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { ScheduleDialog } from './ScheduleDialog'
import { SCHEDULE_TEXT as T } from './scheduleModel'

/** The time "5 minutes ago" is read against; ticks once a minute. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function SchedulesTab({ agent }: { agent: Agent }) {
  const { rules, loaded } = useAutomations()
  const space = useSpaceInfo((s) => s.space)
  const [editing, setEditing] = useState<AutomationRule | 'new' | null>(null)
  const [logFor, setLogFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const locked = !!agent.readOnlyReason || agent.missing

  useEffect(() => {
    void useSpaceInfo.getState().ensure()
  }, [])

  const schedules = schedulesOf(rules, agent.id)

  if (logFor) {
    const name = schedules.find((r) => r.id === logFor)?.name ?? ''
    return <RunLog ruleId={logFor} name={name} onBack={() => setLogFor(null)} />
  }

  const run = (p: Promise<unknown>) => {
    setError(null)
    void p
      .then(() => reloadAutomations())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] text-fg-muted">{T.heading(space?.name ?? '')}</p>
      <div>
        <button
          type="button"
          disabled={locked}
          onClick={() => setEditing('new')}
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[14px] hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <Icon name="ph-plus" size={14} />
          {T.create}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-[var(--danger)]">
          {error}
        </p>
      )}
      {loaded && schedules.length === 0 && <p className="text-[14px] text-fg-muted italic">{T.empty}</p>}
      {schedules.length > 0 && (
        <ul aria-label={T.list} className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {schedules.map((r) => (
            <ScheduleRow
              key={r.id}
              rule={r}
              locked={locked}
              onToggle={(on) => run(setRuleEnabled(r, on))}
              onEdit={() => setEditing(r)}
              onLog={() => setLogFor(r.id)}
              onDelete={() => run(api.deleteAutomation(r.id))}
            />
          ))}
        </ul>
      )}
      {editing && <ScheduleDialog open agent={agent} rule={editing === 'new' ? null : editing} onOpenChange={(o) => !o && setEditing(null)} />}
    </div>
  )
}

function ScheduleRow({
  rule,
  locked,
  onToggle,
  onEdit,
  onLog,
  onDelete,
}: {
  rule: AutomationRule
  locked: boolean
  onToggle(on: boolean): void
  onEdit(): void
  onLog(): void
  onDelete(): void
}) {
  const twentyFourHour = useSettings((s) => s.settings.twentyFourHourTime)
  const now = useNow()
  const [menuOpen, setMenuOpen] = useState(false)
  const readOnly = !!rule.readOnlyReason
  const summary = readOnly ? rule.readOnlyReason : triggerSummary(rule.trigger, { types: [], collections: [], twentyFourHour })
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
        <Switch
          aria-label={`${T.enabled}: ${rule.name}`}
          checked={rule.enabled}
          disabled={locked}
          onCheckedChange={(v) => onToggle(v === true)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-[14px] font-medium', !rule.enabled && 'text-fg-muted')}>{rule.name}</span>
        <span data-testid="schedule-summary" className="truncate text-[13px] text-fg-muted">
          {summary}
        </span>
        {!readOnly && (
          <span
            data-testid="schedule-last-run"
            className={cn('truncate text-[12px]', rule.lastRun?.status === 'failed' ? 'text-[var(--danger)]' : 'text-fg-muted')}
          >
            {lastRunText(rule.lastRun, now)}
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
