// A view's state with optimistic updates and debounced saves. On a 409 the caller's `refetch`
// supplies the fresh stored state, the pending patches are re-applied to it once, and the save
// is tried again.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ConflictError } from '@/api/client'
import type { ViewState } from '@/api/types'

const SAVE_DELAY_MS = 400

export type ViewPatch = Partial<ViewState> | ((s: ViewState) => ViewState)

const apply = (s: ViewState, p: ViewPatch): ViewState => (typeof p === 'function' ? p(s) : { ...s, ...p })

export function useViewState<S extends ViewState = ViewState>(
  initial: S,
  save: (next: S) => Promise<void>,
  refetch?: () => Promise<S>,
): [S, (patch: ViewPatch) => void] {
  const [state, setState] = useState<S>(initial)
  const stateRef = useRef(state)
  const pending = useRef<ViewPatch[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef(save)
  const refetchRef = useRef(refetch)
  saveRef.current = save
  refetchRef.current = refetch

  // A new stored state (another window's save, a reload) replaces ours unless a save is pending.
  const lastInitial = useRef(initial)
  useEffect(() => {
    if (initial === lastInitial.current) return
    lastInitial.current = initial
    if (pending.current.length === 0) {
      stateRef.current = initial
      setState(initial)
    }
  }, [initial])

  const flush = useCallback(async () => {
    timer.current = null
    const patches = pending.current
    pending.current = []
    if (patches.length === 0) return
    try {
      await saveRef.current(stateRef.current)
    } catch (e) {
      if (!(e instanceof ConflictError) || !refetchRef.current) {
        console.warn('Could not save the view:', e)
        return
      }
      try {
        const fresh = await refetchRef.current()
        const next = patches.reduce<S>((s, p) => apply(s, p) as S, fresh)
        stateRef.current = next
        setState(next)
        await saveRef.current(next)
      } catch (e2) {
        console.warn('Could not save the view:', e2)
      }
    }
  }, [])

  const update = useCallback(
    (patch: ViewPatch) => {
      const next = apply(stateRef.current, patch) as S
      stateRef.current = next
      setState(next)
      pending.current.push(patch)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush],
  )

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        void flush()
      }
    },
    [flush],
  )

  return [state, update]
}
