// M17: the chat header's agent picker (spec section 10), in `AiChatHeader`'s `leading` slot. It
// lists every agent (`useAgents`: the default agent first); picking another one is the panel's to
// act on (it starts a new chat with that agent).
// M20: remote agents carry the "remote" mark (spec section 2), in the list and on the button.
import { useEffect } from 'react'
import type { Agent } from '@/api/types'
import { RemoteMark } from '@/agents/RemoteMark'
import { useAgents } from '@/agents/useAgents'
import { Icon, IconOrEmoji } from '@/components/Icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** Our strings. */
export const AGENT_PICKER_TEXT = {
  label: 'Agent for this chat',
  /** The default agent's name before the list has loaded (agentmodel.DEFAULT_AGENT_NAME). */
  defaultName: 'Assistant',
  /** An agent id that isn't listed (any more). */
  unknown: 'Agent',
} as const

const T = AGENT_PICKER_TEXT
const DEFAULT_AGENT_ID = 'assistant'

export interface AgentPickerProps {
  value: string
  onChange(agentId: string): void
  disabled?: boolean
}

const fallbackIcon = (a: Pick<Agent, 'default' | 'kind'> | undefined, id: string) =>
  a?.kind === 'remote' ? 'ph-globe' : a?.default || id === DEFAULT_AGENT_ID ? 'ph-sparkle' : 'ph-robot'

export function AgentPicker({ value, onChange, disabled }: AgentPickerProps) {
  const agents = useAgents((s) => s.agents)
  const loaded = useAgents((s) => s.loaded)
  useEffect(() => {
    if (!loaded) void useAgents.getState().load()
  }, [loaded])
  const current = agents.find((a) => a.id === value)
  const name = current?.name ?? (value === DEFAULT_AGENT_ID ? T.defaultName : T.unknown)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={T.label}
          title={T.label}
          disabled={disabled}
          className="flex h-7 min-w-0 max-w-[200px] items-center gap-1.5 rounded-md px-1.5 text-[13px] font-medium text-fg hover:bg-hover disabled:opacity-50"
        >
          <IconOrEmoji icon={current?.icon ?? null} fallback={fallbackIcon(current, value)} size={14} />
          <span className="truncate">{name}</span>
          {current?.kind === 'remote' && <RemoteMark />}
          <Icon name="ph-caret-down" size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[220px] border-line bg-raised">
        <DropdownMenuRadioGroup value={value} onValueChange={(id) => id !== value && onChange(id)}>
          {agents.map((a) => (
            <DropdownMenuRadioItem key={a.id} value={a.id}>
              <IconOrEmoji icon={a.icon} fallback={fallbackIcon(a, a.id)} size={14} />
              <span className="truncate">{a.name}</span>
              {a.kind === 'remote' && <RemoteMark className="ml-auto" />}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
