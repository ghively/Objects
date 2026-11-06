// M18: the background reviews of one chat (spec section 5, "Learning…"): loaded on mount and again
// on every `agentLearning` event for the agent (a review's start and end announce one). A null
// agent or chat has none. Reading them writes nothing.
import { useEffect, useState } from 'react'
import { api, RESYNC_PATH } from '@/api/client'
import type { ReviewStatus } from '@/api/types'

const NONE: ReviewStatus[] = []

export function useChatReviews(agentId: string | null, chatId: string | null): ReviewStatus[] {
  const [state, setState] = useState<{ key: string; reviews: ReviewStatus[] }>({ key: '', reviews: NONE })
  const key = agentId && chatId ? `${agentId}\u0000${chatId}` : ''

  useEffect(() => {
    if (!agentId || !chatId) return
    let live = true
    let seq = 0
    const load = () => {
      const mine = ++seq
      api
        .chatReviews(agentId, chatId)
        .then((reviews) => {
          if (live && mine === seq) setState({ key: `${agentId}\u0000${chatId}`, reviews: reviews ?? NONE })
        })
        .catch(() => undefined)
    }
    load()
    const off = api.onChange((e) => {
      if (e.kind === 'agentLearning' && (e.path === agentId || e.path === RESYNC_PATH)) load()
    })
    return () => {
      live = false
      off?.()
    }
  }, [agentId, chatId])

  // Another chat's reviews never show while this one's load.
  return key && state.key === key ? state.reviews : NONE
}
