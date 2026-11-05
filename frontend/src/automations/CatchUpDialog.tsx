// "Missed automations" (M14, contract "Catch-up dialog"): the schedule runs missed while Object
// was closed or the computer slept. Nothing missed runs without an answer: each row asks "Create
// the 3 missed “Weekly review”?" (a rule that creates objects) or "Run “Backup” for the 3 missed
// times?", answered by "Run all", "Only the latest" or "Skip". The dialog closes when every row is
// answered; closing it without answering leaves the items pending (it opens again next start).
//
// Mounted once in `shell/GlobalOverlays.tsx`. It asks `GET /api/automations/catch-up` once the
// space has loaded and again on every `automationRuns` event with path `catch-up`. Our strings.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { AutomationCatchUpChoice, AutomationCatchUpItem } from '@/api/types'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { runMessage } from './useAutomations'

export const CATCH_UP_TEXT = {
  title: 'Missed automations',
  description: 'These scheduled automations didn’t run while Object was closed.',
  create: (count: string, name: string) => `Create the ${count} missed “${name}”?`,
  run: (name: string, count: string) => `Run “${name}” for the ${count} missed times?`,
  all: 'Run all',
  latest: 'Only the latest',
  skip: 'Skip',
  later: 'Later',
} as const

const T = CATCH_UP_TEXT

/** The count a row shows: `50+` when the server kept only the newest 50. */
export const catchUpCount = (item: AutomationCatchUpItem): string => (item.capped ? `${item.missed.length}+` : String(item.count))

/** A row's question. */
export function catchUpQuestion(item: AutomationCatchUpItem): string {
  const count = catchUpCount(item)
  return item.createsObjects ? T.create(count, item.name) : T.run(item.name, count)
}

export function CatchUpDialog() {
  const root = useSpaceInfo((s) => s.space?.root ?? null)
  const [items, setItems] = useState<AutomationCatchUpItem[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const n = ++seq.current
    try {
      const next = await api.automationCatchUp()
      if (n !== seq.current) return
      setItems(next)
      if (next.length > 0) setOpen(true)
      else setOpen(false)
    } catch {
      // No answer (an older server, a closed space): nothing to ask.
    }
  }, [])

  useEffect(() => {
    if (!root) return
    void load()
    return api.onChange((e) => {
      if (e.kind === 'automationRuns' && e.path === 'catch-up') void load()
    })
  }, [root, load])

  const answer = async (item: AutomationCatchUpItem, choice: AutomationCatchUpChoice) => {
    setBusy(item.ruleId)
    setError(null)
    try {
      const runs = await api.confirmAutomationCatchUp(item.ruleId, choice)
      const failed = runs.find((r) => r.status !== 'ok')
      if (failed) setError(`${item.name}: ${runMessage(failed)}`)
      const rest = items.filter((i) => i.ruleId !== item.ruleId)
      setItems(rest)
      if (rest.length === 0 && !failed) setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // Nothing pending any more (answered in another window): drop the row.
      setItems((cur) => cur.filter((i) => i.ruleId !== item.ruleId))
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="border-line bg-raised text-fg">
        <AlertDialogHeader>
          <AlertDialogTitle>{T.title}</AlertDialogTitle>
          <AlertDialogDescription>{T.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-2" aria-label={T.title}>
          {items.map((item) => (
            <li key={item.ruleId} aria-label={item.name} className="flex flex-col gap-2 rounded-md border border-line px-3 py-2">
              <span className="text-[14px]">{catchUpQuestion(item)}</span>
              <span className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['all', T.all],
                    ['latest', T.latest],
                    ['skip', T.skip],
                  ] as const
                ).map(([choice, label]) => (
                  <button
                    key={choice}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void answer(item, choice)}
                    className={
                      choice === 'all'
                        ? 'h-7 rounded-md bg-primary-btn px-2.5 text-[13px] font-medium text-app hover:opacity-90 disabled:opacity-50'
                        : 'h-7 rounded-md border border-line px-2.5 text-[13px] hover:bg-hover disabled:opacity-50'
                    }
                  >
                    {label}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-[13px] text-[var(--danger)]">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-md px-3 text-[14px] hover:bg-hover">
            {T.later}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
