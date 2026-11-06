/**
 * M20: "Add remote agent…" (the Agents section's `+` menu). Gene types an Agent Card URL or an
 * address, picks the authentication, and "Look up" fetches the card (`previewRemoteAgent`, which
 * writes nothing): its name, description, version, provider and skills, where it sends messages,
 * whether it streams, and the server's warnings in amber. "Add agent" adds it (`addRemoteAgent`,
 * the card's name unless "Name" was edited) and opens its page. A 422 or 502 shows the server's
 * message under the field.
 *
 * The token or header value lives only in this dialog's local state: it is never put in a zustand
 * store or `localStorage`, and it is cleared when the dialog closes.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '@/api/client'
import type { RemoteAuthInput, RemotePreview } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTabs } from '@/nav/tabs'
import { REMOTE_TEXT as T } from './agentText'
import { useAgents } from './useAgents'

/** The auth fields' state (the value only while being entered). */
export interface AuthDraft {
  kind: RemoteAuthInput['kind']
  headerName: string
  value: string
}

export const EMPTY_AUTH: AuthDraft = { kind: 'none', headerName: '', value: '' }

/** The longest name `agent.json` accepts (`agentmodel.NAME_MAX`). */
const NAME_MAX = 60

/** What the routes take for `draft`. */
export function authInput(draft: AuthDraft): RemoteAuthInput {
  if (draft.kind === 'none') return { kind: 'none' }
  if (draft.kind === 'bearer') return { kind: 'bearer', value: draft.value }
  return { kind: 'header', headerName: draft.headerName.trim(), value: draft.value }
}

/** Whether `draft` has what its kind needs. */
export function authReady(draft: AuthDraft): boolean {
  if (draft.kind === 'none') return true
  if (draft.kind === 'header' && draft.headerName.trim() === '') return false
  return draft.value !== ''
}

const field =
  'h-9 rounded-md border border-line bg-transparent px-2 text-[14px] font-normal outline-none focus:border-fg-muted disabled:opacity-60'

/** "Authentication": None, Bearer token or Header; "Header name"; "Token" or "Value" (a password input). */
export function RemoteAuthFields({
  value,
  onChange,
  disabled,
  name = 'remote-auth',
}: {
  value: AuthDraft
  onChange(next: AuthDraft): void
  disabled?: boolean
  /** The radio group's name (unique per form). */
  name?: string
}) {
  const kinds: [AuthDraft['kind'], string][] = [
    ['none', T.authNone],
    ['bearer', T.authBearer],
    ['header', T.authHeader],
  ]
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="pb-1 text-[13px] font-semibold">{T.authentication}</legend>
      <div className="flex flex-wrap gap-4 text-[14px]">
        {kinds.map(([kind, label]) => (
          <label key={kind} className="flex items-center gap-1.5">
            <input
              type="radio"
              name={name}
              value={kind}
              checked={value.kind === kind}
              onChange={() => onChange({ ...value, kind })}
            />
            {label}
          </label>
        ))}
      </div>
      {value.kind === 'header' && (
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          {T.headerName}
          <input
            value={value.headerName}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onChange({ ...value, headerName: e.target.value })}
            className={`${field} font-mono text-[13px]`}
          />
        </label>
      )}
      {value.kind !== 'none' && (
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          {value.kind === 'bearer' ? T.token : T.value}
          <input
            type="password"
            value={value.value}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onChange({ ...value, value: e.target.value })}
            className={field}
          />
        </label>
      )}
    </fieldset>
  )
}

/** A card preview: name, description, version, provider, skills, endpoint, streaming, warnings. */
function Preview({ preview }: { preview: RemotePreview }) {
  const card = preview.card
  return (
    <div data-remote-preview="" className="flex flex-col gap-2 rounded-md border border-line px-3 py-2 text-[14px]">
      <p className="font-semibold">{card.name}</p>
      {card.description && <p className="whitespace-pre-wrap text-fg-muted">{card.description}</p>}
      {(card.version || card.provider) && (
        <p className="text-[13px] text-fg-muted">{[card.provider, card.version].filter(Boolean).join(' · ')}</p>
      )}
      {card.skills.length > 0 && (
        <ul aria-label={T.skills} className="flex flex-col gap-1">
          {card.skills.map((s) => (
            <li key={s.id} data-skill={s.id}>
              <span className="font-medium">{s.name}</span>
              {s.description && <span className="text-fg-muted"> — {s.description}</span>}
              {s.tags.length > 0 && <span className="ml-1 text-[12px] text-fg-muted">({s.tags.join(', ')})</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[13px]">{T.sendsTo(preview.endpointHost)}</p>
      <p className="text-[13px]">{card.streaming ? T.streaming : T.noStreaming}</p>
      {preview.warnings.map((w) => (
        <p key={w} data-warning="" className="text-[13px] text-amber-600 dark:text-amber-400">
          {w}
        </p>
      ))}
    </div>
  )
}

export function AddRemoteAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const [url, setUrl] = useState('')
  const [auth, setAuth] = useState<AuthDraft>(EMPTY_AUTH)
  const [preview, setPreview] = useState<RemotePreview | null>(null)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Every open starts empty, and closing forgets the token.
  useEffect(() => {
    setUrl('')
    setAuth(EMPTY_AUTH)
    setPreview(null)
    setName('')
    setNameEdited(false)
    setBusy(false)
    setError(null)
  }, [open])

  const canLookUp = url.trim() !== '' && authReady(auth) && !busy

  // A changed address or auth needs a new look-up.
  const edit = (fn: () => void) => {
    fn()
    setPreview(null)
    setError(null)
  }

  const lookUp = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!canLookUp) return
    setBusy(true)
    setError(null)
    try {
      const p = await api.previewRemoteAgent(url.trim(), authInput(auth))
      setPreview(p)
      if (!nameEdited) setName(p.card.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!preview || busy) return
    setBusy(true)
    setError(null)
    try {
      const typed = name.replace(/\s+/g, ' ').trim()
      const created = await api.addRemoteAgent({
        url: url.trim(),
        auth: authInput(auth),
        name: nameEdited && typed ? typed : null,
      })
      await useAgents.getState().load()
      onOpenChange(false)
      useTabs.getState().open({ kind: 'agent', id: created.id }, {})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-line bg-raised-2 text-fg sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{T.addTitle}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{T.addIntro}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void lookUp(e)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            {T.url}
            <input
              autoFocus
              value={url}
              spellCheck={false}
              placeholder={T.urlPlaceholder}
              onChange={(e) => edit(() => setUrl(e.target.value))}
              className={`${field} font-mono text-[13px]`}
            />
          </label>
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          <RemoteAuthFields value={auth} onChange={(next) => edit(() => setAuth(next))} disabled={busy} />
          <div>
            <Button type="submit" variant="outline" disabled={!canLookUp}>
              {busy && !preview ? T.lookingUp : T.lookUp}
            </Button>
          </div>
          {preview && (
            <>
              <Preview preview={preview} />
              <label className="flex flex-col gap-1 text-[13px] font-semibold">
                {T.name}
                <input
                  value={name}
                  maxLength={NAME_MAX}
                  onChange={(e) => {
                    setName(e.target.value)
                    setNameEdited(true)
                  }}
                  className={field}
                />
              </label>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {T.cancel}
            </Button>
            <Button type="button" disabled={!preview || busy} onClick={() => void add()}>
              {T.addButton}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
