/**
 * M17: the Agents section at the top of the sidebar (spec section 2), directly above the main
 * navigation. Each row is an agent's icon and name, the default agent first; a click opens that
 * agent's chat in the side panel. A row's `…` menu holds Open chat, Settings (the agent page),
 * Memory & skills (M18: the agent page's Memory tab), Duplicate (New agent, started from it) and Delete (no confirm: restorable from "Deleted
 * agents…"; an agent outside the state dir is only unregistered, and the section says so). The
 * heading's `+` menu holds New agent, Add agent folder… and Deleted agents…; "+ New agent" is
 * also the last row. Nothing renders while AI features are hidden.
 */
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { Agent } from '@/api/types'
import { useAiFocus } from '@/ai/reveal'
import { useAiHidden } from '@/ai/store'
import { Icon, IconOrEmoji } from '@/components/Icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTabs, type Target } from '@/nav/tabs'
import { cn } from '@/lib/utils'
import { AddAgentFolderDialog } from './AddAgentFolderDialog'
import { AgentTrashDialog } from './AgentTrashDialog'
import { AGENT_TEXT as T } from './agentText'
import { LEARNING_TEXT } from './learningText'
import { NewAgentDialog } from './NewAgentDialog'
import { useAgents } from './useAgents'

export interface AgentsSectionProps {
  /** The sidebar's opener (`SidebarProps['onOpenTarget']`); the tabs store's `open` when absent. */
  onOpenTarget?: (target: Target, opts: { newTab?: boolean }) => void
}

/** How long the "left where it is" notice shows. */
const NOTICE_MS = 6000

/** Open `agent`'s chat in the active tab's side panel and focus it. */
export function openAgentChat(agent: Pick<Agent, 'id'>): void {
  useTabs.getState().openInSidepanel({ kind: 'aiChat', agentId: agent.id })
  useAiFocus.getState().bump()
}

function AgentRow({
  agent,
  onOpen,
  onSettings,
  onMemory,
  onDuplicate,
  onDelete,
}: {
  agent: Agent
  onOpen(): void
  onSettings(): void
  onMemory(): void
  onDuplicate(): void
  onDelete(): void
}) {
  return (
    <li data-agent={agent.id} className="group/agent relative">
      <button
        type="button"
        onClick={onOpen}
        title={agent.missing ? T.missingFolder : agent.description || agent.name}
        className={cn(
          'flex h-[36px] w-full items-center gap-2 rounded-lg px-1.5 pr-8 text-left text-[15px] font-medium hover:bg-hover',
          agent.missing && 'opacity-50',
        )}
      >
        <span className="inline-flex size-[22px] shrink-0 items-center justify-center">
          <IconOrEmoji icon={agent.icon} fallback={agent.default ? 'ph-sparkle' : 'ph-robot'} size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate">{agent.name}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={T.rowMenu(agent.name)}
            title={T.rowMenu(agent.name)}
            className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted opacity-0 group-hover/agent:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <Icon name="ph-dots-three" size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="border-line bg-raised text-fg">
          <DropdownMenuItem onSelect={onOpen}>
            <Icon name="ph-chat-circle" size={14} />
            {T.openChat}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onSettings}>
            <Icon name="ph-gear" size={14} />
            {T.settings}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onMemory}>
            <Icon name="ph-lightbulb" size={14} />
            {LEARNING_TEXT.memoryAndSkills}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDuplicate}>
            <Icon name="ph-copy" size={14} />
            {T.duplicate}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" disabled={agent.default} onSelect={onDelete}>
            <Icon name="ph-trash" size={14} />
            {T.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

export function AgentsSection({ onOpenTarget }: AgentsSectionProps) {
  const hidden = useAiHidden()
  const agents = useAgents((s) => s.agents)
  const [newOpen, setNewOpen] = useState(false)
  const [duplicateOf, setDuplicateOf] = useState<Agent | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!hidden && !useAgents.getState().loaded) void useAgents.getState().load()
  }, [hidden])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(t)
  }, [notice])

  if (hidden) return null

  const open = (target: Target, opts: { newTab?: boolean }) =>
    onOpenTarget ? onOpenTarget(target, opts) : useTabs.getState().open(target, opts)

  const newAgent = (from: Agent | null) => {
    setDuplicateOf(from)
    setNewOpen(true)
  }

  const remove = async (agent: Agent) => {
    setNotice(null)
    try {
      const res = await api.deleteAgent(agent.id)
      if (res.trashId === null) setNotice(T.leftInPlace)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    }
    await useAgents.getState().load()
  }

  return (
    <section aria-labelledby="sb-agents" data-agents-section="" className="pb-2">
      <div className="group/sh flex items-center pr-1">
        <h2 id="sb-agents" className="flex flex-1 items-center gap-1.5 px-2 pt-1 pb-2 text-[14px] font-semibold text-[var(--text-section)]">
          {T.heading}
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={T.addMenu}
              title={T.addMenu}
              className="flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            >
              <Icon name="ph-plus" size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-line bg-raised text-fg">
            <DropdownMenuItem onSelect={() => newAgent(null)}>{T.newAgent}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAddOpen(true)}>{T.addFolder}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTrashOpen(true)}>{T.deletedAgents}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ul aria-label={T.heading} className="flex flex-col gap-0.5">
        {agents.map((a) => (
          <AgentRow
            key={a.id}
            agent={a}
            onOpen={() => openAgentChat(a)}
            onSettings={() => open({ kind: 'agent', id: a.id }, {})}
            onMemory={() => open({ kind: 'agent', id: a.id, tab: 'memory' }, {})}
            onDuplicate={() => newAgent(a)}
            onDelete={() => void remove(a)}
          />
        ))}
        <li>
          <button
            type="button"
            data-new-agent-row=""
            onClick={() => newAgent(null)}
            className="flex h-[36px] w-full items-center gap-2 rounded-lg px-1.5 text-left text-[15px] font-medium text-fg-muted hover:bg-hover hover:text-fg"
          >
            <span className="inline-flex size-[22px] shrink-0 items-center justify-center">
              <Icon name="ph-plus" size={16} />
            </span>
            <span>{T.newAgentRow}</span>
          </button>
        </li>
      </ul>
      {notice && (
        <p role="status" className="px-2 pt-1 text-[13px] text-fg-muted">
          {notice}
        </p>
      )}
      <NewAgentDialog open={newOpen} onOpenChange={setNewOpen} duplicateOf={duplicateOf} />
      <AddAgentFolderDialog open={addOpen} onOpenChange={setAddOpen} />
      <AgentTrashDialog open={trashOpen} onOpenChange={setTrashOpen} />
    </section>
  )
}
