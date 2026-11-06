// M17: the agent page's tabs (spec section 2), in the spec's order. M17 has Profile (10),
// Instructions (20), Tools (30) and Chats (70); M18 registers Memory (40), Skills (50) and
// Learning (60) with `registerAgentTab`, which keeps the list sorted by `order`.
import type { ComponentType } from 'react'
import type { Agent } from '@/api/types'
import { ChatsTab } from './ChatsTab'
import { InstructionsTab } from './InstructionsTab'
import { ProfileTab } from './ProfileTab'
import { ToolsTab } from './ToolsTab'

export interface AgentTab {
  id: string
  label: string
  order: number
  component: ComponentType<{ agent: Agent }>
}

export const AGENT_TABS: AgentTab[] = [
  { id: 'profile', label: 'Profile', order: 10, component: ProfileTab },
  { id: 'instructions', label: 'Instructions', order: 20, component: InstructionsTab },
  { id: 'tools', label: 'Tools', order: 30, component: ToolsTab },
  { id: 'chats', label: 'Chats', order: 70, component: ChatsTab },
]

/** Add a tab (or replace the one with its id), keeping the list sorted by `order`. */
export function registerAgentTab(tab: AgentTab): void {
  const at = AGENT_TABS.findIndex((t) => t.id === tab.id)
  if (at >= 0) AGENT_TABS.splice(at, 1)
  const before = AGENT_TABS.findIndex((t) => t.order > tab.order)
  AGENT_TABS.splice(before < 0 ? AGENT_TABS.length : before, 0, tab)
}
