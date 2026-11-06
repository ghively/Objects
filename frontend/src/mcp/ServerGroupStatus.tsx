/**
 * M19: the status line under an outside MCP server's group on the agent page's Tools tab:
 * "Listing tools…" while the tab lists the tools again (a server that can be listed), "Couldn't
 * list tools: <error>", "Turned off in Settings > Integrations", "Needs secrets: GH_TOKEN". A
 * listed server and one not listed yet show nothing here ("No tools" is the group's own line).
 */
import type { McpGroupStatus } from '@/api/types'
import { MCP_TEXT } from './mcpText'

export interface ServerGroupStatusProps {
  status: McpGroupStatus
  loading?: boolean
}

/** The status line's text, or null for none. */
export function serverStatusText(status: McpGroupStatus, loading = false): string | null {
  if (status.status === 'disabled') return MCP_TEXT.turnedOffInSettings
  if (status.status === 'needsSecrets') return MCP_TEXT.needsSecrets(status.missingVars)
  if (loading) return MCP_TEXT.listing
  if (status.status === 'error') return MCP_TEXT.listFailed(status.error ?? '')
  return null
}

/** Whether the group's switches are disabled (the server can't run for this agent as it is). */
export function serverSwitchesDisabled(status: McpGroupStatus | null | undefined): boolean {
  return status?.status === 'disabled' || status?.status === 'needsSecrets'
}

export function ServerGroupStatus({ status, loading }: ServerGroupStatusProps) {
  const text = serverStatusText(status, loading)
  if (!text) return null
  return (
    <p
      data-server-status={loading && text === MCP_TEXT.listing ? 'loading' : status.status}
      className={`px-3 py-1.5 text-[13px] ${status.status === 'error' && !loading ? 'text-danger' : 'text-fg-muted'}`}
    >
      {text}
    </p>
  )
}
