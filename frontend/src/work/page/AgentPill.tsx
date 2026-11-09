// M23 Task 9: the agent pill: "Agent is carrying N · M alerts" (spec); it opens the Agent queue view.
import type { JSX } from 'react'
import { Icon } from '@/components/Icon'
import { useWorkUi } from '../state/useWorkUi'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'

export function AgentPill({ carrying, alerts }: { carrying: number; alerts: number }): JSX.Element {
  return (
    <button
      type="button"
      data-tone="agent"
      onClick={() => {
        const ui = useWorkUi.getState()
        if (ui.calm) ui.setCalm(false)
        ui.setView('agent')
      }}
      className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-[var(--work-agent)] hover:bg-hover"
    >
      <Icon name={WORK_ICONS.agent} size={13} />
      {WORK_TEXT.agentPill(carrying, alerts)}
    </button>
  )
}
