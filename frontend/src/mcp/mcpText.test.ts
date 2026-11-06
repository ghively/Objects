import { describe, expect, test } from 'vitest'
import { MCP_TEXT } from './mcpText'

describe('MCP_TEXT', () => {
  test('test every label is a non-empty string', () => {
    const samples: Record<string, unknown[]> = {
      urlSummary: ['https://host/path', 'sse'],
      toolCount: [12],
      testFailed: ['The server answered 500.'],
      tools: [12],
      usedBy: [[{ agentId: '01J', agentName: 'Researcher', server: 'github' }]],
      setTitle: ['GH_TOKEN'],
      needsSecrets: [['GH_TOKEN']],
      listFailed: ['The server answered 500.'],
    }
    for (const [key, value] of Object.entries(MCP_TEXT)) {
      const text = typeof value === 'function' ? (value as (...a: unknown[]) => unknown)(...(samples[key] ?? [])) : value
      expect(typeof text, key).toBe('string')
      expect((text as string).trim(), key).not.toBe('')
    }
    expect(MCP_TEXT.toolCount(12)).toBe('12 tools')
    expect(MCP_TEXT.urlSummary('https://host/path', 'http')).toBe('https://host/path · HTTP')
    expect(MCP_TEXT.usedBy([{ agentId: '01J', agentName: 'Researcher', server: 'github' }])).toBe('Used by Researcher (github)')
    expect(MCP_TEXT.setTitle('GH_TOKEN')).toBe('Set GH_TOKEN')
  })
})
