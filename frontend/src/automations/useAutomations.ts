// The space's automation rules (M14), loaded once and kept current from `automations` and
// `automationRuns` change events (a run changes a rule's `lastRun`). Shared by Settings >
// Automations, button blocks, Button property cells and the template "Repeat" option, as
// `types/useDefinitions.ts` shares collections and queries.
import { useEffect } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { api } from '@/api/client'
import type { AutomationRule } from '@/api/types'

interface AutomationsState {
  rules: AutomationRule[]
  loaded: boolean
}

export const useAutomationStore = create<AutomationsState>()(() => ({ rules: [], loaded: false }))

const RELOAD_DELAY_MS = 150
let refs = 0
let off: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0
let releasePending = false

/** Fetch the rules now (after a write of our own, so the list doesn't wait for the event). */
export async function reloadAutomations(): Promise<void> {
  const n = ++seq
  try {
    const rules = await api.automations()
    if (n === seq) useAutomationStore.setState({ rules: rules ?? [], loaded: true })
  } catch (e) {
    console.warn('Could not load automations:', e)
    if (n === seq) useAutomationStore.setState({ loaded: true })
  }
}

function acquire(): void {
  refs += 1
  if (releasePending) {
    releasePending = false
    return
  }
  if (refs > 1) return
  void reloadAutomations()
  off = api.onChange((e) => {
    if (e.kind !== 'automations' && !(e.kind === 'automationRuns' && e.path !== 'catch-up')) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void reloadAutomations()
    }, RELOAD_DELAY_MS)
  })
}

function release(): void {
  refs = Math.max(0, refs - 1)
  if (refs > 0 || releasePending) return
  releasePending = true
  queueMicrotask(teardown)
}

function teardown(): void {
  if (!releasePending) return
  releasePending = false
  if (refs > 0) return
  off?.()
  off = null
  if (timer) clearTimeout(timer)
  timer = null
  seq += 1
  useAutomationStore.setState({ rules: [], loaded: false })
}

/** For tests: forget the rules and every subscription. */
export function resetAutomations(): void {
  off?.()
  off = null
  if (timer) clearTimeout(timer)
  timer = null
  refs = 0
  releasePending = false
  seq += 1
  useAutomationStore.setState({ rules: [], loaded: false })
}

/** The space's rules (the list route's order); `loaded` turns true after the first answer. */
export function useAutomations(): AutomationsState {
  useEffect(() => {
    acquire()
    return release
  }, [])
  return useAutomationStore(useShallow((s) => ({ rules: s.rules, loaded: s.loaded })))
}

/** Button rules: the ones a button block or a Button property can run. */
export function buttonRules(rules: readonly AutomationRule[]): AutomationRule[] {
  return rules.filter((r) => r.trigger.kind === 'button' && !r.templateRepeat)
}

/** Why a button for `ruleId` can't run now (null: it can). Our strings. */
export function buttonBlocker(
  ruleId: string | null,
  rules: readonly AutomationRule[],
  loaded: boolean,
): string | null {
  if (!ruleId) return BUTTON_TEXT.noRule
  if (!loaded) return null
  const rule = rules.find((r) => r.id === ruleId)
  if (!rule) return BUTTON_TEXT.notFound
  if (rule.readOnlyReason) return rule.readOnlyReason
  if (!rule.enabled) return BUTTON_TEXT.off
  return null
}

export const BUTTON_TEXT = {
  noRule: "Choose an automation in the property's settings", // our string
  noRuleBlock: 'Choose an automation', // our string
  notFound: 'Automation not found', // our string
  off: 'This automation is turned off.', // our string
  inTemplate: 'Buttons run in objects made from this template.', // our string
  done: 'Done', // our string
  failed: 'The automation failed.', // our string
} as const

/** The message for a finished button run: "Done", or the run's failure. */
export function runMessage(run: { status: string; error: string | null; actions: { status: string; detail: string | null }[] }): string {
  if (run.status === 'ok') return BUTTON_TEXT.done
  if (run.error) return run.error
  const failed = run.actions.find((a) => a.status !== 'ok' && a.detail)
  if (failed?.detail) return failed.detail
  if (run.status === 'skipped') return "This object doesn't meet the automation's conditions." // our string
  return BUTTON_TEXT.failed
}
