/**
 * M18: the agent page's Skills tab. A placeholder until the plan's Task 10 replaces this file with
 * the skills list, a skill's detail, its History with Undo, and "Tidy up now". `agentTabs` loads
 * it lazily.
 */
import type { Agent } from '@/api/types'

export function SkillsTab({ agent }: { agent: Agent }) {
  return <div data-agent-tab="skills" data-agent={agent.id} />
}
