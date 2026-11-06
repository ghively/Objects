/**
 * M18: "New skill" on the agent page's Skills tab: a skill Gene writes (`created_by: user`, so the
 * curator never touches it). Name, Description (counted against the index's 60 characters) and
 * Instructions (SKILL.md's body). "Create skill" calls `POST /agents/{id}/skills`; a 409 (the name
 * is taken) or a 422 (a bad name or description) shows the server's message and keeps the dialog.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { api, ConflictError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { AGENT_TEXT } from './agentText'
import { LEARNING_TEXT as T } from './learningText'

/** The longest description the skills index takes (`learningmodel.SKILL_DESCRIPTION_MAX`). */
export const SKILL_DESCRIPTION_MAX = 60

export interface NewSkillDialogProps {
  agentId: string
  open: boolean
  onOpenChange(o: boolean): void
}

/** The route's 409 text (the client's `ConflictError` doesn't carry it). */
function takenMessage(name: string): string {
  return `A skill named '${name}' already exists.`
}

export function NewSkillDialog({ agentId, open, onOpenChange }: NewSkillDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setDescription('')
    setBody('')
    setError(null)
  }, [open])

  const length = Array.from(description).length
  const ready = name.trim() !== '' && description.trim() !== '' && !busy

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await api.createAgentSkill(agentId, { name: name.trim(), description: description.trim(), body })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof ConflictError ? takenMessage(name.trim()) : err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const field = 'h-9 rounded-md border border-line bg-transparent px-2 text-[14px] font-normal outline-none focus:border-fg-muted'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto border-line bg-raised-2 text-fg sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{T.newSkill}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            {T.skillName}
            <input
              autoFocus
              value={name}
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              className={cn(field, 'font-mono')}
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            <span className="flex items-center justify-between">
              {T.skillDescription}
              <span
                data-count=""
                className={cn('font-normal', length > SKILL_DESCRIPTION_MAX ? 'text-danger' : 'text-fg-muted')}
              >
                {T.descriptionCount(length)}
              </span>
            </span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            {T.instructions}
            <textarea
              value={body}
              rows={8}
              onChange={(e) => setBody(e.target.value)}
              className="rounded-md border border-line bg-transparent px-2 py-1.5 text-[14px] font-normal outline-none focus:border-fg-muted"
            />
          </label>
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {AGENT_TEXT.cancel}
            </Button>
            <Button type="submit" disabled={!ready}>
              {T.createSkill}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
