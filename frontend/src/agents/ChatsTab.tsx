/**
 * M17: the agent page's Chats tab (spec section 2): this agent's chats, newest first. Each row shows
 * the title, the space it was had in, the date and the message count; a click opens the chat in
 * the side panel. The list reloads on `agentChats` events for this agent.
 *
 * M18: the field is "Search chats". Under 2 characters it filters the titles (as in M17); from 2
 * characters it searches the chats' text (`searchAgentChats`, debounced 250 ms) and lists the hits
 * with their snippets, the «…» marks shown as bold text (text nodes, never HTML).
 *
 * M20: a delegated chat shows "Delegated by {agent name}" under its title ("Delegated by another
 * agent" when the delegating agent isn't listed).
 */
import { useCallback, useEffect, useState } from 'react'
import { api, RESYNC_PATH } from '@/api/client'
import type { Agent, AgentChatSummary, ChatSearchHit } from '@/api/types'
import { useAiFocus } from '@/ai/reveal'
import { useTabs } from '@/nav/tabs'
import { REMOTE_TEXT } from './agentText'
import { useAgents } from './useAgents'

// Our strings ("Search chats" is the M18 plan's).
export const CHATS_TEXT = {
  filter: 'Search chats',
  empty: 'No chats with this agent yet.',
  noMatch: 'No chats match.',
  list: 'Chats',
  hits: 'Matching chats',
  messages: (n: number) => (n === 1 ? '1 message' : `${n} messages`),
  loading: 'Loading…',
  searching: 'Searching…',
} as const

/** From this many characters the field searches the chats' text (our number). */
export const SEARCH_MIN = 2
/** The search waits this long after the last key (our number). */
export const SEARCH_DEBOUNCE_MS = 250

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

/** A snippet's pieces: the «…» marked ones are matches. */
export function snippetPieces(snippet: string): { text: string; match: boolean }[] {
  const out: { text: string; match: boolean }[] = []
  const re = /«([^»]*)»/g
  let last = 0
  for (let m = re.exec(snippet); m; m = re.exec(snippet)) {
    if (m.index > last) out.push({ text: snippet.slice(last, m.index), match: false })
    if (m[1]) out.push({ text: m[1], match: true })
    last = m.index + m[0].length
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), match: false })
  return out
}

function Snippet({ text }: { text: string }) {
  return (
    <p data-snippet="" className="truncate text-[13px] text-fg-muted">
      {snippetPieces(text).map((p, i) => (p.match ? <strong key={i} className="font-semibold text-fg">{p.text}</strong> : <span key={i}>{p.text}</span>))}
    </p>
  )
}

/** "Delegated by {name}" for a delegated chat, else null. */
export function delegatedLine(chat: Pick<AgentChatSummary, 'delegated' | 'from'>, agents: Pick<Agent, 'id' | 'name'>[]): string | null {
  if (!chat.delegated) return null
  const by = chat.from ? agents.find((a) => a.id === chat.from) : undefined
  return by ? REMOTE_TEXT.delegatedBy(by.name) : REMOTE_TEXT.delegatedByUnknown
}

export function ChatsTab({ agent }: { agent: Agent }) {
  const agents = useAgents((s) => s.agents)
  const [chats, setChats] = useState<AgentChatSummary[] | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hits, setHits] = useState<{ q: string; hits: ChatSearchHit[] } | null>(null)
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

  const query = filter.trim()
  const searching = query.length >= SEARCH_MIN

  // From 2 characters: the full-text search, debounced; a later key's answer wins.
  useEffect(() => {
    if (!searching) return
    let live = true
    const timer = setTimeout(() => {
      api
        .searchAgentChats(id, query)
        .then((list) => {
          if (live) {
            setHits({ q: query, hits: list ?? [] })
            setError(null)
          }
        })
        .catch((e: unknown) => {
          if (live) setError(e instanceof Error ? e.message : String(e))
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [id, query, searching])

  const needle = query.toLocaleLowerCase()
  const shown = (chats ?? []).filter((c) => !needle || c.title.toLocaleLowerCase().includes(needle))
  const found = searching && hits?.q === query ? hits.hits : null

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
      {searching ? (
        found === null ? (
          !error && <p className="text-[14px] text-fg-muted">{CHATS_TEXT.searching}</p>
        ) : found.length === 0 ? (
          <p className="text-[14px] text-fg-muted">{CHATS_TEXT.noMatch}</p>
        ) : (
          <ul aria-label={CHATS_TEXT.hits} className="flex flex-col">
            {found.map((h) => (
              <li key={h.chatId} data-chat={h.chatId}>
                <button
                  type="button"
                  onClick={() => openAgentTranscript(id, h.chatId)}
                  className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left text-[14px] hover:bg-hover"
                >
                  <span className="flex w-full items-center gap-3">
                    <span className="min-w-0 flex-1 truncate font-medium">{h.title}</span>
                    {h.spaceName && <span className="shrink-0 truncate text-fg-muted">{h.spaceName}</span>}
                    <span className="shrink-0 text-fg-muted">{chatDate(h.updatedAt)}</span>
                  </span>
                  {h.snippets.map((sn, i) => (
                    <Snippet key={i} text={sn} />
                  ))}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : chats === null ? (
        !error && <p className="text-[14px] text-fg-muted">{CHATS_TEXT.loading}</p>
      ) : shown.length === 0 ? (
        <p className="text-[14px] text-fg-muted">{chats.length === 0 ? CHATS_TEXT.empty : CHATS_TEXT.noMatch}</p>
      ) : (
        <ul aria-label={CHATS_TEXT.list} className="flex flex-col">
          {shown.map((c) => {
            const by = delegatedLine(c, agents)
            return (
              <li key={c.id} data-chat={c.id}>
                <button
                  type="button"
                  onClick={() => openAgentTranscript(id, c.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[14px] hover:bg-hover"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{c.title}</span>
                    {by && (
                      <span data-delegated="" className="truncate text-[13px] text-fg-muted">
                        {by}
                      </span>
                    )}
                  </span>
                  {c.spaceName && <span className="shrink-0 truncate text-fg-muted">{c.spaceName}</span>}
                  <span className="shrink-0 text-fg-muted">{chatDate(c.updatedAt)}</span>
                  <span className="shrink-0 text-fg-muted">{CHATS_TEXT.messages(c.messageCount)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
