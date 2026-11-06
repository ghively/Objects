// M23 Task 8: one wrapper for every inline step action. The row vanishes at once, the call runs
// (through the item panel's `ObjectWrites.work` when one is given, else straight to the API), and
// on failure the row comes back with the error's text as a toast and the board reloads. Done,
// an answer, Decline and Approve then offer a 5-second Undo, which reopens the step at its new rev.
import { api, StepChangedError } from '@/api/client'
import type { StepAction, WorkStep, WorkWriteResult } from '@/api/types'
import { useTabs } from '@/nav/tabs'
import { WORK_TEXT } from '../workText'
import { settleHidden, useWorkData } from './useWorkData'
import { undoToast, workToast } from './workToasts'

export { UNDO_MS, undoToast, workToast } from './workToasts'

/** The two-press Approve re-arms after this long (our call 18: 4 s). */
export const APPROVE_ARM_MS = 4000

/**
 * Runs a work call for an item. M22's `ObjectWrites.work` takes `run: (path, baseVersion) => …`;
 * a step call ignores `baseVersion`, so a header runner is `(call) => work((p) => call(p))`.
 * `null`: the runner didn't run it (nothing was written).
 */
export type WorkRunner = (call: (path: string) => Promise<WorkWriteResult>) => Promise<WorkWriteResult | null>

/** Straight to the API, for an item with no open page in the item panel. */
export function directRunner(path: string): WorkRunner {
  return (call) => call(path)
}

/** The row key a step's action hides. */
export const stepKey = (path: string, stepId: string) => `${path}#${stepId}`

const UNDO_LABELS: Partial<Record<StepAction, string>> = {
  answer: WORK_TEXT.undoDone,
  done: WORK_TEXT.undoDone,
  decline: WORK_TEXT.undoDeclined,
  approve: WORK_TEXT.undoApproved,
}

function problemText(e: unknown): string {
  if (e instanceof StepChangedError) return e.message || WORK_TEXT.stepChanged
  if (e instanceof Error && e.message) return e.message
  return String(e)
}

/** Act on `step` of `item`; true when the server took it. */
export async function stepAction(o: {
  item: { path: string }
  step: WorkStep
  action: StepAction
  text?: string
  notBefore?: string
  run?: WorkRunner
}): Promise<boolean> {
  const { item, step, action, text, notBefore } = o
  const run = o.run ?? directRunner(item.path)
  const key = stepKey(item.path, step.id)
  const data = useWorkData.getState()
  data.hide(key)
  let res: WorkWriteResult | null
  try {
    res = await run((path) =>
      api.workStep({
        path,
        stepId: step.id,
        stepRev: step.rev,
        action,
        ...(text !== undefined ? { text } : {}),
        ...(notBefore !== undefined ? { notBefore } : {}),
      }),
    )
  } catch (e) {
    useWorkData.getState().unhide(key)
    workToast(problemText(e))
    void useWorkData.getState().load(['board'])
    return false
  }
  if (!res) {
    useWorkData.getState().unhide(key)
    return false
  }
  settleHidden(key)
  const label = UNDO_LABELS[action]
  if (label) {
    const rev = res.item.steps.find((s) => s.id === step.id)?.rev ?? step.rev
    undoToast(label, async () => {
      try {
        return await run((path) => api.workStep({ path, stepId: step.id, stepRev: rev, action: 'reopen' }))
      } catch (e) {
        void useWorkData.getState().load(['board'])
        throw e
      } finally {
        useWorkData.getState().unhide(key)
      }
    })
  }
  return true
}

/** The item panel: the object page in the side panel with the work header. */
export function openItemPanel(path: string): void {
  useTabs.getState().openInSidepanel({ kind: 'object', path, work: true })
}
