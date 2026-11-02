/**
 * The top bar's space switcher ("Spaces"): one row per registered space (icon, name, a check on
 * the current one, muted when its folder is gone). Clicking another space switches to it; each
 * row's "…" has "Rename" (the current space only: writes `space.json`'s name), "Remove" (never
 * the current space: Object forgets it, the folder stays) and, M8, "Delete space" (never the
 * current space: the folder goes to the OS trash, see `DeleteSpaceDialog`). Below the list: "Space settings",
 * "Add space" (the create dialog) and "Open folder…" (registers an existing folder).
 *
 * `SpaceSwitchOverlay` covers the app while a switch waits for the server to come back on the new
 * space, and shows why a switch stopped.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { SpaceEntry } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSettingsModal } from '@/settings/useSettingsModal'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { useCreateSpaceDialog } from './CreateSpaceDialog'
import { DELETE_SPACE_TEXT, DeleteSpaceDialog } from './DeleteSpaceDialog'
import { SWITCH_TEXT, switchSpace, useSpaceSwitch } from './switchSpace'

export const SPACES_MENU_TEXT = {
  heading: 'Spaces', // SpacesMenu.heading
  more: 'More', // general.more
  rename: 'Rename', // general.rename
  remove: 'Remove', // MultiSpacePicker.remove
  removeConfirm: 'Object forgets this space. Its folder and files stay where they are.', // our string
  cancel: 'Cancel', // general.cancel
  spaceSettings: 'Space settings', // SpacesMenu.spaceSettings
  addSpace: 'Add space', // components.RootSpace.addSpace
  openFolder: 'Open folder…', // our string
  folderPath: 'Folder path', // our string
  open: 'Open', // general.open
} as const

const T = SPACES_MENU_TEXT

/** The longest name `space.json` accepts (the server's rule). */
const MAX_NAME = 120

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function SpaceRow({
  entry,
  renaming,
  onSwitch,
  onRename,
  onRemove,
  onDelete,
  onRenameDone,
}: {
  entry: SpaceEntry
  renaming: boolean
  onSwitch(): void
  onRename(): void
  onRemove(): void
  onDelete(): void
  onRenameDone(name: string | null): void
}) {
  const [draft, setDraft] = useState(entry.name)
  const done = useRef(false)
  useEffect(() => {
    if (renaming) {
      setDraft(entry.name)
      done.current = false
    }
  }, [renaming, entry.name])

  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    onRenameDone(name)
  }

  return (
    <li
      data-testid="space-row"
      data-current={entry.current || undefined}
      data-missing={entry.missing || undefined}
      className="group flex items-center gap-1 rounded-md hover:bg-hover"
    >
      {renaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1">
          <IconOrEmoji icon={entry.icon} fallback="ph-lightbulb" size={15} />
          <input
            autoFocus
            aria-label={T.rename}
            value={draft}
            maxLength={MAX_NAME}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                finish(draft)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                finish(null)
              }
            }}
            onBlur={() => finish(draft)}
            className="h-7 min-w-0 flex-1 rounded border border-line bg-transparent px-1.5 text-[14px] outline-none focus:border-fg-muted"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={onSwitch}
          disabled={entry.missing}
          title={entry.path}
          aria-current={entry.current ? 'true' : undefined}
          className={`flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left text-[14px] disabled:cursor-default ${
            entry.missing ? 'text-fg-muted opacity-60' : ''
          }`}
        >
          <IconOrEmoji icon={entry.icon} fallback="ph-lightbulb" size={15} />
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          {entry.current && <Icon name="ph-check" size={14} className="text-fg-muted" />}
        </button>
      )}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${T.more}: ${entry.name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded text-fg-muted opacity-0 group-hover:opacity-100 hover:bg-hover-2 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <Icon name="ph-dots-three" size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {entry.current ? (
            <DropdownMenuItem onSelect={onRename}>
              <Icon name="ph-pencil-simple" size={15} />
              {T.rename}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onSelect={onRemove}>
                <Icon name="ph-x" size={15} />
                {T.remove}
              </DropdownMenuItem>
              {!entry.missing && (
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Icon name="ph-trash" size={15} />
                  {DELETE_SPACE_TEXT.menuItem}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function FooterButton({ icon, label, onClick }: { icon: string; label: string; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
    >
      <Icon name={icon} size={15} className="text-fg-muted" />
      {label}
    </button>
  )
}

export interface SpacesMenuProps {
  /** The trigger (the top bar's space button). */
  children: ReactNode
}

export function SpacesMenu({ children }: SpacesMenuProps) {
  const [open, setOpen] = useState(false)
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [removing, setRemoving] = useState<SpaceEntry | null>(null)
  const [deleting, setDeleting] = useState<SpaceEntry | null>(null)
  // The remove and delete confirmations take focus; the menu stays open behind them.
  const confirming = useRef(false)
  confirming.current = removing !== null || deleting !== null
  const [folderOpen, setFolderOpen] = useState(false)
  const [folder, setFolder] = useState('')
  const [filter, setFilter] = useState('')

  const reload = async () => {
    try {
      setSpaces(await api.spaces())
    } catch (e) {
      setError(errorText(e))
    }
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    setRenaming(null)
    setFolderOpen(false)
    setFolder('')
    setFilter('')
    void useSpaceInfo.getState().ensure()
    void reload()
  }, [open])

  const switchTo = (entry: SpaceEntry) => {
    if (entry.current || entry.missing) return
    setOpen(false)
    void switchSpace(entry.path)
  }

  const renameDone = async (name: string | null) => {
    setRenaming(null)
    const next = name?.trim() ?? ''
    const current = spaces.find((s) => s.current)
    if (!current || !next || next === current.name || next.length > MAX_NAME) return
    setSpaces((list) => list.map((s) => (s.current ? { ...s, name: next } : s)))
    try {
      await useSpaceInfo.getState().patch({ name: next })
    } catch (e) {
      setError(errorText(e))
    }
    await reload()
  }

  const confirmRemove = async () => {
    const entry = removing
    setRemoving(null)
    if (!entry) return
    try {
      await api.removeSpace(entry.path)
      setSpaces((list) => list.filter((s) => s.path !== entry.path))
    } catch (e) {
      setError(errorText(e))
    }
    await reload()
  }

  const openFolder = async () => {
    const path = folder.trim()
    if (!path) return
    setError(null)
    try {
      await api.openSpace(path)
      setFolderOpen(false)
      setFolder('')
    } catch (e) {
      setError(errorText(e))
    }
    await reload()
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          if (!o && confirming.current) return
          setOpen(o)
        }}
      >
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={T.heading}
          className="w-[300px] border-line bg-raised p-1.5 text-fg"
          onEscapeKeyDown={(e) => {
            if (renaming) e.preventDefault()
          }}
        >
          <input
            aria-label="Search spaces"
            placeholder="Search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-1.5 h-8 w-full rounded-md border border-line bg-transparent px-2 text-[14px] outline-none placeholder:text-fg-muted focus:border-fg-muted"
          />
          <ul className="flex flex-col gap-0.5" aria-label={T.heading}>
            {spaces.filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase())).map((entry) => (
              <SpaceRow
                key={entry.path}
                entry={entry}
                renaming={renaming === entry.path}
                onSwitch={() => switchTo(entry)}
                onRename={() => setRenaming(entry.path)}
                onRemove={() => {
                  confirming.current = true
                  setRemoving(entry)
                }}
                onDelete={() => {
                  confirming.current = true
                  setDeleting(entry)
                }}
                onRenameDone={(name) => void renameDone(name)}
              />
            ))}
          </ul>
          {error && (
            <p role="alert" className="px-2 py-1 text-[13px] text-danger">
              {error}
            </p>
          )}
          <div className="my-1.5 h-px bg-line" />
          <FooterButton
            icon="ph-gear-six"
            label={T.spaceSettings}
            onClick={() => {
              setOpen(false)
              useSettingsModal.getState().open('space')
            }}
          />
          <FooterButton
            icon="ph-plus"
            label={T.addSpace}
            onClick={() => {
              setOpen(false)
              useCreateSpaceDialog.getState().open()
            }}
          />
          <FooterButton icon="ph-folder-open" label={T.openFolder} onClick={() => setFolderOpen((v) => !v)} />
          {folderOpen && (
            <form
              className="flex items-center gap-1.5 px-2 pt-1 pb-1"
              onSubmit={(e) => {
                e.preventDefault()
                void openFolder()
              }}
            >
              <input
                autoFocus
                aria-label={T.folderPath}
                placeholder={T.folderPath}
                value={folder}
                spellCheck={false}
                onChange={(e) => setFolder(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 font-mono text-[12px] outline-none focus:border-fg-muted"
              />
              <Button type="submit" size="sm" disabled={!folder.trim()}>
                {T.open}
              </Button>
            </form>
          )}
        </PopoverContent>
      </Popover>
      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent className="border-line bg-raised-2 text-fg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {T.remove}: {removing?.name}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-fg-muted">{T.removeConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRemove()}>{T.remove}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DeleteSpaceDialog
        entry={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(path) => {
          setSpaces((list) => list.filter((s) => s.path !== path))
          void reload()
        }}
      />
    </>
  )
}

/** "Switching space…" over the whole app while a switch runs; the error when it stopped. */
export function SpaceSwitchOverlay() {
  const phase = useSpaceSwitch((s) => s.phase)
  const error = useSpaceSwitch((s) => s.error)
  if (phase === 'idle') return null
  if (phase === 'switching') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-app/80 text-fg backdrop-blur-sm"
      >
        <div className="flex items-center gap-2 rounded-lg border border-line bg-raised px-4 py-3 text-[14px] shadow-md">
          <Icon name="ph-circle-notch" size={16} className="animate-spin" />
          {SWITCH_TEXT.switching}
        </div>
      </div>
    )
  }
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-[100] flex max-w-[480px] -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-raised px-4 py-3 text-[14px] text-fg shadow-md"
    >
      <Icon name="ph-warning-circle" size={16} className="shrink-0 text-danger" />
      <span className="min-w-0 flex-1">{error}</span>
      <Button type="button" size="sm" variant="ghost" onClick={() => useSpaceSwitch.getState().dismiss()}>
        {SWITCH_TEXT.dismiss}
      </Button>
    </div>
  )
}
