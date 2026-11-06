// M16: the model choices, read from the back end's one list (`GET /api/ai/models`). No model id
// and no copy of the model-name rule lives in the front end: both come from the server.
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { AiModels } from '@/api/types'

/** The picker's strings (our strings). `customPlaceholder`'s `{id}` is the first served pinned id. */
export const MODEL_TEXT = {
  default: 'Default',
  custom: 'Custom…',
  customPlaceholder: 'Model id, e.g. {id}',
  badName: "That isn't a model name.",
  latest: 'Latest',
  versions: 'Versions',
  save: 'Save',
} as const

let cached: AiModels | null = null
let pending: Promise<AiModels | null> | null = null

/** One request per window; a failure is forgotten so a later mount asks again. */
function loadModels(): Promise<AiModels | null> {
  if (!pending) {
    pending = api.aiModels().then(
      (m) => {
        cached = m
        return m
      },
      () => {
        pending = null
        return null
      },
    )
  }
  return pending
}

/** The served model list: fetched once per window and shared; null while loading or after a failure. */
export function useAiModels(): AiModels | null {
  const [models, setModels] = useState<AiModels | null>(cached)
  useEffect(() => {
    if (cached) return
    let live = true
    void loadModels().then((m) => {
      if (live) setModels(m)
    })
    return () => {
      live = false
    }
  }, [])
  return models ?? cached
}

/** What a picker shows for `id`: the default label for none, the served label, else the id itself. */
export function modelLabel(id: string | null, models: AiModels | null, defaultLabel: string): string {
  if (id === null) return defaultLabel
  return models?.models.find((m) => m.id === id)?.label ?? id
}

/** Whether `value` is a model name by the served pattern (matched whole); false until the list is loaded. */
export function isModelName(value: string, models: AiModels | null): boolean {
  if (!models) return false
  try {
    return new RegExp(`^(?:${models.pattern})$`).test(value)
  } catch {
    return false
  }
}
