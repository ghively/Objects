// A template's "Repeat" (M14, contract "Template Repeat"): make an object from this template on a
// schedule. The repeat is an ordinary rule (a schedule, one "Create an object" action from this
// template, `templateRepeat` naming it), kept only in its rule file: the template and its type are
// never written. "Remove repeat" moves the rule to the trash. Every string here is ours.
import { useEffect, useState } from 'react'
import { api, ConflictError } from '@/api/client'
import type { AutomationRule, ObjectSummary, ScheduleTrigger } from '@/api/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { zonedToday } from '@/lib/zonedTime'
import { ScheduleFields } from './RuleEditor'
import { cleanRule, emptyConditions, ruleInputOf, ruleProblem, RULE_TEXT, triggerOfKind, type RuleFields } from './ruleModel'
import { reloadAutomations, useAutomations } from './useAutomations'

export const TEMPLATE_REPEAT_TEXT = {
  menu: 'Repeat',
  repeating: 'Repeats',
  title: 'Repeat template',
  description: 'Create a new note from this template on a schedule.',
  turnedOn: 'Turned on',
  remove: 'Remove repeat',
  cancel: 'Cancel',
  save: 'Save',
  conflict: 'This repeat was changed elsewhere. Save again to keep your version.',
} as const

const T = TEMPLATE_REPEAT_TEXT

/** The name a template shows (its `template:` name, else its title). */
export const templateDisplayName = (t: Pick<ObjectSummary, 'template' | 'title'>): string => t.template || t.title

/** The repeat rule of the template with frontmatter id `templateId`, if any. */
export function repeatOf(rules: readonly AutomationRule[], templateId: string | null | undefined): AutomationRule | undefined {
  if (!templateId) return undefined
  return rules.find((r) => r.templateRepeat?.templateId === templateId)
}

/** A new repeat rule for template `templateId` of type `typeId`. */
export function templateRepeatInput(typeId: string, templateId: string, name: string, trigger: ScheduleTrigger): RuleFields {
  return {
    name: RULE_TEXT.repeatName(name).slice(0, 100),
    description: '',
    enabled: true,
    trigger,
    conditions: emptyConditions(),
    actions: [{ kind: 'createFromTemplate', typeId, templateId, title: '', relateVia: null }],
    templateRepeat: { typeId, templateId },
  }
}

export interface TemplateRepeatDialogProps {
  open: boolean
  typeId: string
  template: ObjectSummary
  onOpenChange(open: boolean): void
}

export function TemplateRepeatDialog({ open, typeId, template, onOpenChange }: TemplateRepeatDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(480px,calc(100vw-32px))] border-line bg-raised-2 text-fg"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {open && <Body typeId={typeId} template={template} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function Body({ typeId, template, onClose }: { typeId: string; template: ObjectSummary; onClose(): void }) {
  const { rules } = useAutomations()
  const [existing, setExisting] = useState<AutomationRule | undefined>(() => repeatOf(rules, template.id))
  const [trigger, setTrigger] = useState<ScheduleTrigger>(() =>
    existing?.trigger.kind === 'schedule'
      ? existing.trigger
      : (triggerOfKind('schedule', { kind: 'button', scope: null }, null, zonedToday()) as ScheduleTrigger),
  )
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The rules may arrive after the dialog opened: adopt the template's repeat once they do.
  useEffect(() => {
    if (existing) return
    const found = repeatOf(rules, template.id)
    if (!found) return
    setExisting(found)
    if (found.trigger.kind === 'schedule') setTrigger(found.trigger)
    setEnabled(found.enabled)
  }, [rules, template.id, existing])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      if (existing) {
        const next = cleanRule({ ...ruleInputOf(existing), trigger, enabled })
        const problem = ruleProblem(next)
        if (problem) return setError(problem)
        await api.saveAutomation({ ...existing, ...next }, { baseRevision: existing.revision })
      } else {
        const templateId = template.id ?? (await api.ensureId(template.path)).id
        const input = { ...templateRepeatInput(typeId, templateId, templateDisplayName(template), trigger), enabled }
        const problem = ruleProblem(input)
        if (problem) return setError(problem)
        await api.createAutomation(input)
      }
      void reloadAutomations()
      onClose()
    } catch (e) {
      if (e instanceof ConflictError && existing) {
        try {
          setExisting(await api.automation(existing.id))
        } catch {
          // keep the old revision
        }
        setError(T.conflict)
      } else setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    setBusy(true)
    try {
      await api.deleteAutomation(existing.id)
      void reloadAutomations()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <DialogTitle className="text-[17px] font-semibold">{T.title}</DialogTitle>
        <DialogDescription className="text-[13px] text-fg-muted">
          {T.description} {RULE_TEXT.repeatsTemplate(templateDisplayName(template))}
        </DialogDescription>
      </div>
      <ScheduleFields trigger={trigger} onChange={(t) => t.kind === 'schedule' && setTrigger(t)} />
      {error && (
        <p role="alert" className="text-[13px] text-[var(--danger)]">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 pt-1">
        <label className="flex items-center gap-2 text-[14px]">
          <Switch aria-label={T.turnedOn} checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
          {T.turnedOn}
        </label>
        <span className="flex-1" />
        {existing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="h-8 rounded-md px-3 text-[14px] text-[var(--danger)] hover:bg-hover disabled:opacity-50"
          >
            {T.remove}
          </button>
        )}
        <button type="button" onClick={onClose} className="h-8 rounded-md px-3 text-[14px] hover:bg-hover">
          {T.cancel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="h-8 rounded-md bg-primary-btn px-3 text-[14px] font-medium text-app hover:opacity-90 disabled:opacity-50"
        >
          {T.save}
        </button>
      </div>
    </div>
  )
}
