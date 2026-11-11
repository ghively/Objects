// M22: the "Work" section of type settings (plan `2026-11-05-m22-work-model.md`, Contract
// "Editors"): "Add work fields" puts the ticket fields, steps, lists and floor items on the type
// (`POST /api/types/{id}/work-fields`), so its notes show up on the Work page. M32: type settings
// show the section only while the Work page is on for the space. Disabled for a type that is
// already a work type (it has a `steps` property of kind `steps`) and, with the M2 basic-type text,
// for the basic types. Afterwards a line lists the fields that were skipped (a property with that
// key or name exists).
import { useState } from 'react'
import { api } from '@/api/client'
import type { AddWorkFieldsResult, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { WORK } from '@/lib/words'
import { BASIC_TYPE_INFO } from '@/properties/AddPropertyMenu'

export const WORK_FIELDS_TEXT = {
  heading: WORK, // our string
  add: 'Add work fields', // our label
  explanation: 'Adds ticket fields, steps, lists and floor items, so notes of this type show up on the Work page.', // our string
  already: 'Notes of this type are already work items.', // our string
  skipped: 'Skipped:', // our string
} as const

const T = WORK_FIELDS_TEXT

/** A work type has a property with key `steps` of kind `steps` (`workfields.is_work_type`). */
export function isWorkType(t: TypeDef | null | undefined): boolean {
  return !!t?.propertyDefinitions.some((d) => d.key === 'steps' && d.type === 'steps')
}

export interface WorkFieldsSectionProps {
  type: TypeDef
  /** The type the server saved with the work fields. */
  onSaved?(type: TypeDef): void
}

export function WorkFieldsSection({ type, onSaved }: WorkFieldsSectionProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<AddWorkFieldsResult['skipped'] | null>(null)
  const work = isWorkType(type)
  const reason = work ? T.already : type.basic ? BASIC_TYPE_INFO : null

  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.addWorkFields(type.id, type.revision ?? '')
      setSkipped(res.skipped ?? [])
      if (res.type) onSaved?.(res.type)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[14px] text-fg-muted">{T.explanation}</p>
      <div>
        <button
          type="button"
          disabled={!!reason || busy || !!type.readOnlyReason}
          onClick={() => void add()}
          className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-line bg-raised px-3 text-[14px] font-medium text-fg hover:bg-hover disabled:opacity-60"
        >
          <Icon name="ph-briefcase" size={14} />
          {T.add}
        </button>
      </div>
      {reason && <p className="text-[13px] text-fg-muted">{reason}</p>}
      {skipped && skipped.length > 0 && (
        <p className="text-[13px] text-fg-muted">
          {T.skipped}{' '}
          {skipped.map((s, i) => (
            <span key={s.key}>
              {i > 0 && '; '}
              {`${s.name}: ${s.reason}`}
            </span>
          ))}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  )
}
