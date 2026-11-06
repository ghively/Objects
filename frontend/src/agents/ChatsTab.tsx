/**
 * M17: the agent page's Chats tab (spec section 2): this agent's chats, newest first, with a
 * filter over their titles ("Filter chats"). Each row shows the title, the space it was had in,
 * the date and the message count; a click opens the chat in the side panel. The list reloads on
 * `agentChats` events for this agent. Full-text search over chats comes in M18.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, RESYNC_PATH } from '@/api/client'
import type { Agent, AgentChatSummary } from '@/api/types'
import { useAiFocus } from '@/ai/reveal'
import { useTabs } from '@/nav/tabs'

// Our strings ("Filter chats" is the plan's).
export const CHATS_TEXT = {
  filter: 'Filter chats',
  empty: 'No chats with this agent yet.',
  noMatch: 'No chats match.',
  list: 'Chats',
  messages: (n: number) => (n === 1 ? '1 message' : `${n} messages`),
  loading: 'Loading…',
} as const

/** A chat's date as the rows show it. */
export function chatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Open `chatId` of `agentId` in the active tab's side panel and focus it. */
export function openAgentTranscript(agentId: string, chatId: string): void {
  useTabs.getState().openInSidepanel({ kind: 'aiChat', agentId, chatId })
  useAiFocus.getState().bump()
}

export function ChatsTab({ agent }: { agent: Agent }) {
  const [chats, setChats] = useState<AgentChatSummary[] | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const id = agent.id

  const load = useCallback(async () => {
    try {
      const list = await api.agentChats(id)
      setChats(list ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [id])

  useEffect(() => {
    let live = true
    const reload = () => {
      if (live) void load()
    }
    reload()
    const off = api.onChange((e) => {
      if (e.kind === 'agentChats' && (e.path === id || e.path === RESYNC_PATH)) reload()
    })
    return () => {
      live = false
      off?.()
    }
  }, [id, load])

  const needle = filter.trim().toLocaleLowerCase()
  const shown = (chats ?? []).filter((c) => !needle || c.title.toLocaleLowerCase().includes(needle))

  return (
    <div className="flex flex-col gap-3" data-agent-tab="chats">
      <input
        type="search"
        aria-label={CHATS_TEXT.filter}
        placeholder={CHATS_TEXT.filter}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="h-9 rounded-md border border-line bg-transparent px-2 text-[14px] outline-none focus:border-fg-muted"
      />
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {chats === null ? (
        !error && <p className="text-[14px] text-fg-muted">{CHATS_TEXT.loading}</p>
      ) : shown.length === 0 ? (
        <p className="text-[14px] text-fg-muted">{chats.length === 0 ? CHATS_TEXT.empty : CHATS_TEXT.noMatch}</p>
      ) : (
        <ul aria-label={CHATS_TEXT.list} className="flex flex-col">
          {shown.map((c) => (
            <li key={c.id} data-chat={c.id}>
              <button
                type="button"
                onClick={() => openAgentTranscript(id, c.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[14px] hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                {c.spaceName && <span className="shrink-0 truncate text-fg-muted">{c.spaceName}</span>}
                <span className="shrink-0 text-fg-muted">{chatDate(c.updatedAt)}</span>
                <span className="shrink-0 text-fg-muted">{CHATS_TEXT.messages(c.messageCount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
