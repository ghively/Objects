/**
 * The Assistant, a row of the sidebar's main navigation (under Graph), not an "Agent": it is the
 * program's built-in, always-on helper — the implicit default agent (id `assistant`). A click opens
 * its chat in the side panel, like the old section row did. Nothing renders while AI features are
 * hidden. The user's own agents stay in the Agents section below.
 *
 * Its own page (Memory, Skills, Learning, Chats…) is reached the way an agent row's is: the row's
 * hover `…` menu (Open chat / Settings / Memory & skills). The Assistant cannot be duplicated or
 * deleted, so those items are left out.
 */
import { useEffect } from 'react'
import { useAiHidden } from '@/ai/store'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useTabs, type Target } from '@/nav/tabs'
import { requestAgentTab } from './AgentPage'
import { AGENT_TEXT as T } from './agentText'
import { LEARNING_TEXT } from './learningText'
import { useAgents } from './useAgents'
import { openAgentChat } from './AgentsSection'

/** The implicit default agent's id (backend `agents.py`: never in the file, always listed). */
export const DEFAULT_AGENT_ID = 'assistant'

/** The Assistant's fallback name before the agent list arrives. */
export const ASSISTANT_LABEL = 'Assistant'

export interface AssistantNavButtonProps {
  /** The sidebar's opener (`SidebarProps['onOpenTarget']`); the tabs store's `open` when absent. */
  onOpenTarget?: (target: Target, opts: { newTab?: boolean }) => void
}

export function AssistantNavButton({ onOpenTarget }: AssistantNavButtonProps = {}) {
  const hidden = useAiHidden()
  const agents = useAgents((s) => s.agents)
  const loaded = useAgents((s) => s.loaded)

  useEffect(() => {
    if (!hidden && !loaded) void useAgents.getState().load()
  }, [hidden, loaded])

  if (hidden) return null
  const agent = agents.find((a) => a.id === DEFAULT_AGENT_ID)
  const open = (target: Target) => (onOpenTarget ? onOpenTarget(target, {}) : useTabs.getState().open(target, {}))
  const openChat = () => openAgentChat({ id: DEFAULT_AGENT_ID })
  return (
    <div data-assistant-nav-row="" className="group/assistant relative">
      <button
        type="button"
        data-assistant-nav=""
        aria-label={ASSISTANT_LABEL}
        title={agent?.description || ASSISTANT_LABEL}
        onClick={openChat}
        className="flex h-[38px] w-full items-center gap-2 rounded-lg px-2 pr-8 text-left text-[15px] font-medium text-fg hover:bg-hover"
      >
        <IconOrEmoji icon={agent?.icon} fallback="ph-sparkle" size={16} />
        <span>{agent?.name ?? ASSISTANT_LABEL}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={T.rowMenu(ASSISTANT_LABEL)}
            title={T.rowMenu(ASSISTANT_LABEL)}
            className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted opacity-0 group-hover/assistant:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <Icon name="ph-dots-three" size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="border-line bg-raised text-fg">
          <DropdownMenuItem onSelect={openChat}>
            <Icon name="ph-chat-circle" size={14} />
            {T.openChat}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open({ kind: 'agent', id: DEFAULT_AGENT_ID })}>
            <Icon name="ph-gear" size={14} />
            {T.settings}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              requestAgentTab(DEFAULT_AGENT_ID, 'memory')
              open({ kind: 'agent', id: DEFAULT_AGENT_ID, tab: 'memory' })
            }}
          >
            <Icon name="ph-lightbulb" size={14} />
            {LEARNING_TEXT.memoryAndSkills}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
