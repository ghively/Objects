// M18: the chat's `…` menu (aria-label "More") in the header, after New chat. "Learn from this chat"
// (spec section 5) runs a background review of this chat on demand: disabled until the chat has a
// chatId (its first reply) and while a review of it runs. A refusal (409 busy, 422 learning tools
// off, 503 no Claude Code) goes to `onNotice`, which the panel shows as its notice.
import { useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

// "Learn from this chat" is the spec's; "More" is our string.
export const CHAT_MENU_TEXT = {
  more: 'More',
  learn: 'Learn from this chat',
} as const

export interface ChatMenuProps {
  agentId: string | null
  chatId: string | null
  /** A review of this chat runs. */
  disabled?: boolean
  /** A refused request's message (the panel's notice). Not in the plan's props: the panel owns its notice. */
  onNotice?(message: string): void
}

export function ChatMenu({ agentId, chatId, disabled, onNotice }: ChatMenuProps) {
  const [starting, setStarting] = useState(false)
  const off = !agentId || !chatId || !!disabled || starting

  const learn = async () => {
    if (!agentId || !chatId) return
    setStarting(true)
    try {
      await api.learnFromChat(agentId, chatId)
    } catch (e) {
      onNotice?.(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={CHAT_MENU_TEXT.more}
          title={CHAT_MENU_TEXT.more}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="ph-dots-three" size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-line bg-raised text-fg">
        <DropdownMenuItem disabled={off} onSelect={() => void learn()}>
          <Icon name="ph-lightbulb" size={14} />
          {CHAT_MENU_TEXT.learn}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
