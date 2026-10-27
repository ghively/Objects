/**
 * The Web link tool's input (M8): a URL ("Paste URL") and an optional title ("Title"), then
 * "Add". Only `http`/`https` links are taken (a bare `example.org` gets `https://`, our choice);
 * anything else shows "Invalid URL format". Nothing is fetched: the board stores what was typed.
 * Enter adds, Escape cancels.
 */
import { useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { normalizeWeblinkUrl } from '../model'
import { WB } from '../strings'

export interface WeblinkInputProps {
  onSubmit(link: { url: string; title?: string }): void
  onClose(): void
}

export function WeblinkInput({ onSubmit, onClose }: WeblinkInputProps) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [invalid, setInvalid] = useState(false)

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const normalized = normalizeWeblinkUrl(url)
    if (!normalized) {
      setInvalid(true)
      return
    }
    const t = title.trim()
    onSubmit(t ? { url: normalized, title: t } : { url: normalized })
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    // Keys typed here never reach the canvas shortcuts.
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <form
      role="dialog"
      aria-label={WB.weblinkHeading.text}
      data-testid="whiteboard-weblink-input"
      className="flex w-[360px] flex-col gap-2 rounded-xl border border-line bg-raised-2 p-3 text-fg shadow-xl"
      noValidate
      onSubmit={submit}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p className="text-[14px] font-semibold">{WB.weblinkHeading.text}</p>
      <input
        autoFocus
        type="text"
        inputMode="url"
        aria-label={WB.weblinkPlaceholder.text}
        placeholder={WB.weblinkPlaceholder.text}
        value={url}
        aria-invalid={invalid || undefined}
        className="rounded-md border border-line bg-transparent px-2 py-1 text-[14px] outline-none focus:border-[var(--color-border-block-selection)]"
        onChange={(e) => {
          setUrl(e.target.value)
          setInvalid(false)
        }}
      />
      <input
        type="text"
        aria-label={WB.weblinkTitle.text}
        placeholder={WB.weblinkTitle.text}
        value={title}
        className="rounded-md border border-line bg-transparent px-2 py-1 text-[14px] outline-none focus:border-[var(--color-border-block-selection)]"
        onChange={(e) => setTitle(e.target.value)}
      />
      {invalid && (
        <p role="alert" className="text-[13px] text-red-400">
          {WB.weblinkInvalid.text}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-md px-3 py-1 text-[13px] hover:bg-hover" onClick={onClose}>
          {WB.cancel.text}
        </button>
        <button type="submit" className="rounded-md bg-hover px-3 py-1 text-[13px] font-medium">
          {WB.weblinkAdd.text}
        </button>
      </div>
    </form>
  )
}
