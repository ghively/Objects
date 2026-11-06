/**
 * M17: "Deleted agents…": the agent trash (`GET /agent-trash`, newest first), each with Restore
 * (`POST /agent-trash/{trashId}/restore`: back to its original path, or a free "<name> (2)" beside
 * it). A 404 or 409 (its id is listed again) shows the server's message. There is no purge.
 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { AgentTrashItem } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AGENT_TEXT as T } from './agentText'
import { useAgents } from './useAgents'

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export function AgentTrashDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const [items, setItems] = useState<AgentTrashItem[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await api.agentTrash())
    } catch (err) {
      setItems([])
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setItems(null)
    setError(null)
    setBusy(null)
    void load()
  }, [open, load])

  const restore = async (item: AgentTrashItem) => {
    setBusy(item.trashId)
    setError(null)
    try {
      await api.restoreAgent(item.trashId)
      await Promise.all([useAgents.getState().load(), load()])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-line bg-raised-2 text-fg sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{T.trashTitle}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{T.trashIntro}</DialogDescription>
        </DialogHeader>
        {items && items.length === 0 && <p className="text-[14px] text-fg-muted">{T.trashEmpty}</p>}
        {items && items.length > 0 && (
          <ul aria-label={T.trashTitle} className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
            {items.map((it) => (
              <li key={it.trashId} data-agent-trash={it.trashId} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-hover">
                <span className="inline-flex size-[22px] shrink-0 items-center justify-center">
                  <IconOrEmoji icon={it.icon} fallback="ph-robot" size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{it.name}</span>
                  <span className="block truncate text-[12px] text-fg-muted" title={it.originalPath}>
                    {it.originalPath} · {when(it.deletedAt)}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`${T.restore} ${it.name}`}
                  disabled={busy !== null}
                  onClick={() => void restore(it)}
                >
                  {T.restore}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {T.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
