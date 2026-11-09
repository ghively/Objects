// M22 `steps`: in the panel the step list editor (`work/StepList.tsx`), whose writes run through
// `CellExtras.onWorkWrite` (`api.workSteps` for adds, edits, moves and removes; `api.workStep` for
// the actions); in a table "Step {n} of {N} · {current text}", "{N} steps" when no step is current,
// or "—". Without `onWorkWrite` (a table, a card) the list is read-only: steps change only through
// the work service. After a write the cell shows the steps the result hands back; a step that
// changed meanwhile (`StepChangedError`, shown by the writer) reloads the item's steps.
import { useEffect, useState } from 'react'
import { api, StepChangedError } from '@/api/client'
import type { StepAction, StepOp, StepValue, WorkWriteResult } from '@/api/types'
import { currentIndex } from '@/work/stepRules'
import { StepList, type StepActionExtra } from '@/work/StepList'
import type { CellExtras } from '../cellFor'
import type { CellProps } from './types'

const STATES = new Set(['open', 'approved', 'done', 'declined'])

/**
 * The steps as the list can show them. Until the decoded steps arrive the panel gets the raw front
 * matter, where a step typed into the file by hand may have no `state` or `id`; read them the way
 * the server does (open, `@n` by position) so the list renders instead of throwing.
 */
function asShown(value: StepValue[] | null | undefined): StepValue[] {
  if (!Array.isArray(value)) return []
  return value.map((s, i) => {
    if (!s || typeof s !== 'object') return s
    const state = STATES.has(s.state) ? s.state : 'open'
    const id = typeof s.id === 'string' && s.id ? s.id : `@${i + 1}`
    return state === s.state && id === s.id ? s : { ...s, state, id }
  })
}

/** The table form of a step list ('' when it has none). */
export function stepsSummary(steps: readonly StepValue[]): string {
  if (steps.length === 0) return ''
  const i = currentIndex(steps)
  if (i === null) return `${steps.length} steps`
  return `Step ${i + 1} of ${steps.length} · ${steps[i].text}`
}

/** The steps under `key` in a work write's result (the item's decoded field, else its steps). */
export function stepsFromResult(res: WorkWriteResult, key: string): StepValue[] | null {
  const field = res.item?.fields?.[key]
  if (Array.isArray(field)) return field as StepValue[]
  return Array.isArray(res.item?.steps) ? res.item.steps : null
}

export function StepsCell({ def, value, readOnly, density, inTable, path, onWorkWrite }: CellProps<StepValue[] | null> & CellExtras) {
  const [shown, setShown] = useState<StepValue[]>(() => asShown(value))
  useEffect(() => setShown(asShown(value)), [value])

  if (density === 'table' || inTable) {
    const text = stepsSummary(shown)
    return <p className={`truncate py-0.5 text-[15px] ${text ? 'text-fg' : 'text-fg-muted'}`}>{text || (inTable ? '' : '—')}</p>
  }

  const canWrite = !readOnly && !!onWorkWrite

  /** Run one work write; adopt its steps, or reload them when the step changed meanwhile. */
  const write = async (run: (p: string) => Promise<WorkWriteResult>): Promise<boolean> => {
    if (!onWorkWrite) return false
    let changed = false
    const res = await onWorkWrite(async (p) => {
      try {
        return await run(p)
      } catch (e) {
        if (e instanceof StepChangedError) changed = true
        throw e
      }
    })
    if (res) {
      const next = stepsFromResult(res, def.key)
      if (next) setShown(next)
      return true
    }
    if (changed && path) {
      try {
        const item = await api.workItem(path)
        const field = item.fields?.[def.key]
        setShown(Array.isArray(field) ? (field as StepValue[]) : item.steps)
      } catch {
        // the row stays as it was
      }
    }
    return false
  }

  const onOps = (ops: StepOp[]) => write((p) => api.workSteps(p, ops))
  const onAction = (stepId: string, stepRev: string, action: StepAction, extra?: StepActionExtra) =>
    write((p) =>
      api.workStep({ path: p, stepId, stepRev, action, text: extra?.text ?? null, notBefore: extra?.notBefore ?? null }),
    )

  return <StepList steps={shown} readOnly={!canWrite} onOps={onOps} onAction={onAction} />
}
