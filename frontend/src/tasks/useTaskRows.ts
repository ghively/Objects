// The Tasks dashboard's Task rows, loaded once for the page (Gene's redesign, phase 2): every list
// view (`TaskSectionPanel`) and the switcher's counts read the same rows, so the page fetches them
// once and patches them in one place. `useTaskRowsFeed()` (mounted by the dashboard) keeps the
// store filled from `useRows`; readers subscribe with `useTaskRows`.
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type { Row, TypeDef } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import { useRows } from '@/views/useRows'

export interface TaskRowsState {
  rows: Row[]
  loading: boolean
  taskType: TypeDef | undefined
  patchRow(path: string, row: Row): void
}

const noop = () => undefined

export const useTaskRows = create<TaskRowsState>()(() => ({
  rows: [],
  loading: true,
  taskType: undefined,
  patchRow: noop,
}))

/** The basic Task type among `types` (by flag and name, as the server infers it). */
export function findTaskType(types: TypeDef[]): TypeDef | undefined {
  return types.find((t) => t.basic && t.name.toLowerCase() === 'task') ?? types.find((t) => t.id === 'task')
}

/** Load the Task rows and keep the store current (mount once per page). */
export function useTaskRowsFeed(): void {
  const types = useLinkIndex((s) => s.types)
  const taskType = useMemo(() => findTaskType(types), [types])
  const scope = useMemo(() => ({ typeIds: [taskType?.id ?? 'task'] }), [taskType])
  // The rows' backlinks feed the Context grouping: keep them current (fix pass H, M5#5).
  const { rows, loading, patchRow } = useRows(scope, { backlinks: true })
  useEffect(() => {
    useTaskRows.setState({ rows, loading, taskType, patchRow })
  }, [rows, loading, taskType, patchRow])
  useEffect(
    () => () => useTaskRows.setState({ rows: [], loading: true, taskType: undefined, patchRow: noop }),
    [],
  )
}

/** Tests: an empty store. */
export function resetTaskRows(): void {
  useTaskRows.setState({ rows: [], loading: true, taskType: undefined, patchRow: noop })
}
