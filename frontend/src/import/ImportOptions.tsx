// M25: the review step's extra options. "Keep originals as" (design section 2) shows for a Files
// source, the only one with originals; "Try on a copy of this space" shows when the target is this
// space and imports into a copy under a new name (design section 7). M30: "Keep pages as Sources"
// shows for every source kind and target, checked by default (the dialog holds the value).
import { useId } from 'react'
import type { ImportKeepOriginals, ImportSourceKind } from '@/api/types'
import type { ImportTargetKind } from './mapping'
import { IMPORT_TEXT as T } from './text'

const inputClass =
  'h-9 rounded-md border border-line bg-transparent px-2 text-[14px] font-normal outline-none focus:border-fg-muted'

export function ImportOptions({
  kind,
  target,
  keepAsSources,
  onKeepAsSources,
  keepOriginals,
  onKeepOriginals,
  tryCopy,
  onTryCopy,
  copyName,
  onCopyName,
}: {
  kind: ImportSourceKind
  target: ImportTargetKind
  keepAsSources: boolean
  onKeepAsSources(next: boolean): void
  keepOriginals: ImportKeepOriginals
  onKeepOriginals(next: ImportKeepOriginals): void
  tryCopy: boolean
  onTryCopy(next: boolean): void
  copyName: string
  onCopyName(next: string): void
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            checked={keepAsSources}
            aria-describedby={`${id}-sources`}
            onChange={(e) => onKeepAsSources(e.target.checked)}
          />
          {T.keepAsSources}
        </label>
        <p id={`${id}-sources`} className="ml-6 text-[12px] text-fg-muted">
          {T.keepAsSourcesHelp}
        </p>
      </div>
      {kind === 'files' && (
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          {T.keepOriginals}
          <select
            value={keepOriginals}
            onChange={(e) => onKeepOriginals(e.target.value as ImportKeepOriginals)}
            className="h-9 rounded-md border border-line bg-raised px-2 text-[14px] font-normal"
          >
            <option value="attachments">{T.keepAttachments}</option>
            <option value="fileObjects">{T.keepFileObjects}</option>
          </select>
          <span className="text-[12px] font-normal text-fg-muted">{T.keepOriginalsNote}</span>
        </label>
      )}
      {target === 'currentSpace' && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={tryCopy} onChange={(e) => onTryCopy(e.target.checked)} />
            {T.tryCopy}
          </label>
          <p id={`${id}-note`} className="ml-6 text-[12px] text-fg-muted">
            {T.tryCopyNote}
          </p>
          {tryCopy && (
            <label className="ml-6 flex flex-col gap-1 text-[13px] font-semibold">
              {T.copyName}
              <input
                value={copyName}
                aria-describedby={`${id}-note`}
                onChange={(e) => onCopyName(e.target.value)}
                className={inputClass}
              />
            </label>
          )}
        </div>
      )}
    </div>
  )
}
