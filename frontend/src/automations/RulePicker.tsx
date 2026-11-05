// The "Automation" picker of a button block and a Button property (M14): the space's button
// rules by name, the chosen one checked, and "New automation…" (the rule editor with a button
// trigger). Every string here is ours.
import type { AutomationRule } from '@/api/types'
import { Icon } from '@/components/Icon'
import { buttonRules } from './useAutomations'

export const RULE_PICKER_TEXT = {
  label: 'Automation', // our string
  none: 'No button automations yet', // our string
  create: 'New automation…', // our string
  off: 'Off', // our string
} as const

export interface RulePickerProps {
  rules: readonly AutomationRule[]
  value: string | null
  onChange(ruleId: string): void
  /** "New automation…"; left out, the item isn't shown. */
  onNew?(): void
}

export function RulePicker({ rules, value, onChange, onNew }: RulePickerProps) {
  const list = buttonRules(rules)
  return (
    <div role="menu" aria-label={RULE_PICKER_TEXT.label} className="flex flex-col text-[14px]">
      {list.length === 0 && <p className="px-2 py-1 text-[13px] text-fg-muted">{RULE_PICKER_TEXT.none}</p>}
      {list.map((r) => (
        <button
          key={r.id}
          type="button"
          role="menuitemradio"
          aria-checked={r.id === value}
          disabled={!!r.readOnlyReason}
          onClick={() => onChange(r.id)}
          className="flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-hover disabled:opacity-50"
        >
          <Icon name="ph-lightning" size={14} />
          <span className="min-w-0 flex-1 truncate">{r.name}</span>
          {!r.enabled && <span className="text-[12px] text-fg-muted">{RULE_PICKER_TEXT.off}</span>}
          {r.id === value && <Icon name="ph-check" size={14} />}
        </button>
      ))}
      {onNew && (
        <button
          type="button"
          role="menuitem"
          onClick={onNew}
          className="flex items-center gap-2 rounded px-2 py-1 text-left text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="ph-plus" size={14} />
          {RULE_PICKER_TEXT.create}
        </button>
      )}
    </div>
  )
}
