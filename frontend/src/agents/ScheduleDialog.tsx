// M21: the schedule dialog (spec section 9), "New schedule" / "Edit schedule": the schedule's
// Name, Prompt, When (M14's `ScheduleFields`: repeat by due date, time, start date) and Model
// (M16's picker; null = the agent's default), with "Turned on", "Cancel" and "Save". It saves an
// M14 rule with one `runAgent` action through M14's routes. An edit keeps the loaded rule's other
// keys (unknown ones and `description`). A 422 shows its message above the footer; a 409 reloads
// the rule's revision and asks to save again. Every string here is ours.
import { useState } from 'react'
import { api, ConflictError } from '@/api/client'
import type { Agent, AutomationRule, ScheduleTrigger } from '@/api/types'
import { ModelPicker } from '@/ai/ModelPicker'
import { modelLabel, useAiModels } from '@/ai/models'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { ScheduleFields } from '@/automations/RuleEditor'
import { agentScheduleInput, cleanRule, RULE_TEXT, ruleInputOf, ruleProblem, triggerOfKind } from '@/automations/ruleModel'
import { reloadAutomations } from '@/automations/useAutomations'
import { cn } from '@/lib/utils'
import { zonedToday } from '@/lib/zonedTime'
import { SCHEDULE_TEXT as T, scheduleFieldsOf, type ScheduleFieldValues } from './scheduleModel'

const FIELD =
  'rounded-md border border-line bg-raised px-2 text-[14px] text-fg outline-none placeholder:text-fg-muted focus-visible:ring-1 focus-visible:ring-line'

export interface ScheduleDialogProps {
  open: boolean
  agent: Agent
  /** The schedule to edit; null makes a new one. */
  rule: AutomationRule | null
  onOpenChange(o: boolean): void
}

export function ScheduleDialog({ open, agent, rule, onOpenChange }: ScheduleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[min(860px,calc(100vh-48px))] w-[min(640px,calc(100vw-32px))] max-w-none flex-col gap-0 border-line bg-raised-2 p-0 text-fg sm:max-w-none"
      >
        {open && <ScheduleBody agent={agent} rule={rule} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function newFields(): ScheduleFieldValues {
  const trigger = triggerOfKind('schedule', { kind: 'button', scope: null }, null, zonedToday()) as ScheduleTrigger
  return { name: '', prompt: '', trigger, model: null, enabled: true }
}

function ScheduleBody({ agent, rule, onClose }: { agent: Agent; rule: AutomationRule | null; onClose(): void }) {
  const models = useAiModels()
  const [base, setBase] = useState<AutomationRule | null>(rule)
  const [draft, setDraft] = useState<ScheduleFieldValues>(() => (rule ? scheduleFieldsOf(rule) : newFields()))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const blocked = agent.readOnlyReason

  const set = (patch: Partial<ScheduleFieldValues>) => {
    setError(null)
    setDraft((d) => ({ ...d, ...patch }))
  }

  const save = async () => {
    const prompt = draft.prompt.trim()
    const fields = cleanRule(agentScheduleInput(agent.id, draft.name, prompt, draft.trigger, draft.model, draft.enabled))
    const problem = !fields.name ? RULE_TEXT.needName : !prompt ? T.needPrompt : ruleProblem(fields)
    if (problem) return setError(problem)
    setSaving(true)
    try {
      if (base) {
        const old = ruleInputOf(base)
        const oldAction = base.actions[0]?.kind === 'runAgent' ? base.actions[0] : null
        await api.saveAutomation(
          {
            ...base,
            ...old,
            name: fields.name,
            enabled: fields.enabled,
            trigger: fields.trigger,
            actions: [{ ...(oldAction ?? {}), kind: 'runAgent', agentId: oldAction?.agentId ?? agent.id, prompt, model: draft.model }],
          },
          { baseRevision: base.revision },
        )
      } else await api.createAutomation(fields)
      void reloadAutomations()
      onClose()
    } catch (e) {
      if (e instanceof ConflictError && base) {
        try {
          setBase(await api.automation(base.id))
        } catch {
          // Keep the old revision: the next save answers 409 (or 404) again.
        }
        setError(T.conflict)
      } else setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const agentModel = agent.model ? modelLabel(agent.model, models, agent.model) : T.cliDefault

  return (
    <>
      <div className="border-b border-line px-6 pt-5 pb-4">
        <DialogTitle className="text-[18px] font-semibold">{base ? T.editTitle : T.newTitle}</DialogTitle>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-4 text-[13px]">
        <label className="flex flex-col gap-2">
          <span className="text-[14px] font-semibold">{T.name}</span>
          <input
            aria-label={T.name}
            value={draft.name}
            maxLength={100}
            required
            onChange={(e) => set({ name: e.target.value })}
            className={cn(FIELD, 'h-8 w-full')}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-[14px] font-semibold">{T.prompt}</span>
          <textarea
            aria-label={T.prompt}
            value={draft.prompt}
            rows={5}
            placeholder={T.promptPlaceholder(agent.name)}
            onChange={(e) => set({ prompt: e.target.value })}
            className={cn(FIELD, 'w-full py-1.5')}
          />
        </label>
        <section aria-label={T.when} className="flex flex-col gap-2">
          <h3 className="text-[14px] font-semibold">{T.when}</h3>
          <ScheduleFields trigger={draft.trigger} onChange={(t) => t.kind === 'schedule' && set({ trigger: t })} />
        </section>
        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-semibold">{T.model}</span>
          <ModelPicker value={draft.model} onChange={(model) => set({ model })} defaultLabel={T.defaultModel(agentModel)} ariaLabel={T.model} />
        </div>
      </div>
      <div className="border-t border-line px-6 py-3">
        {(error || blocked) && (
          <p role="alert" className="pb-2 text-[13px] text-[var(--danger)]">
            {error ?? blocked}
          </p>
        )}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[14px]">
            <Switch aria-label={T.turnedOn} checked={draft.enabled} onCheckedChange={(v) => set({ enabled: v === true })} />
            {T.turnedOn}
          </label>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="h-8 rounded-md px-3 text-[14px] hover:bg-hover">
            {T.cancel}
          </button>
          <button
            type="button"
            disabled={saving || !!blocked || agent.missing}
            onClick={() => void save()}
            className="h-8 rounded-md bg-primary-btn px-3 text-[14px] font-medium text-app hover:opacity-90 disabled:opacity-50"
          >
            {saving ? T.saving : T.save}
          </button>
        </div>
      </div>
    </>
  )
}
