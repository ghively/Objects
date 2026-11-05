// M10 contract: how any part of the app opens the AI assistant. A caller (slash menu, block
// menu, selection toolbar, block selection bar, object menu, Explore) calls `openAiChat(seed)`;
// the AI chat side-panel entry (`{kind: 'aiChat'}`) takes the seed and runs it. `useAiHidden`
// is the "Hide AI features" switch: every AI entry renders nothing while it is on.
import { create } from 'zustand'
import type { AiMode } from '@/api/types'
import { useSettings } from '@/settings/useSettings'

export interface AiSeed {
  mode: AiMode
  /** An instruction or question to send at once; empty = let the user type. */
  prompt?: string
  /** Pages the request is about (default: the tab's open object). */
  contextPaths?: string[]
  /** The block or selected text the request is about. */
  block?: string | null
  /** The object `block` was taken from (the server sends the block only from a visible one). */
  blockPath?: string | null
  /** Set by an editor entry: puts accepted text in place of the block or selection. */
  onReplace?: (text: string) => void
  /** Set by an editor entry: inserts accepted text below the block. */
  onInsertBelow?: (text: string) => void
  /** Set by an editor entry: called once the seed is replaced (another seed, New chat, the chat closing). */
  release?: () => void
}

interface AiState {
  /** The seed waiting for the chat panel, with a counter so the same seed twice still runs. */
  pending: { seed: AiSeed; n: number } | null
  open(seed: AiSeed): void
  /** The chat panel takes the waiting seed (once). */
  take(): AiSeed | null
}

let counter = 0

export const useAi = create<AiState>((set, get) => ({
  pending: null,
  open(seed) {
    counter += 1
    // A seed the chat never took is replaced: let it go.
    get().pending?.seed.release?.()
    set({ pending: { seed, n: counter } })
  },
  take() {
    const p = get().pending
    if (!p) return null
    set({ pending: null })
    return p.seed
  },
}))

/**
 * The hook the chat panel registers to show itself (open or focus the AI chat side-panel entry).
 * `openAiChat` calls it after storing the seed; until it is set, the seed just waits.
 */
let reveal: (() => void) | null = null
export function setAiReveal(fn: (() => void) | null): void {
  reveal = fn
}

/** Open the AI assistant with `seed` (does nothing while AI features are hidden). */
export function openAiChat(seed: AiSeed): void {
  if (useSettings.getState().settings.aiHidden) return
  useAi.getState().open(seed)
  reveal?.()
}

/** True while "Hide AI features" is on. */
export function useAiHidden(): boolean {
  return useSettings((s) => s.settings.aiHidden)
}

export function resetAiStore(): void {
  useAi.getState().pending?.seed.release?.()
  useAi.setState({ pending: null })
}
