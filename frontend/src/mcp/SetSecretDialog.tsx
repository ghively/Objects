/**
 * M19: the Set dialog for one secret variable (a `${NAME}` an agent folder's `.mcp.json` uses).
 * Open while `name` is set. A password field "Value" and "Cancel" / "Save"; Save calls
 * `PUT /mcp-secrets/{name}`. The value is never shown again: the field is cleared whenever the
 * dialog closes or opens for another name. A 422 shows the server's message and keeps the dialog.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MCP_TEXT } from './mcpText'

export interface SetSecretDialogProps {
  name: string | null
  onOpenChange(o: boolean): void
  onSaved?(): void
}

export function SetSecretDialog({ name, onOpenChange, onSaved }: SetSecretDialogProps) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A new name (or none: closed) starts from an empty field.
  useEffect(() => {
    setValue('')
    setError(null)
  }, [name])

  const close = (o: boolean) => {
    if (!o) {
      setValue('')
      setError(null)
    }
    onOpenChange(o)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (name === null || value === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.setMcpSecret(name, value)
      setValue('')
      onSaved?.()
      close(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={name !== null} onOpenChange={close}>
      <DialogContent aria-describedby={undefined} className="border-line bg-raised-2 text-fg sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{name !== null ? MCP_TEXT.setTitle(name) : ''}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            {MCP_TEXT.value}
            <input
              type="password"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-9 rounded-md border border-line bg-transparent px-2 text-[14px] font-normal outline-none focus:border-fg-muted"
            />
          </label>
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {MCP_TEXT.cancel}
            </Button>
            <Button type="submit" disabled={value === '' || busy}>
              {MCP_TEXT.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
