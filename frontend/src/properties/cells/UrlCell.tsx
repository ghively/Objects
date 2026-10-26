import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { placeholderFor } from '../format'
import type { CellProps } from './types'

/** A link's text: the URL without its scheme and trailing slash. */
function linkText(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/$/, '')
}

/** An http(s) URL, or the text with `https://` in front when it has no scheme. */
function hrefFor(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
}

const ICON_BTN =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted opacity-0 transition-opacity group-hover/url:opacity-100 focus-visible:opacity-100 hover:bg-hover hover:text-fg'

/**
 * A web URL (`url`): an external link that opens in a new window, with "Edit link" (a dialog
 * that replaces the link) and "Remove link". An empty cell offers "Add link".
 */
export function UrlCell({ def, value, readOnly, density, inTable, onChange }: CellProps<string | null>) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const edit = () => {
    setDraft(value ?? '')
    setOpen(true)
  }
  const save = () => {
    const next = draft.trim() === '' ? null : draft.trim()
    setOpen(false)
    if (next !== (value || null)) onChange(next)
  }

  return (
    <div className="group/url flex min-w-0 items-center gap-1">
      {value ? (
        <a
          href={hrefFor(value)}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 truncate text-[15px] text-fg underline decoration-fg-muted underline-offset-2"
        >
          {linkText(value)}
        </a>
      ) : (
        <span className="text-[15px] text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>
      )}
      {!readOnly && (
        <>
          <button type="button" aria-label={value ? 'Edit link' : 'Add link'} title={value ? 'Edit link' : 'Add link'} onClick={edit} className={ICON_BTN}>
            <Icon name={value ? 'ph-pencil-simple' : 'ph-plus'} size={14} />
          </button>
          {value && (
            <button type="button" aria-label="Remove link" title="Remove link" onClick={() => onChange(null)} className={ICON_BTN}>
              <Icon name="ph-x" size={14} />
            </button>
          )}
        </>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-line bg-raised text-fg sm:max-w-md">
          <DialogTitle>{value ? 'Edit link' : 'Add link'}</DialogTitle>
          <DialogDescription className="text-fg-muted">
            Paste a URL. Saving replaces the current link.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
            className="flex flex-col gap-3"
          >
            <input
              aria-label="URL"
              autoFocus
              value={draft}
              placeholder="https://"
              onChange={(e) => setDraft(e.target.value)}
              className="h-9 rounded-md border border-line bg-panel px-2 text-[14px] text-fg outline-none focus:border-fg-muted"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-[14px] hover:bg-hover">
                Cancel
              </button>
              <button type="submit" className="rounded-md bg-[var(--primary-btn)] px-3 py-1.5 text-[14px] text-black">
                Save
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
