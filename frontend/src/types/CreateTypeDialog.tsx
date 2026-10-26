/**
 * "Create your object type": name and plural (both required), an icon and a random colour, then
 * "Create object type". The created type is put into the link index at once so its settings page
 * can show it before the next reload.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '@/api/client'
import type { Icon as IconValue, TypeDef } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLinkIndex } from '@/links/linkIndex'
import { randomColor } from '@/theme/palette'

export const CREATE_TYPE_TEXT = {
  title: 'Create your object type',
  description: 'Object types are categories for your content, like books, projects, or meeting notes.',
  name: 'Name',
  pluralName: 'Plural of name',
  tipHeading: 'Do I need a new type?',
  tip: 'Only if you have a distinct kind of note with its own details. A label property could be enough.',
  hint: 'You can customize properties after creating the object type in the object type settings.',
  action: 'Create object type',
}

export interface CreateTypeDialogProps {
  open: boolean
  onOpenChange?(open: boolean): void
  /** The new type (the caller opens its settings). */
  onCreated?(type: TypeDef): void
}

const DEFAULT_ICON: IconValue = { type: 'iconify', val: 'ph-cube' }

export function CreateTypeDialog({ open, onOpenChange, onCreated }: CreateTypeDialogProps) {
  const [name, setName] = useState('')
  const [pluralName, setPluralName] = useState('')
  const [icon, setIcon] = useState<IconValue>(DEFAULT_ICON)
  const [iconOpen, setIconOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setPluralName('')
    setIcon(DEFAULT_ICON)
    setError(null)
  }, [open])

  const ready = name.trim() !== '' && pluralName.trim() !== '' && !busy

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const type = await api.createType({
        name: name.trim(),
        pluralName: pluralName.trim(),
        icon,
        color: randomColor(),
      })
      useLinkIndex.setState((s) => ({
        types: s.types.some((t) => t.id === type.id) ? s.types : [...s.types, type],
        revision: s.revision + 1,
      }))
      onOpenChange?.(false)
      onCreated?.(type)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => onOpenChange?.(o)}>
      <DialogContent className="border-line bg-raised-2 text-fg sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{CREATE_TYPE_TEXT.title}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{CREATE_TYPE_TEXT.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <Popover open={iconOpen} onOpenChange={setIconOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Type icon"
                  className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line hover:bg-hover"
                >
                  <IconOrEmoji icon={icon} fallback="ph-cube" size={18} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
                <IconPicker
                  value={icon}
                  onChange={(next) => {
                    setIcon(next ?? DEFAULT_ICON)
                    setIconOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] font-semibold">
              {CREATE_TYPE_TEXT.name}
              <input
                autoFocus
                value={name}
                placeholder={CREATE_TYPE_TEXT.name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 rounded-md border border-line bg-transparent px-2 text-[15px] font-normal outline-none focus:border-fg-muted"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            {CREATE_TYPE_TEXT.pluralName}
            <input
              value={pluralName}
              placeholder={CREATE_TYPE_TEXT.pluralName}
              onChange={(e) => setPluralName(e.target.value)}
              className="h-9 rounded-md border border-line bg-transparent px-2 text-[15px] font-normal outline-none focus:border-fg-muted"
            />
          </label>
          <aside aria-label={CREATE_TYPE_TEXT.tipHeading} className="flex gap-2 rounded-lg bg-hover/60 p-3 text-[13px]">
            <Icon name="ph-lightbulb" size={16} />
            <div>
              <p className="font-semibold">{CREATE_TYPE_TEXT.tipHeading}</p>
              <p className="mt-0.5 text-fg-muted">{CREATE_TYPE_TEXT.tip}</p>
            </div>
          </aside>
          <p className="text-[13px] text-fg-muted">{CREATE_TYPE_TEXT.hint}</p>
          {error && (
            <p role="alert" className="text-[13px] text-red-400">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={!ready}>
              {CREATE_TYPE_TEXT.action}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
