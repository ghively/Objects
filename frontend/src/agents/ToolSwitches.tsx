/**
 * M17: the tool switches, shared by the New agent form and the agent page's Tools tab. One block
 * per group (Object read, Object write, Object agent tools, Claude Code built-ins, then one per
 * folder MCP server), a switch per group and per row. `off` (the switched-off tool ids, as stored
 * in `agent.json` `toolsOff`) is the state; a group's switch sets every row of the group. Turning
 * on a row that carries a warning (the shell) asks first, with the warning verbatim.
 *
 * M19: a group with `server` (an outside MCP server's) shows `ServerGroupStatus` under its header;
 * its switches are disabled while the server is turned off in Settings or needs secrets, and a
 * listed server with no tools says "No tools". A group with no rows has no group switch.
 */
import { useState } from 'react'
import type { ToolGroup, ToolRow } from '@/api/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Switch } from '@/components/ui/switch'
import { MCP_TEXT } from '@/mcp/mcpText'
import { ServerGroupStatus, serverSwitchesDisabled } from '@/mcp/ServerGroupStatus'
import { AGENT_TEXT } from './agentText'

export interface ToolSwitchesProps {
  groups: ToolGroup[]
  off: string[]
  onChange(off: string[]): void
  disabled?: boolean
  /** M19: the Tools tab is listing the outside servers' tools again ("Listing tools…"). */
  serversLoading?: boolean
}

interface Pending {
  warning: string
  next: string[]
}

export function ToolSwitches({ groups, off, onChange, disabled, serversLoading }: ToolSwitchesProps) {
  const [pending, setPending] = useState<Pending | null>(null)
  const offSet = new Set(off)

  /** Apply `next`, asking first when it turns on a row with a warning. */
  const change = (next: string[], turnedOn: ToolRow[]) => {
    const warned = turnedOn.find((r) => r.warning)
    if (warned) setPending({ warning: warned.warning ?? AGENT_TEXT.shellWarning, next })
    else onChange(next)
  }

  const setRow = (row: ToolRow, on: boolean) => {
    if (on) change(off.filter((id) => id !== row.id), [row])
    else onChange([...off, row.id])
  }

  const setGroup = (group: ToolGroup, on: boolean) => {
    const ids = new Set(group.tools.map((t) => t.id))
    if (on) {
      change(
        off.filter((id) => !ids.has(id)),
        group.tools.filter((t) => offSet.has(t.id)),
      )
    } else {
      onChange([...off.filter((id) => !ids.has(id)), ...group.tools.map((t) => t.id)])
    }
  }

  return (
    <div className="flex flex-col gap-3" data-tool-switches="">
      {groups.map((g) => {
        const allOn = g.tools.length > 0 && g.tools.every((t) => !offSet.has(t.id))
        const headingId = `tool-group-${g.id}`
        const locked = disabled || serverSwitchesDisabled(g.server)
        return (
          <section key={g.id} aria-labelledby={headingId} data-tool-group={g.id} className="rounded-lg border border-line">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <h3 id={headingId} className="flex-1 text-[14px] font-semibold">
                {g.label}
              </h3>
              {g.tools.length > 0 && (
                <Switch
                  aria-label={AGENT_TEXT.groupSwitch(g.label)}
                  checked={allOn}
                  disabled={locked}
                  onCheckedChange={(on) => setGroup(g, on)}
                />
              )}
            </div>
            {g.server && <ServerGroupStatus status={g.server} loading={serversLoading} />}
            {g.server && g.server.status === 'ok' && g.tools.length === 0 && !serversLoading && (
              <p className="px-3 py-1.5 text-[13px] text-fg-muted">{MCP_TEXT.noTools}</p>
            )}
            <ul className="flex flex-col">
              {g.tools.map((t) => (
                <li key={t.id} data-tool={t.id} className="flex items-center gap-2 px-3 py-1.5 text-[14px]">
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                  <Switch
                    aria-label={t.label}
                    checked={!offSet.has(t.id)}
                    disabled={locked}
                    onCheckedChange={(on) => setRow(t, on)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent className="border-line bg-raised-2 text-fg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px]">{AGENT_TEXT.turnOnTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-[14px] text-fg-muted">{pending?.warning}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{AGENT_TEXT.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) onChange(pending.next)
                setPending(null)
              }}
            >
              {AGENT_TEXT.turnOn}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
