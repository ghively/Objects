import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { McpGroupStatus } from '@/api/types'
import { MCP_TEXT } from './mcpText'
import { ServerGroupStatus, serverSwitchesDisabled } from './ServerGroupStatus'

function status(partial: Partial<McpGroupStatus> = {}): McpGroupStatus {
  return { source: 'gateway', serverId: '01JSRV', name: 'fake', status: 'ok', error: null, fetchedAt: null, missingVars: [], ...partial }
}

describe('ServerGroupStatus', () => {
  test('test each status has its line', () => {
    const { rerender, container } = render(<ServerGroupStatus status={status()} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ServerGroupStatus status={status({ status: 'unknown' })} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ServerGroupStatus status={status({ status: 'unknown' })} loading />)
    expect(screen.getByText(MCP_TEXT.listing)).toBeInTheDocument()
    rerender(<ServerGroupStatus status={status({ status: 'error', error: 'The server answered 500.' })} />)
    expect(screen.getByText("Couldn't list tools: The server answered 500.")).toBeInTheDocument()
    rerender(<ServerGroupStatus status={status({ status: 'disabled' })} loading />)
    expect(screen.getByText(MCP_TEXT.turnedOffInSettings)).toBeInTheDocument()
    rerender(<ServerGroupStatus status={status({ source: 'folder', status: 'needsSecrets', missingVars: ['GH_TOKEN'] })} loading />)
    expect(screen.getByText('Needs secrets: GH_TOKEN')).toBeInTheDocument()
  })

  test('test switches are disabled only for a turned-off server or missing secrets', () => {
    expect(serverSwitchesDisabled(status({ status: 'disabled' }))).toBe(true)
    expect(serverSwitchesDisabled(status({ status: 'needsSecrets' }))).toBe(true)
    for (const s of ['ok', 'error', 'unknown'] as const) expect(serverSwitchesDisabled(status({ status: s }))).toBe(false)
    expect(serverSwitchesDisabled(null)).toBe(false)
    expect(serverSwitchesDisabled(undefined)).toBe(false)
  })
})
