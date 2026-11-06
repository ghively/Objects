import { useState } from 'react'
import { api } from '@/api/client'
import type { DeskSyncStatus, ScheduleTrigger } from '@/api/types'
import { SecondaryButton, SettingGroup, SwitchRow, errorText } from '@/settings/controls'
import { WORK_AGENT_TEXT as T } from './workAgentText'

/** Desk sync: set up once, then a switch and the time of its schedule rule (M14). */
export function DeskSyncRow({
  status,
  onChange,
  onProblem,
}: {
  status: DeskSyncStatus
  onChange(s: DeskSyncStatus): void
  onProblem(text: string): void
}) {
  const [busy, setBusy] = useState(false)
  const [time, setTime] = useState<string | null>(null)

  const setUp = async () => {
    setBusy(true)
    try {
      onChange(await api.setUpDeskSync())
    } catch (e) {
      onProblem(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  /** Save the rule over its file with `change` applied, then reload the status. */
  const edit = async (change: (r: Awaited<ReturnType<typeof api.automation>>) => void) => {
    if (!status.ruleId) return
    try {
      const rule = await api.automation(status.ruleId)
      change(rule)
      await api.saveAutomation(rule, { baseRevision: rule.revision })
      onChange(await api.deskSync())
    } catch (e) {
      onProblem(errorText(e))
      try {
        onChange(await api.deskSync())
      } catch {
        /* keep what is shown */
      }
    }
  }

  if (!status.ruleId) {
    return (
      <SettingGroup title={T.deskSync} help={T.deskSyncHelp}>
        <div>
          <SecondaryButton onClick={() => void setUp()} disabled={busy}>{T.setUpDeskSync}</SecondaryButton>
        </div>
      </SettingGroup>
    )
  }

  const shown = time ?? status.time ?? '07:00'
  const commitTime = () => {
    const next = time
    setTime(null)
    if (!next || next === status.time) return
    void edit((r) => {
      r.trigger = { ...(r.trigger as ScheduleTrigger), time: next }
    })
  }

  return (
    <SwitchRow
      title={T.deskSync}
      help={T.deskSyncHelp}
      checked={status.enabled}
      onChange={(on) => void edit((r) => { r.enabled = on })}
    >
      <div className="flex flex-col gap-1 text-[13px] text-fg-muted">
        <label className="flex items-center gap-2">
          {T.deskSyncTime}
          <input
            type="time"
            aria-label={T.deskSyncTime}
            value={shown}
            onChange={(e) => setTime(e.target.value)}
            onBlur={commitTime}
            className="h-8 rounded-md border border-line bg-raised px-2 text-[14px] text-fg"
          />
        </label>
        <span>
          {T.lastRun}: {status.lastRun ? `${status.lastRun.at} ${status.lastRun.status}` : T.neverRun}
        </span>
        {status.markedReadTools === 0 && <span>{T.noReadTools}</span>}
      </div>
    </SwitchRow>
  )
}
