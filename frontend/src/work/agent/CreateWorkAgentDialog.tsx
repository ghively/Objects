import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { WorkAgentSettings } from '@/api/types'
import { useAgents } from '@/agents/useAgents'
import { WORK_AGENT_TEXT as T } from './workAgentText'

/** "Create the Work agent": the shell warning, and the reviewer copy when `create-info` found one. */
export function CreateWorkAgentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  onCreated(s: WorkAgentSettings): void
}) {
  const [reviewer, setReviewer] = useState<string | null>(null)
  const [copy, setCopy] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setCopy(true)
    setBusy(false)
    setError(null)
    setReviewer(null)
    let live = true
    api
      .workAgentCreateInfo()
      .then((i) => live && setReviewer(i.changeReviewer))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [open])

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.createWorkAgent(reviewer !== null && copy)
      await useAgents.getState().load()
      onCreated(res.settings)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-line bg-raised-2 text-fg sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{T.dialogTitle}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{T.dialogText}</DialogDescription>
        </DialogHeader>
        <p className="text-[13px] text-fg-muted">{T.shellWarning}</p>
        {reviewer !== null && (
          <label className="flex items-start gap-2 text-[14px]">
            <input type="checkbox" className="mt-1" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
            <span>
              {T.copyReviewer}
              <span className="block text-[13px] text-fg-muted">{T.copyReviewerHint}</span>
            </span>
          </label>
        )}
        {error && <p role="alert" className="text-[13px] text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{T.cancel}</Button>
          <Button type="button" disabled={busy} onClick={() => void create()}>{T.confirm}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
