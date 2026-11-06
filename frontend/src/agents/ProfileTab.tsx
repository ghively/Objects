/**
 * M17: the agent page's Profile tab (spec section 2). Name, icon, description and model; each
 * field saves on change with the agent's revision (`PUT /agents/{id}`). The default agent's model
 * is Settings' model (`aiModel`): the route writes it there, and Settings is reloaded after. On a
 * 409 the tab reloads the agent and asks for the change again. "Folder" shows the path with an
 * "Open folder" button; folder MCP servers missing secrets say so (the values come in M19);
 * "Remove from list" unregisters an agent that isn't the default one. A read-only agent shows
 * its reason and every field is disabled.
 *
 * M19: each variable in "Needs secrets: …" has a "Set…" button that opens the Set dialog; after
 * saving, the agent reloads (the route also announces `agents`).
 */
import { useEffect, useRef, useState } from 'react'
import { api, ConflictError } from '@/api/client'
import type { Agent, AgentInput } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ModelPicker } from '@/ai/ModelPicker'
import { MCP_TEXT } from '@/mcp/mcpText'
import { SetSecretDialog } from '@/mcp/SetSecretDialog'
import { useSettings } from '@/settings/useSettings'
import { iconValue } from './NewAgentDialog'
import { useAgents } from './useAgents'

// Our strings.
export const PROFILE_TEXT = {
  name: 'Name',
  icon: 'Icon',
  description: 'Description',
  model: 'Model',
  defaultModel: 'Default',
  folder: 'Folder',
  openFolder: 'Open folder',
  servers: 'Folder MCP servers',
  needsSecrets: (vars: string[]) => `Needs secrets: ${vars.join(', ')}`,
  removeFromList: 'Remove from list',
  removed: 'Removed from the list. Its folder was left where it is.',
  conflict: 'This agent was changed elsewhere. Its latest settings are shown: apply your change again.',
  missing: "This agent's folder is missing.",
} as const

/** The longest name and description `agent.json` accepts (`agentmodel.NAME_MAX`, `DESCRIPTION_MAX`). */
const NAME_MAX = 60
const DESCRIPTION_MAX = 500

/** Everything `PUT /agents/{id}` takes, as the agent has it now. */
export function inputOf(a: Agent): AgentInput {
  return {
    name: a.name,
    icon: a.icon,
    color: a.color,
    description: a.description,
    model: a.model,
    toolsOff: [...a.toolsOff],
    learning: a.learning,
  }
}

/** Put a saved agent into the shared list at once (the `agents` event reloads it again later). */
export function putAgent(next: Agent): void {
  useAgents.setState((s) => ({ agents: s.agents.map((a) => (a.id === next.id ? next : a)) }))
}

/** Fetch one agent again and put it into the shared list. */
export async function reloadAgent(id: string): Promise<Agent | null> {
  try {
    const fresh = await api.agent(id)
    if (fresh) putAgent(fresh)
    return fresh ?? null
  } catch {
    await useAgents.getState().load()
    return null
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function ProfileTab({ agent }: { agent: Agent }) {
  const latest = useRef(agent)
  latest.current = agent
  const [name, setName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description)
  const [iconOpen, setIconOpen] = useState(false)
  const [settingVar, setSettingVar] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const disabled = agent.readOnlyReason !== null

  // A reload (after a conflict, or a change from elsewhere) shows the agent's own values.
  useEffect(() => setName(agent.name), [agent.name])
  useEffect(() => setDescription(agent.description), [agent.description])

  const save = async (patch: Partial<AgentInput>) => {
    const cur = latest.current
    setError(null)
    setNotice(null)
    try {
      const next = await api.saveAgent(cur.id, { ...inputOf(cur), ...patch }, cur.revision)
      latest.current = next
      putAgent(next)
      // The default agent's model is Settings' model: show the value the route wrote there.
      if (cur.default && 'model' in patch) await useSettings.getState().load()
    } catch (e) {
      if (e instanceof ConflictError) {
        setNotice(PROFILE_TEXT.conflict)
        await reloadAgent(cur.id)
      } else {
        setError(message(e))
      }
    }
  }

  const commitName = () => {
    const next = name.replace(/\s+/g, ' ').trim()
    if (!next) return setName(agent.name)
    if (next !== agent.name) void save({ name: next })
  }

  const commitDescription = () => {
    if (description !== agent.description) void save({ description })
  }

  const remove = async () => {
    setError(null)
    try {
      await api.unregisterAgent(agent.id)
      setNotice(PROFILE_TEXT.removed)
      await useAgents.getState().load()
    } catch (e) {
      setError(message(e))
    }
  }

  const reveal = async () => {
    setError(null)
    try {
      await api.revealAgentFolder(agent.id)
    } catch (e) {
      setError(message(e))
    }
  }

  const field = 'h-9 rounded-md border border-line bg-transparent px-2 text-[14px] font-normal outline-none focus:border-fg-muted disabled:opacity-60'
  const needing = agent.mcpServers.filter((s) => s.missingVars.length > 0)

  return (
    <div className="flex flex-col gap-4" data-agent-tab="profile">
      {agent.readOnlyReason && (
        <p role="note" className="rounded-md border border-line px-3 py-2 text-[14px] text-fg-muted">
          {agent.readOnlyReason}
        </p>
      )}
      {agent.missing && <p className="text-[14px] text-fg-muted">{PROFILE_TEXT.missing}</p>}

      <div className="flex items-end gap-2">
        <Popover open={iconOpen} onOpenChange={setIconOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={PROFILE_TEXT.icon}
              title={PROFILE_TEXT.icon}
              disabled={disabled}
              className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line hover:bg-hover disabled:opacity-60"
            >
              <IconOrEmoji icon={agent.icon} fallback={agent.default ? 'ph-sparkle' : 'ph-robot'} size={18} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
            <IconPicker
              value={iconValue(agent.icon)}
              onChange={(next) => {
                setIconOpen(false)
                void save({ icon: next ? next.val : null })
              }}
            />
          </PopoverContent>
        </Popover>
        <label className="flex flex-1 flex-col gap-1 text-[13px] font-semibold">
          {PROFILE_TEXT.name}
          <input
            value={name}
            maxLength={NAME_MAX}
            disabled={disabled}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitName()
              }
            }}
            className={field}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        {PROFILE_TEXT.description}
        <textarea
          value={description}
          maxLength={DESCRIPTION_MAX}
          rows={3}
          disabled={disabled}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitDescription}
          className="rounded-md border border-line bg-transparent px-2 py-1.5 text-[14px] font-normal outline-none focus:border-fg-muted disabled:opacity-60"
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold">{PROFILE_TEXT.model}</span>
        <ModelPicker
          value={agent.model}
          onChange={(model) => void save({ model })}
          defaultLabel={PROFILE_TEXT.defaultModel}
          ariaLabel={PROFILE_TEXT.model}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold">{PROFILE_TEXT.folder}</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-line px-2 py-1.5 text-[13px]" title={agent.folder}>
            {agent.folder}
          </code>
          <Button type="button" variant="outline" onClick={() => void reveal()} disabled={!agent.exists || agent.missing}>
            {PROFILE_TEXT.openFolder}
          </Button>
        </div>
      </div>

      {needing.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">{PROFILE_TEXT.servers}</span>
          <ul className="flex flex-col gap-0.5 text-[14px]">
            {needing.map((s) => (
              <li key={s.name} data-mcp-server={s.name}>
                <span className="font-medium">{s.name}</span>{' '}
                <span className="text-fg-muted">{PROFILE_TEXT.needsSecrets(s.missingVars)}</span>
                {s.missingVars.map((v) => (
                  <Button
                    key={v}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-2 h-7"
                    aria-label={`${MCP_TEXT.setVar} ${v}`}
                    data-set-var={v}
                    onClick={() => setSettingVar(v)}
                  >
                    {MCP_TEXT.setVar}
                  </Button>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <SetSecretDialog
        name={settingVar}
        onOpenChange={(o) => !o && setSettingVar(null)}
        onSaved={() => void reloadAgent(agent.id)}
      />

      {!agent.default && (
        <div>
          <Button type="button" variant="outline" onClick={() => void remove()}>
            {PROFILE_TEXT.removeFromList}
          </Button>
        </div>
      )}

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
    </div>
  )
}
