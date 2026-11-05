// M14: a Button property's own setting in "Property settings": the automation it runs
// (`options.ruleId`), picked from the space's button rules, or "New automation…" (the rule editor
// with a button trigger scoped to this type). Our strings.
import { useState } from 'react'
import type { PropertyDef, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RuleEditorDialog } from '@/automations/RuleEditor'
import { RULE_PICKER_TEXT, RulePicker } from '@/automations/RulePicker'
import { BUTTON_TEXT, reloadAutomations, useAutomations } from '@/automations/useAutomations'

export const BUTTON_SETTINGS_TEXT = {
  title: RULE_PICKER_TEXT.label,
  description: 'The automation the button runs on its object.',
  choose: 'Choose an automation',
} as const

/** `def` with the button running `ruleId`. */
export function withRule(def: PropertyDef, ruleId: string | null): PropertyDef {
  return { ...def, options: { ...def.options, ruleId } }
}

export function ButtonSettingsSection({ type, def, save }: { type: TypeDef; def: PropertyDef; save(next: PropertyDef): void }) {
  const { rules, loaded } = useAutomations()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const ruleId = (def.options?.ruleId as string | null | undefined) ?? null
  const rule = ruleId ? rules.find((r) => r.id === ruleId) : undefined
  const current = rule ? rule.name : ruleId && loaded ? BUTTON_TEXT.notFound : BUTTON_SETTINGS_TEXT.choose
  return (
    <section aria-label={BUTTON_SETTINGS_TEXT.title} className="border-t border-line pt-3">
      <h3 className="text-[14px] font-semibold">{BUTTON_SETTINGS_TEXT.title}</h3>
      <p className="mt-0.5 text-[13px] text-fg-muted">{BUTTON_SETTINGS_TEXT.description}</p>
      <div className="mt-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={BUTTON_SETTINGS_TEXT.title}
              className="flex items-center gap-1.5 rounded border border-line px-2 py-0.5 text-[13px]"
            >
              <Icon name="ph-lightning" size={13} />
              {current}
              <Icon name="ph-caret-down" size={11} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 border-line bg-raised p-1 text-fg">
            <RulePicker
              rules={rules}
              value={ruleId}
              onChange={(id) => {
                setOpen(false)
                if (id !== ruleId) save(withRule(def, id))
              }}
              onNew={() => {
                setOpen(false)
                setCreating(true)
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
      {creating && (
        <RuleEditorDialog
          open
          rule={null}
          initial={{ name: def.name, trigger: { kind: 'button', scope: { kind: 'type', id: type.id } } }}
          onOpenChange={(o) => !o && setCreating(false)}
          onSaved={(saved) => {
            setCreating(false)
            save(withRule(def, saved.id))
            void reloadAutomations()
          }}
        />
      )}
    </section>
  )
}
