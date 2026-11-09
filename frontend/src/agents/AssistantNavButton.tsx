/**
 * The Assistant, a row of the sidebar's main navigation (under Graph), not an "Agent": it is the
 * program's built-in, always-on helper — the implicit default agent (id `assistant`). A click opens
 * its chat in the side panel, like the old section row did. Nothing renders while AI features are
 * hidden. The user's own agents stay in the Agents section below.
 */
import { useEffect } from 'react'
import { useAiHidden } from '@/ai/store'
import { IconOrEmoji } from '@/components/Icon'
import { useAgents } from './useAgents'
import { openAgentChat } from './AgentsSection'

/** The implicit default agent's id (backend `agents.py`: never in the file, always listed). */
export const DEFAULT_AGENT_ID = 'assistant'

/** The Assistant's fallback name before the agent list arrives. */
export const ASSISTANT_LABEL = 'Assistant'

export function AssistantNavButton() {
  const hidden = useAiHidden()
  const agents = useAgents((s) => s.agents)
  const loaded = useAgents((s) => s.loaded)

  useEffect(() => {
    if (!hidden && !loaded) void useAgents.getState().load()
  }, [hidden, loaded])

  if (hidden) return null
  const agent = agents.find((a) => a.id === DEFAULT_AGENT_ID)
  return (
    <button
      type="button"
      data-assistant-nav=""
      aria-label={ASSISTANT_LABEL}
      title={agent?.description || ASSISTANT_LABEL}
      onClick={() => openAgentChat({ id: DEFAULT_AGENT_ID })}
      className="flex h-[38px] w-full items-center gap-2 rounded-lg px-2 text-left text-[15px] font-medium text-fg hover:bg-hover"
    >
      <IconOrEmoji icon={agent?.icon} fallback="ph-sparkle" size={16} />
      <span>{agent?.name ?? ASSISTANT_LABEL}</span>
    </button>
  )
}
