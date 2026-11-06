/**
 * M17: the agent page (spec section 2), a main-view target `{kind: 'agent', id, tab}`. The
 * agent's icon and name, then its tabs (`AGENT_TABS`, sorted by order: Profile, Instructions,
 * Tools, Chats; M18 adds Memory, Skills and Learning). The agent comes from the shared list
 * (`useAgents`), which the tabs update after a save; opening the page writes nothing.
 */
import { useEffect, useState } from 'react'
import { IconOrEmoji } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { AGENT_TABS } from './agentTabs'
import { useAgents } from './useAgents'

export interface AgentPageProps {
  id: string
  /** The tab to show first (an `AGENT_TABS` id); Profile when absent or unknown. */
  tab?: string
}

// Our strings.
export const AGENT_PAGE_TEXT = {
  tabs: 'Agent settings',
  notListed: "This agent isn't listed any more.",
  loading: 'Loading…',
} as const

export function AgentPage({ id, tab }: AgentPageProps) {
  const agent = useAgents((s) => s.agents.find((a) => a.id === id))
  const loaded = useAgents((s) => s.loaded)
  const [active, setActive] = useState(() => (AGENT_TABS.some((t) => t.id === tab) ? tab! : AGENT_TABS[0].id))

  useEffect(() => {
    if (!useAgents.getState().loaded) void useAgents.getState().load()
  }, [])

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-fg-muted">
        {loaded ? AGENT_PAGE_TEXT.notListed : AGENT_PAGE_TEXT.loading}
      </div>
    )
  }

  const current = AGENT_TABS.find((t) => t.id === active) ?? AGENT_TABS[0]
  const Body = current.component

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-8 py-8" data-agent-page={agent.id}>
      <header className="flex items-center gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-line">
          <IconOrEmoji icon={agent.icon} fallback={agent.default ? 'ph-sparkle' : 'ph-robot'} size={22} />
        </span>
        <h1 className="min-w-0 flex-1 truncate text-[24px] font-semibold">{agent.name}</h1>
      </header>
      <div role="tablist" aria-label={AGENT_PAGE_TEXT.tabs} className="flex flex-wrap items-center gap-1 border-b border-line pb-2">
        {AGENT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`agent-tab-${t.id}`}
            aria-selected={t.id === current.id}
            aria-controls={`agent-panel-${t.id}`}
            onClick={() => setActive(t.id)}
            className={cn(
              'h-9 rounded-lg px-4 text-[15px]',
              t.id === current.id ? 'bg-hover font-medium text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`agent-panel-${current.id}`} aria-labelledby={`agent-tab-${current.id}`}>
        <Body key={`${agent.id}:${current.id}`} agent={agent} />
      </div>
    </div>
  )
}
