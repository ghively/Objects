import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { placeholderFor } from '../format'
import type { CellProps } from './types'

const ICON_BTN =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted opacity-0 transition-opacity group-hover/contact:opacity-100 focus-visible:opacity-100 hover:bg-hover hover:text-fg'

/** What differs between the email and phone cells (labels are our strings). */
export interface ContactKind {
  /** "email" / "phone", in the button and dialog labels. */
  noun: string
  /** The dialog title's noun ("Email address", "Phone number"), also the input's label. */
  field: string
  placeholder: string
  inputType: 'email' | 'tel'
  valid(s: string): boolean
  href(s: string): string
  error: string
}

/**
 * An email address or a phone number, as `UrlCell` shows a link: a `mailto:` / `tel:` link handed
 * to the OS (the app sends nothing itself), "Edit …" (a dialog that checks the format and shows
 * an inline error instead of saving invalid text) and "Remove …". An empty cell offers "Add …".
 */
export function ContactCell({ kind, def, value, readOnly, density, inTable, onChange }: CellProps<string | null> & { kind: ContactKind }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const text = typeof value === 'string' && value.trim() !== '' ? value : null

  const edit = () => {
    setDraft(text ?? '')
    setError(null)
    setOpen(true)
  }
  const save = () => {
    const t = draft.trim()
    if (t !== '' && !kind.valid(t)) {
      setError(kind.error)
      return
    }
    const next = t === '' ? null : t
    setOpen(false)
    if (next !== text) onChange(next)
  }

  return (
    <div className="group/contact flex min-w-0 items-center gap-1">
      {text ? (
        <a
          href={kind.href(text)}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 truncate text-[15px] text-fg underline decoration-fg-muted underline-offset-2"
        >
          {text}
        </a>
      ) : (
        <span className="text-[15px] text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>
      )}
      {!readOnly && (
        <>
          <button
            type="button"
            aria-label={text ? `Edit ${kind.noun}` : `Add ${kind.noun}`}
            title={text ? `Edit ${kind.noun}` : `Add ${kind.noun}`}
            onClick={edit}
            className={ICON_BTN}
          >
            <Icon name={text ? 'ph-pencil-simple' : 'ph-plus'} size={14} />
          </button>
          {text && (
            <button
              type="button"
              aria-label={`Remove ${kind.noun}`}
              title={`Remove ${kind.noun}`}
              onClick={() => onChange(null)}
              className={ICON_BTN}
            >
              <Icon name="ph-x" size={14} />
            </button>
          )}
        </>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-line bg-raised text-fg sm:max-w-md">
          <DialogTitle>{text ? `Edit ${kind.noun}` : `Add ${kind.noun}`}</DialogTitle>
          <DialogDescription className="text-fg-muted">{`Saving replaces the current ${kind.field.toLowerCase()}.`}</DialogDescription>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
            className="flex flex-col gap-3"
          >
            <input
              aria-label={kind.field}
              aria-invalid={error ? true : undefined}
              type={kind.inputType}
              autoFocus
              value={draft}
              placeholder={kind.placeholder}
              onChange={(e) => {
                setDraft(e.target.value)
                setError(null)
              }}
              className="h-9 rounded-md border border-line bg-panel px-2 text-[14px] text-fg outline-none focus:border-fg-muted aria-[invalid]:border-destructive"
            />
            {error && (
              <p role="alert" className="text-[13px] text-destructive">
                {error}
              </p>
            )}
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
