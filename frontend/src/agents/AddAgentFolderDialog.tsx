/**
 * M17: "Add agent folder…": lists an agent folder already on this computer (a shared or restored
 * agent) through `POST /agents/add-folder`, which never writes into it. The path is typed, as
 * Create space's location is (the app has no native folder dialog). A 404, 409 or 422 shows the
 * server's message.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AGENT_TEXT as T } from './agentText'
import { useAgents } from './useAgents'

export function AddAgentFolderDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPath('')
    setBusy(false)
    setError(null)
  }, [open])

  const ready = path.trim() !== '' && !busy

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await api.addAgentFolder(path.trim())
      await useAgents.getState().load()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-line bg-raised-2 text-fg sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{T.addFolderTitle}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{T.addFolderIntro}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            {T.folderPath}
            <input
              autoFocus
              value={path}
              spellCheck={false}
              onChange={(e) => setPath(e.target.value)}
              className="h-9 rounded-md border border-line bg-transparent px-2 font-mono text-[13px] font-normal outline-none focus:border-fg-muted"
            />
          </label>
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {T.cancel}
            </Button>
            <Button type="submit" disabled={!ready}>
              {T.addFolderButton}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
