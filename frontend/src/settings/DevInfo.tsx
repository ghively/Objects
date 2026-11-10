/**
 * Integrations > Developer settings > "Show developer information" (M31, catalog section 1: "IDs and
 * developer details in the UI"). While the device setting `showDeveloperInfo` is on, the places
 * that show an object, a type, a property, a query or a collection add a small read-only box with
 * its ids, keys and file path, each with a copy button. Off (the default), nothing renders.
 */
import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { useSettings } from './useSettings'

// our strings
export const DEV_INFO_TEXT = {
  heading: 'Developer information',
  none: 'None',
  copy: (label: string) => `Copy ${label}`,
  copied: 'Copied',
  objectId: 'Object id',
  filePath: 'File path',
  typeId: 'Type id',
  folder: 'Folder',
  propertyKey: 'Key',
  propertyId: 'Property id',
  queryId: 'Query id',
  collectionId: 'Collection id',
  view: 'View',
} as const

const T = DEV_INFO_TEXT

export interface DevInfoRow {
  label: string
  /** `null` or empty: shown as "None", with nothing to copy. */
  value: string | null | undefined
}

/** Whether "Show developer information" is on. */
export function useDevInfoShown(): boolean {
  return useSettings((s) => s.settings.showDeveloperInfo === true)
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      aria-label={T.copy(label)}
      title={copied ? T.copied : T.copy(label)}
      onClick={copy}
      className="flex size-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
    >
      <Icon name={copied ? 'ph-check' : 'ph-copy'} size={13} />
    </button>
  )
}

/** The ids and keys box; renders nothing while "Show developer information" is off. */
export function DevInfo({ rows, className }: { rows: DevInfoRow[]; className?: string }) {
  const shown = useDevInfoShown()
  if (!shown || rows.length === 0) return null
  return (
    <section
      aria-label={T.heading}
      data-dev-info=""
      className={cn('rounded-lg border border-dashed border-line px-3 py-2 text-[12px]', className)}
    >
      <h4 className="mb-1 text-[12px] font-semibold text-fg-muted">{T.heading}</h4>
      <dl className="flex flex-col gap-0.5">
        {rows.map((r, i) => (
          <div key={`${r.label}-${i}`} className="flex min-w-0 items-center gap-2">
            <dt className="w-24 shrink-0 truncate text-fg-muted">{r.label}</dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-fg" title={r.value || undefined}>
              {r.value || <span className="font-sans text-fg-muted">{T.none}</span>}
            </dd>
            {r.value ? <CopyValue label={r.label} value={r.value} /> : <span className="size-6 shrink-0" />}
          </div>
        ))}
      </dl>
    </section>
  )
}
