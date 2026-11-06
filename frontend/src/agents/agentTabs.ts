// M17: the agent page's tabs (spec section 2), in the spec's order. M17 has Profile (10),
// Instructions (20), Tools (30) and Chats (70); M18 adds Memory (40), Skills (50) and Learning
// (60). `registerAgentTab` keeps the list sorted by `order`.
//
// M20: each tab names the agent kinds it is shown for (`kinds`, default local only). A remote agent
// has Profile (its own, 10), Card (15) and Chats (70); `tabsFor` picks an agent's tabs.
import type { ComponentType } from 'react'
import type { Agent } from '@/api/types'
import { lazyWithReload } from '@/lib/lazyReload'
import { ChatsTab } from './ChatsTab'
import { InstructionsTab } from './InstructionsTab'
import { LearningTab } from './LearningTab'
import { LEARNING_TEXT } from './learningText'
import { MemoryTab } from './MemoryTab'
import { ProfileTab } from './ProfileTab'
import { RemoteCardTab } from './RemoteCardTab'
import { RemoteProfileTab } from './RemoteProfileTab'
import { ToolsTab } from './ToolsTab'

/** M18: the Skills tab, loaded when first shown (`AgentPage` wraps the tab in `Suspense`). */
const SkillsTab = lazyWithReload(() => import('./SkillsTab').then((m) => ({ default: m.SkillsTab })))

export interface AgentTab {
  id: string
  label: string
  order: number
  component: ComponentType<{ agent: Agent }>
  /** M20: the agent kinds this tab shows for; absent = `['local']`. */
  kinds?: ('local' | 'remote')[]
}

export const AGENT_TABS: AgentTab[] = [
  { id: 'profile', label: 'Profile', order: 10, component: ProfileTab },
  { id: 'remoteProfile', label: 'Profile', order: 10, component: RemoteProfileTab, kinds: ['remote'] },
  { id: 'card', label: 'Card', order: 15, component: RemoteCardTab, kinds: ['remote'] },
  { id: 'instructions', label: 'Instructions', order: 20, component: InstructionsTab },
  { id: 'tools', label: 'Tools', order: 30, component: ToolsTab },
  { id: 'memory', label: LEARNING_TEXT.memoryTab, order: 40, component: MemoryTab },
  { id: 'skills', label: LEARNING_TEXT.skillsTab, order: 50, component: SkillsTab },
  { id: 'learning', label: LEARNING_TEXT.learningTab, order: 60, component: LearningTab },
  { id: 'chats', label: 'Chats', order: 70, component: ChatsTab, kinds: ['local', 'remote'] },
]

/** The tabs an agent of `kind` shows, in order (a tab without `kinds` is local only). */
export function tabsFor(kind: Agent['kind']): AgentTab[] {
  return AGENT_TABS.filter((t) => (t.kinds ?? ['local']).includes(kind))
}

/** Add a tab (or replace the one with its id), keeping the list sorted by `order`. */
export function registerAgentTab(tab: AgentTab): void {
  const at = AGENT_TABS.findIndex((t) => t.id === tab.id)
  if (at >= 0) AGENT_TABS.splice(at, 1)
  const before = AGENT_TABS.findIndex((t) => t.order > tab.order)
  AGENT_TABS.splice(before < 0 ? AGENT_TABS.length : before, 0, tab)
}
