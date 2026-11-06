// M17: every agent (the default agent first, then the registry's order), loaded once and kept
// current from `agents` change events. Shared by the sidebar's Agents section and the chat
// panel's agent picker. Agents belong to the machine, not the space, so the subscription is
// made on the first `load()` and kept for the window's life.
import { create } from 'zustand'
import { api } from '@/api/client'
import type { Agent } from '@/api/types'

export interface AgentsState {
  agents: Agent[]
  loaded: boolean
  /** Fetch the list now (after a write of our own, so it doesn't wait for the event). */
  load(): Promise<void>
  byId(id: string): Agent | undefined
}

const RELOAD_DELAY_MS = 150
let off: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0

function subscribe(load: () => Promise<void>): void {
  if (off) return
  off = api.onChange((e) => {
    if (e.kind !== 'agents') return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void load()
    }, RELOAD_DELAY_MS)
  })
}

export const useAgents = create<AgentsState>()((set, get) => ({
  agents: [],
  loaded: false,
  async load() {
    subscribe(get().load)
    const n = ++seq
    try {
      const agents = await api.agents()
      if (n === seq) set({ agents: agents ?? [], loaded: true })
    } catch (e) {
      console.warn('Could not load agents:', e)
      if (n === seq) set({ loaded: true })
    }
  },
  byId(id: string) {
    return get().agents.find((a) => a.id === id)
  },
}))

/** For tests: forget the agents and the subscription. */
export function resetAgents(): void {
  off?.()
  off = null
  if (timer) clearTimeout(timer)
  timer = null
  seq += 1
  useAgents.setState({ agents: [], loaded: false })
}
