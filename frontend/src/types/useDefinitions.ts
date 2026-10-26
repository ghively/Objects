// The space's collections and queries, loaded once and kept current from `collections` and
// `queries` change events. Shared by type pages and tab labels (Tasks 13 and 14 add richer
// `useCollections` / `useQueries` over the same events).
import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '@/api/client'
import type { Collection, Query } from '@/api/types'

interface DefsState {
  collections: Collection[]
  queries: Query[]
  loaded: boolean
}

export const useDefs = create<DefsState>()(() => ({ collections: [], queries: [], loaded: false }))

const RELOAD_DELAY_MS = 150
let refs = 0
let off: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0

export async function reloadDefinitions(): Promise<void> {
  return reload()
}

async function reload(): Promise<void> {
  const n = ++seq
  try {
    const [collections, queries] = await Promise.all([api.collections(), api.queries()])
    if (n === seq) useDefs.setState({ collections: collections ?? [], queries: queries ?? [], loaded: true })
  } catch (e) {
    console.warn('Could not load collections and queries:', e)
    if (n === seq) useDefs.setState({ loaded: true })
  }
}

function acquire(): void {
  refs += 1
  if (refs > 1) return
  void reload()
  off = api.onChange((e) => {
    if (e.kind !== 'collections' && e.kind !== 'queries') return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void reload()
    }, RELOAD_DELAY_MS)
  })
}

function release(): void {
  refs = Math.max(0, refs - 1)
  if (refs > 0) return
  off?.()
  off = null
  if (timer) clearTimeout(timer)
  timer = null
  seq += 1
  useDefs.setState({ collections: [], queries: [], loaded: false })
}

/** The space's collections and queries; `loaded` turns true after the first answer. */
export function useDefinitions(): DefsState {
  useEffect(() => {
    acquire()
    return release
  }, [])
  return useDefs()
}
