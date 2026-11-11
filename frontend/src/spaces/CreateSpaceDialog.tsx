/**
 * "Create new space": a name and a location (the current space's parent folder by default), then
 * "Create space" makes `<location>/<safe name>/.object/space.json` through `POST /api/spaces`
 * and offers to switch to it. An existing folder is never touched (the server answers 409, shown
 * as "A folder with that name already exists here.").
 *
 * M32, "a new space just starts": the dialog asks for a name and a folder only. The space is made
 * with the plain start (`setup: 'blank'`, recorded in `space.json`; the server gives every new
 * space the Note, Tag, Daily note and Task types). The starter sets M8 and M28 offered here
 * ("Start with basic setup", "IT operations"; `SETUPS`, `api.spaceSetup`) are offered from the
 * type gallery instead.
 * M15: "Import from…" closes this dialog and opens the import dialog with the name and location
 * typed here (the import makes the new space itself).
 */
import { useEffect, useState, type FormEvent } from 'react'
import { create } from 'zustand'
import { api, ApiError } from '@/api/client'
import type { SpaceSetup } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useImportDialog } from '@/import/useImportDialog'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { switchSpace } from './switchSpace'

export const CREATE_SPACE_TEXT = {
  title: 'Create new space',
  intro: 'Name your space',
  namePlaceholder: 'Name',
  location: 'Location', // our string
  explainHeading: 'Do I need a new space?',
  explainText: 'Use one only for work that must stay separate: notes in different spaces cannot link to each other.',
  cancel: 'Cancel',
  create: 'Create space',
  // Fix pass W9 (our string): the space is `<Location>/<its name>`; Location itself must be there.
  locationHint: 'The space is made as a new folder with its name inside this folder.',
  exists: 'A folder with that name already exists here.', // our string
  // Fix pass W9 (our string): the server's 404 `"<location>" is not a folder.`, in plain words.
  noLocation: (location: string) => `The folder "${location}" does not exist.`,
  // Fix pass W9: after creating, the dialog's heading and its one line (they were one paragraph
  // under the form's heading "Create new space" / "Name your space").
  createdTitle: 'Space created', // our string
  created: 'Switch to it now?', // our string
  switchNow: 'Switch space', // our string
  later: 'Later', // our string
  howToStart: 'Pick a starting point',
  basicLabel: 'Start with basic setup',
  basicDescription: 'Comes with types for people, meetings, projects and books.',
  itopsLabel: 'IT operations',
  itopsDescription: 'Includes hosts, software, applications, runbooks and incidents.',
  blankLabel: 'Empty space',
  blankDescription: 'Starts with no extra types; create them as you go.',
  importFrom: 'Import from…', // our string
  importDescription: 'Make the new space from a Notion, Obsidian or Anytype export.', // our string
} as const

const T = CREATE_SPACE_TEXT

/**
 * M8's starting points (M28 added IT operations between them). M32: this dialog no longer asks and
 * an empty folder asks nothing; the list stays for the type gallery's "Starter sets".
 */
export const SETUPS: { value: SpaceSetup; icon: string; label: string; description: string }[] = [
  { value: 'basic', icon: 'ph-shapes', label: T.basicLabel, description: T.basicDescription },
  { value: 'itops', icon: 'ph-hard-drives', label: T.itopsLabel, description: T.itopsDescription },
  { value: 'blank', icon: 'ph-file-dashed', label: T.blankLabel, description: T.blankDescription },
]

/** M32: what "Create space" makes: the plain start (no starter set). */
export const NEW_SPACE_SETUP: SpaceSetup = 'blank'

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
      const res = await api.createSpace(trimmed, location.trim(), NEW_SPACE_SETUP)
      setCreated(res.path)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError(T.exists)
      // The Location is no folder (it is missing, or it is a file): the server's `"…" is not a folder.`
      else if (err instanceof ApiError && err.status === 404 && /is not a folder\.$/.test(err.message)) setError(T.noLocation(location.trim()))
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
          <DialogTitle className="text-[18px]">{created ? T.createdTitle : T.title}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{created ? T.created : T.intro}</DialogDescription>
        </DialogHeader>
        {created ? (
          // `min-w-0`: a grid item is as wide as its longest line unless told otherwise, and a long
          // path pushed the buttons out of the box. The path wraps instead (W9).
          <div className="flex min-w-0 flex-col gap-3">
            <p className="font-mono text-[13px] break-all text-fg-muted" title={created}>
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
            <div className="flex flex-col gap-1">
              <label className="flex flex-col gap-1 text-[13px] font-semibold">
                {T.location}
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  spellCheck={false}
                  aria-describedby="space-location-hint"
                  className="h-9 rounded-md border border-line bg-transparent px-2 font-mono text-[13px] font-normal outline-none focus:border-fg-muted"
                />
              </label>
              <p id="space-location-hint" className="text-[12px] text-fg-muted">
                {T.locationHint}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                close()
                useImportDialog.getState().open({ name: trimmed || undefined, location: location.trim() || undefined })
              }}
              aria-label={T.importFrom}
              aria-describedby="space-import-description"
              className="flex items-start gap-2.5 rounded-lg border border-dashed border-line p-2.5 text-left hover:bg-hover"
            >
              <Icon name="ph-download-simple" size={18} className="mt-0.5 shrink-0 text-fg-muted" />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold">{T.importFrom}</span>
                <span id="space-import-description" className="block text-[13px] text-fg-muted">
                  {T.importDescription}
                </span>
              </span>
            </button>
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
