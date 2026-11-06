import { describe, expect, test } from 'vitest'
import { AGENT_TABS, registerAgentTab } from './agentTabs'

describe('agentTabs', () => {
  test('test the seven tabs in order and registerAgentTab inserts by order', () => {
    expect(AGENT_TABS.map((t) => [t.id, t.label, t.order])).toEqual([
      ['profile', 'Profile', 10],
      ['instructions', 'Instructions', 20],
      ['tools', 'Tools', 30],
      ['memory', 'Memory', 40],
      ['skills', 'Skills', 50],
      ['learning', 'Learning', 60],
      ['chats', 'Chats', 70],
    ])
    const saved = [...AGENT_TABS]
    try {
      const Empty = () => null
      registerAgentTab({ id: 'later', label: 'Later', order: 65, component: Empty })
      expect(AGENT_TABS.map((t) => t.label)).toEqual(['Profile', 'Instructions', 'Tools', 'Memory', 'Skills', 'Learning', 'Later', 'Chats'])
      // The same id again replaces the tab instead of adding a second one.
      registerAgentTab({ id: 'memory', label: 'Memory 2', order: 40, component: Empty })
      expect(AGENT_TABS.filter((t) => t.id === 'memory').map((t) => t.label)).toEqual(['Memory 2'])
      expect(AGENT_TABS).toHaveLength(8)
    } finally {
      AGENT_TABS.splice(0, AGENT_TABS.length, ...saved)
    }
  })
})
