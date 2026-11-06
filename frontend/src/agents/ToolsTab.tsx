/**
 * M17: the agent page's Tools tab (spec section 4): the tool switches over `GET /agents/{id}/tools`
 * (the catalogue with this agent's states, plus a group per folder MCP server). A change saves
 * `toolsOff` through `PUT /agents/{id}` with the revision; turning the shell on asks first
 * (`ToolSwitches`). On a 409 the tab reloads the agent and asks for the change again.
 */
import { useEffect, useRef, useState } from 'react'
import { api, ConflictError } from '@/api/client'
import type { Agent, ToolGroup } from '@/api/types'
import { inputOf, PROFILE_TEXT, putAgent, reloadAgent } from './ProfileTab'
import { ToolSwitches } from './ToolSwitches'

// Our strings.
export const TOOLS_TEXT = {
  intro: 'Every tool is on unless you switch it off. Switched-off tools are refused when this agent runs.',
  loading: 'Loading…',
} as const

export function ToolsTab({ agent }: { agent: Agent }) {
  const [groups, setGroups] = useState<ToolGroup[] | null>(null)
  const [off, setOff] = useState<string[]>(agent.toolsOff)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(agent)
  latest.current = agent
  const id = agent.id

  useEffect(() => {
    let live = true
    void api.agentTools(id).then(
      (g) => live && setGroups(g ?? []),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [id])

  // A reload (after a conflict, or a change from elsewhere) shows the agent's own switches.
  const offKey = agent.toolsOff.join('\n')
  useEffect(() => setOff(offKey ? offKey.split('\n') : []), [offKey])

  const change = async (next: string[]) => {
    const cur = latest.current
    setOff(next)
    setNotice(null)
    setError(null)
    try {
      const saved = await api.saveAgent(cur.id, { ...inputOf(cur), toolsOff: next }, cur.revision)
      latest.current = saved
      putAgent(saved)
    } catch (e) {
      if (e instanceof ConflictError) {
        setNotice(PROFILE_TEXT.conflict)
        const fresh = await reloadAgent(cur.id)
        setOff(fresh ? fresh.toolsOff : cur.toolsOff)
      } else {
        setOff(cur.toolsOff)
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }

  return (
    <div className="flex flex-col gap-3" data-agent-tab="tools">
      <p className="text-[14px] text-fg-muted">{TOOLS_TEXT.intro}</p>
      {notice && (
        <p role="status" className="text-[13px] text-fg-muted">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {groups ? (
        <ToolSwitches groups={groups} off={off} onChange={(next) => void change(next)} disabled={agent.readOnlyReason !== null} />
      ) : (
        !error && <p className="text-[14px] text-fg-muted">{TOOLS_TEXT.loading}</p>
      )}
    </div>
  )
}
