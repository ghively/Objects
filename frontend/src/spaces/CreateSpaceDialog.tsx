/**
 * "Create new space": a name and a location (the current space's parent folder by default), then
 * "Create space" makes `<location>/<safe name>/.object/space.json` through `POST /api/spaces`
 * and offers to switch to it. Nothing else is created and an existing folder is never touched
 * (the server answers 409, shown as "A folder with that name already exists here.").
 */
import { useEffect, useState, type FormEvent } from 'react'
import { create } from 'zustand'
import { api, ApiError } from '@/api/client'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { switchSpace } from './switchSpace'

export const CREATE_SPACE_TEXT = {
  title: 'Create new space', // OnboardingSpace.heading
  intro: 'Name your space', // OnboardingSpace.intro
  namePlaceholder: 'Name', // OnboardingSpace.namePlaceholder
  location: 'Location', // our string
  explainHeading: 'Do I need a new space?', // OnboardingSpace.explain.heading
  explainText: 'Only if this work should stay isolated. You cannot link notes across spaces.', // OnboardingSpace.explain.text
  cancel: 'Cancel', // general.cancel
  create: 'Create space', // components.RootSpace.create
  exists: 'A folder with that name already exists here.', // our string
  created: 'Space created. Switch to it now?', // our string
  switchNow: 'Switch space', // our string
  later: 'Later', // our string
} as const

const T = CREATE_SPACE_TEXT

/** The longest name `space.json` accepts (the server's rule). */
const MAX_NAME = 120

interface CreateSpaceDialogState {
  isOpen: boolean
  open(): void
  close(): void
}

/** The dialog's open state, so the spaces menu (in the top bar) opens the dialog mounted in `GlobalOverlays`. */
export const useCreateSpaceDialog = create<CreateSpaceDialogState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}))

/** The folder that holds `root` (`/a/b` → `/a`, `C:\a\b` → `C:\a`, `C:\a` → `C:\`). */
export function parentFolder(root: string): string {
  const trimmed = root.length > 1 ? root.replace(/[\\/]+$/, '') : root
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (i < 0) return trimmed
  const sep = trimmed[i]
  const head = trimmed.slice(0, i)
  if (head === '') return sep
  if (/^[A-Za-z]:$/.test(head)) return head + sep
  return head
}

export function CreateSpaceDialog() {
  const isOpen = useCreateSpaceDialog((s) => s.isOpen)
  const root = useSpaceInfo((s) => s.space?.root ?? null)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    void useSpaceInfo.getState().ensure()
    setName('')
    setError(null)
    setCreated(null)
    setBusy(false)
  }, [isOpen])
  useEffect(() => {
    if (isOpen) setLocation(root ? parentFolder(root) : '')
  }, [isOpen, root])

  const trimmed = name.trim()
  const ready = trimmed !== '' && trimmed.length <= MAX_NAME && location.trim() !== '' && !busy

  const close = () => useCreateSpaceDialog.getState().close()

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.createSpace(trimmed, location.trim())
      setCreated(res.path)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError(T.exists)
      else setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const switchNow = () => {
    if (!created) return
    const path = created
    close()
    void switchSpace(path)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => (o ? useCreateSpaceDialog.getState().open() : close())}>
      <DialogContent className="border-line bg-raised-2 text-fg sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{T.title}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{T.intro}</DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="flex flex-col gap-3">
            <p className="text-[14px]">{T.created}</p>
            <p className="truncate text-[13px] text-fg-muted" title={created}>
              {created}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                {T.later}
              </Button>
              <Button type="button" onClick={switchNow}>
                {T.switchNow}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
            <input
              autoFocus
              aria-label={T.namePlaceholder}
              value={name}
              maxLength={MAX_NAME}
              placeholder={T.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
              className="h-9 rounded-md border border-line bg-transparent px-2 text-[15px] outline-none focus:border-fg-muted"
            />
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              {T.location}
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                spellCheck={false}
                className="h-9 rounded-md border border-line bg-transparent px-2 font-mono text-[13px] font-normal outline-none focus:border-fg-muted"
              />
            </label>
            <aside aria-label={T.explainHeading} className="flex gap-2 rounded-lg bg-hover/60 p-3 text-[13px]">
              <Icon name="ph-lightbulb" size={16} />
              <div>
                <p className="font-semibold">{T.explainHeading}</p>
                <p className="mt-0.5 text-fg-muted">{T.explainText}</p>
              </div>
            </aside>
            {error && (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                {T.cancel}
              </Button>
              <Button type="submit" disabled={!ready}>
                {T.create}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
