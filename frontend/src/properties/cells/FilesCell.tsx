import { useEffect, useRef, useState, type DragEvent } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { fileIconFor } from '@/editor/media/MediaView'
import { invalidateAttachments, MAX_UPLOAD_BYTES, openFilePicker, showToast, UPLOAD_LIMIT_MESSAGE } from '@/editor/media/upload'
import { cn } from '@/lib/utils'
import { fileName, filePaths } from '../files'
import { placeholderFor } from '../format'
import type { CellProps } from './types'

/** Our strings. */
const FILES_TEXT = {
  add: 'Add file',
  remove: 'Remove file',
  moveUp: 'Move up',
  moveDown: 'Move down',
  open: 'Open file',
  drop: 'Drop files to attach',
  uploading: 'Uploading…',
  uploadFailed: "The upload didn't go through.",
  openFailed: 'The file could not be opened.',
}

const ICON_BTN =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted opacity-0 transition-opacity group-hover/file:opacity-100 focus-visible:opacity-100 hover:bg-hover hover:text-fg disabled:opacity-30'


/** Whether a drag carries files from the OS (not text or an in-app drag). */
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

async function openFile(path: string): Promise<void> {
  try {
    await api.openAttachment(path)
  } catch (err) {
    showToast(err instanceof Error && err.message ? err.message : FILES_TEXT.openFailed)
  }
}

/**
 * Upload `files` into `Attachments/` one after another (over 100 MiB refused before sending, as
 * media blocks do) and resolve the new paths; a failure shows a toast and is skipped.
 */
async function uploadAll(files: readonly File[]): Promise<string[]> {
  const out: string[] = []
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast(UPLOAD_LIMIT_MESSAGE)
      continue
    }
    try {
      const res = await api.uploadAttachment(file, file.name)
      out.push(res.path)
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : FILES_TEXT.uploadFailed)
    }
  }
  if (out.length) invalidateAttachments()
  return out
}

/**
 * M12 `files`: attached files (space-relative paths under `Attachments/`), each with its file icon
 * and name; a click opens the file with the OS default app (as a media block's "Open on system").
 * Editable: "Add file" (the system file dialog) or a drop of files from the OS uploads them through
 * the attachments API and appends their paths; each file can be removed or moved up and down.
 * Every change saves the whole list through `onChange`.
 */
export function FilesCell({ def, value, readOnly, density, inTable, onChange }: CellProps<string[] | null>) {
  const paths = filePaths(value)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  // The newest list (an upload resolves after the value may have changed).
  const latest = useRef(paths)
  useEffect(() => {
    latest.current = paths
  })
  const compact = density === 'table'

  const save = (next: string[]) => {
    if (next.length === latest.current.length && next.every((p, i) => p === latest.current[i])) return
    latest.current = next
    onChange(next)
  }

  const addFiles = async (files: readonly File[]) => {
    if (readOnly || !files.length) return
    setBusy(true)
    try {
      const added = await uploadAll(files)
      if (added.length) save([...latest.current, ...added.filter((p) => !latest.current.includes(p))])
    } finally {
      setBusy(false)
    }
  }

  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j < 0 || j >= paths.length) return
    const next = [...paths]
    ;[next[i], next[j]] = [next[j], next[i]]
    save(next)
  }

  const dropProps = readOnly
    ? {}
    : {
        onDragOver: (e: DragEvent<HTMLDivElement>) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setOver(true)
        },
        onDragLeave: (e: DragEvent<HTMLDivElement>) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
        },
        onDrop: (e: DragEvent<HTMLDivElement>) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          e.stopPropagation()
          setOver(false)
          void addFiles(Array.from(e.dataTransfer.files ?? []))
        },
      }

  const addButton = !readOnly && (
    <button
      type="button"
      aria-label={FILES_TEXT.add}
      title={FILES_TEXT.add}
      disabled={busy}
      onClick={() => openFilePicker('file', (files) => void addFiles(files))}
      className={cn(
        'flex items-center gap-1 rounded px-1 text-[13px] text-fg-muted hover:bg-hover hover:text-fg',
        paths.length > 0 && 'opacity-0 transition-opacity group-hover/files:opacity-100 focus-visible:opacity-100',
      )}
    >
      <Icon name="ph-plus" size={13} />
      {paths.length === 0 && !compact && <span>{FILES_TEXT.add}</span>}
    </button>
  )

  return (
    <div
      data-testid="files-cell"
      data-drop-over={over || undefined}
      {...dropProps}
      className={cn(
        'group/files flex min-w-0 rounded',
        compact ? 'items-center gap-1.5' : 'flex-col gap-0.5',
        over && 'outline outline-1 outline-fg-muted',
      )}
    >
      {paths.length === 0 && (
        <span className="text-[15px] text-fg-muted">{over ? FILES_TEXT.drop : placeholderFor(def, inTable ? 'table' : density)}</span>
      )}
      {compact ? (
        <span className="flex min-w-0 items-center gap-2 overflow-hidden">
          {paths.map((p, i) => (
            <button
              key={`${i}:${p}`}
              type="button"
              title={p}
              onClick={() => void openFile(p)}
              className="flex min-w-0 shrink-0 items-center gap-1 text-[14px] text-fg hover:underline"
            >
              <Icon name={fileIconFor(p)} size={14} />
              <span className="max-w-[12rem] truncate">{fileName(p)}</span>
            </button>
          ))}
        </span>
      ) : (
        <ul className="flex min-w-0 flex-col gap-0.5">
          {paths.map((p, i) => (
            <li key={`${i}:${p}`} data-file={p} className="group/file flex min-w-0 items-center gap-1">
              <button
                type="button"
                title={p}
                aria-label={`${FILES_TEXT.open} ${fileName(p)}`}
                onClick={() => void openFile(p)}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-0.5 text-left text-[15px] text-fg hover:bg-hover"
              >
                <Icon name={fileIconFor(p)} size={16} />
                <span className="min-w-0 truncate">{fileName(p)}</span>
              </button>
              {!readOnly && (
                <>
                  <button
                    type="button"
                    aria-label={`${FILES_TEXT.moveUp} ${fileName(p)}`}
                    title={FILES_TEXT.moveUp}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className={ICON_BTN}
                  >
                    <Icon name="ph-arrow-up" size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`${FILES_TEXT.moveDown} ${fileName(p)}`}
                    title={FILES_TEXT.moveDown}
                    disabled={i === paths.length - 1}
                    onClick={() => move(i, 1)}
                    className={ICON_BTN}
                  >
                    <Icon name="ph-arrow-down" size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`${FILES_TEXT.remove} ${fileName(p)}`}
                    title={FILES_TEXT.remove}
                    onClick={() => save(paths.filter((_, j) => j !== i))}
                    className={ICON_BTN}
                  >
                    <Icon name="ph-x" size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {busy ? <span className="text-[13px] text-fg-muted">{FILES_TEXT.uploading}</span> : addButton}
    </div>
  )
}
