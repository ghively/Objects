/**
 * The banner on a template object: "Template", its "Template Name" (the `template:` key),
 * "A template fills in new objects for you.", a "Make default" star and "Manage" (Object Type Settings).
 * M14: "Repeat" opens the template's Repeat dialog (an automation that makes an object from it on
 * a schedule).
 */
import { useEffect, useState } from 'react'
import type { ObjectSummary, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { templateKey } from '@/types/TemplateManager'
import { makeDefaultTemplate } from './UseTemplateMenu'
import { repeatOf, TEMPLATE_REPEAT_TEXT, TemplateRepeatDialog } from '@/automations/TemplateRepeatDialog'
import { useAutomations } from '@/automations/useAutomations'
import type { TypeEditor } from './useTypeEditor'
import { NOTE_LOWER, NOTES_LOWER } from '@/lib/words'

export const TEMPLATE_MARKER_TEXT = {
  label: 'Template',
  namePlaceholder: 'Template Name',
  hint: `A template fills in new ${NOTES_LOWER} for you.`,
  makeDefault: 'Make default',
  isDefault: 'Default',
  defaultTooltip: `Every new ${NOTE_LOWER} of this type starts from this one.`,
  manage: 'Manage',
}

export interface TemplateMarkerProps {
  summary: ObjectSummary
  type: TypeDef | undefined
  editor: TypeEditor
  readOnly?: boolean
  /** Save a new template name (the `template:` key). */
  onRename(name: string): void
  /** "Manage": the type's settings. */
  onManage(): void
}

export function TemplateMarker({ summary, type, editor, readOnly, onRename, onManage }: TemplateMarkerProps) {
  const saved = summary.template ?? ''
  const [name, setName] = useState(saved)
  useEffect(() => setName(saved), [saved])
  const key = templateKey(summary)
  const isDefault = !!type && type.templates?.defaultTemplateId === key
  const { rules } = useAutomations()
  const repeats = !!repeatOf(rules, summary.id)
  const [repeatOpen, setRepeatOpen] = useState(false)

  const commit = () => {
    const next = name.trim()
    if (next && next !== saved) onRename(next)
    else setName(saved)
  }

  return (
    <div
      role="region"
      aria-label={TEMPLATE_MARKER_TEXT.label}
      className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-[14px]"
    >
      <span className="flex items-center gap-1.5 font-semibold">
        <Icon name="ph-file-dashed" size={15} />
        {TEMPLATE_MARKER_TEXT.label}
      </span>
      <input
        aria-label={TEMPLATE_MARKER_TEXT.namePlaceholder}
        placeholder={TEMPLATE_MARKER_TEXT.namePlaceholder}
        value={name}
        disabled={readOnly}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setName(saved)
            e.currentTarget.blur()
          }
        }}
        className="h-7 min-w-[140px] flex-1 rounded-md border border-line bg-transparent px-2 outline-none"
      />
      <span className="text-fg-muted">{TEMPLATE_MARKER_TEXT.hint}</span>
      <button
        type="button"
        aria-label={TEMPLATE_MARKER_TEXT.makeDefault}
        aria-pressed={isDefault}
        title={isDefault ? TEMPLATE_MARKER_TEXT.defaultTooltip : TEMPLATE_MARKER_TEXT.makeDefault}
        disabled={readOnly || !type || isDefault}
        onClick={() => type && void makeDefaultTemplate(editor, type.id, key)}
        className={cn(
          'flex h-7 items-center gap-1 rounded-md px-2 hover:bg-hover disabled:hover:bg-transparent',
          isDefault ? 'text-amber-400' : 'text-fg-muted',
        )}
      >
        <Icon name={isDefault ? 'ph-star-fill' : 'ph-star'} size={14} />
        {isDefault && TEMPLATE_MARKER_TEXT.isDefault}
      </button>
      {type && (
        <button
          type="button"
          aria-pressed={repeats}
          disabled={readOnly}
          onClick={() => setRepeatOpen(true)}
          className={cn(
            'flex h-7 items-center gap-1 rounded-md px-2 hover:bg-hover disabled:hover:bg-transparent',
            repeats ? 'text-fg' : 'text-fg-muted',
          )}
        >
          <Icon name="ph-repeat" size={14} />
          {repeats ? TEMPLATE_REPEAT_TEXT.repeating : TEMPLATE_REPEAT_TEXT.menu}
        </button>
      )}
      <button type="button" onClick={onManage} className="h-7 rounded-md px-2 text-fg-muted hover:bg-hover hover:text-fg">
        {TEMPLATE_MARKER_TEXT.manage}
      </button>
      {type && repeatOpen && (
        <TemplateRepeatDialog open typeId={type.id} template={summary} onOpenChange={setRepeatOpen} />
      )}
    </div>
  )
}
