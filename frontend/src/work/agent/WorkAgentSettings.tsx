// M24 Task 9: Settings > Work's "Work agent" group: the picker, the two switches, the read tools
// and Desk sync. Toasts are for problems only (success just happens).
import { useCallback, useEffect, useState } from 'react'
import { api, ConflictError } from '@/api/client'
import type { DeskSyncStatus, ReadToolServer, WorkAgentSettings as Settings } from '@/api/types'
import { useAgents } from '@/agents/useAgents'
import { SecondaryButton, SettingGroup, SwitchRow, errorText } from '@/settings/controls'
import { workToast } from '@/work/state/workToasts'
import { CreateWorkAgentDialog } from './CreateWorkAgentDialog'
import { DeskSyncRow } from './DeskSyncRow'
import { ReadToolsList } from './ReadToolsList'
import { WORK_AGENT_TEXT as T } from './workAgentText'

export function WorkAgentSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [servers, setServers] = useState<ReadToolServer[]>([])
  const [desk, setDesk] = useState<DeskSyncStatus | null>(null)
  const [dialog, setDialog] = useState(false)
  const agents = useAgents((s) => s.agents)

  const reload = useCallback(async () => {
    try {
      const [s, r, d] = await Promise.all([api.workAgentSettings(), api.workReadTools(), api.deskSync()])
      setSettings(s)
      setServers(r)
      setDesk(d)
    } catch (e) {
      workToast(errorText(e))
    }
  }, [])

  useEffect(() => {
    void useAgents.getState().load()
    void reload()
  }, [reload])

  const save = async (patch: Parameters<typeof api.saveWorkAgentSettings>[0]) => {
    if (!settings) return
    try {
      setSettings(await api.saveWorkAgentSettings(patch, settings.settingsRevision))
    } catch (e) {
      if (e instanceof ConflictError) {
        await reload()
        workToast(T.changedElsewhere)
      } else {
        workToast(errorText(e))
      }
    }
  }

  if (!settings) return null
  const local = agents.filter((a) => a.kind === 'local')
  const created = async (s: Settings) => {
    setSettings(s)
    try {
      setDesk(await api.deskSync())
    } catch {
      /* keep what is shown */
    }
  }

  return (
    <>
      <h2 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-fg-muted">{T.group}</h2>
      <SettingGroup title={T.picker}>
        <div className="flex items-center gap-3">
          <select
            aria-label={T.picker}
            value={settings.agentId ?? ''}
            onChange={(e) => void save({ agentId: e.target.value === '' ? null : e.target.value })}
            className="h-9 max-w-[420px] rounded-md border border-line bg-raised px-2 text-[15px] text-fg"
          >
            <option value="">{T.none}</option>
            {local.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {settings.agentId === null && <SecondaryButton onClick={() => setDialog(true)}>{T.create}</SecondaryButton>}
        </div>
      </SettingGroup>
      <SwitchRow
        title={T.acts}
        help={T.actsHelp}
        checked={settings.acts}
        onChange={(on) => (on && settings.agentId === null ? setDialog(true) : void save({ acts: on }))}
      />
      <SwitchRow title={T.autoRun} help={T.autoRunHelp} checked={settings.autoRun} onChange={(on) => void save({ autoRun: on })} />
      <ReadToolsList servers={servers} marked={settings.readTools} onChange={(next) => void save({ readTools: next })} />
      {desk && <DeskSyncRow status={desk} onChange={setDesk} onProblem={workToast} />}
      <CreateWorkAgentDialog open={dialog} onOpenChange={setDialog} onCreated={(s) => void created(s)} />
    </>
  )
}
