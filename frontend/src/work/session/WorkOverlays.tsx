// M23 Task 15: the focus session and Make it smaller, one at a time, from `useWorkOverlay`.
// Mounted once by App.
import { useEffect, useState, type JSX } from 'react'
import { api } from '@/api/client'
import type { WorkItem } from '@/api/types'
import { useWorkData } from '../state/useWorkData'
import { useWorkOverlay } from '../state/useWorkOverlay'
import { FocusSession, type OverlayItem } from './FocusSession'
import { MakeSmallerDialog } from './MakeSmallerDialog'

/** The item at `path`: from the loaded board (active, else all), else fetched once with `api.workItem`. */
function useOverlayItem(path: string | null): OverlayItem | null {
  const fromBoard = useWorkData((s) =>
    path === null
      ? null
      : (s.board?.items.find((i) => i.path === path) ?? s.all?.items.find((i) => i.path === path) ?? null),
  )
  const [fetched, setFetched] = useState<WorkItem | null>(null)
  useEffect(() => {
    if (path === null || fromBoard) return
    let live = true
    api
      .workItem(path)
      .then((i) => {
        if (live && i) setFetched(i)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [path, fromBoard])
  return fromBoard ?? (path !== null && fetched?.path === path ? fetched : null)
}

/** The focus session and Make it smaller, from `useWorkOverlay`; mounted once by App. */
export function WorkOverlays(): JSX.Element {
  const session = useWorkOverlay((s) => s.session)
  const smaller = useWorkOverlay((s) => s.smaller)
  const item = useOverlayItem(session?.path ?? smaller?.path ?? null)
  return (
    <>
      {session ? <FocusSession key={session.path} item={item} /> : null}
      {smaller ? <MakeSmallerDialog key={`${smaller.path}#${smaller.stepId}`} item={item} stepId={smaller.stepId} /> : null}
    </>
  )
}
