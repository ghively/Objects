import { describe, expect, test } from 'vitest'
import { AGENT_TABS, registerAgentTab, tabsFor } from './agentTabs'

describe('agentTabs', () => {
  test('test the seven tabs in order and registerAgentTab inserts by order', () => {
    expect(tabsFor('local').map((t) => [t.id, t.label, t.order])).toEqual([
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
      expect(tabsFor('local').map((t) => t.label)).toEqual(['Profile', 'Instructions', 'Tools', 'Memory', 'Skills', 'Learning', 'Later', 'Chats'])
      // The same id again replaces the tab instead of adding a second one.
      registerAgentTab({ id: 'memory', label: 'Memory 2', order: 40, component: Empty })
      expect(AGENT_TABS.filter((t) => t.id === 'memory').map((t) => t.label)).toEqual(['Memory 2'])
      expect(tabsFor('local')).toHaveLength(8)
    } finally {
      AGENT_TABS.splice(0, AGENT_TABS.length, ...saved)
    }
  })

  test('test a remote agent has Profile, Card and Chats', () => {
    expect(tabsFor('remote').map((t) => [t.id, t.label, t.order])).toEqual([
      ['remoteProfile', 'Profile', 10],
      ['card', 'Card', 15],
      ['chats', 'Chats', 70],
    ])
  })

  test('test registerAgentTab without kinds is local only', () => {
    const saved = [...AGENT_TABS]
    try {
      const Empty = () => null
      registerAgentTab({ id: 'extra', label: 'Extra', order: 66, component: Empty })
      expect(tabsFor('local').map((t) => t.id)).toContain('extra')
      expect(tabsFor('remote').map((t) => t.id)).not.toContain('extra')
      registerAgentTab({ id: 'both', label: 'Both', order: 67, component: Empty, kinds: ['local', 'remote'] })
      expect(tabsFor('remote').map((t) => t.id)).toEqual(['remoteProfile', 'card', 'both', 'chats'])
    } finally {
      AGENT_TABS.splice(0, AGENT_TABS.length, ...saved)
    }
  })
})
