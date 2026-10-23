/**
 * An object's full view, shared by the page and the peek: property panel,
 * header and body editor (formatted or raw), with the `…` menu.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { ObjectDetail } from '@/api/types'
import { Icon } from '@/components/Icon'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Editor } from '@/editor/Editor'
import { RawMode } from '@/editor/RawMode'
import type { BodyEditorHandle } from '@/editor/useAutosave'
import { installLinkPicker } from '@/links/LinkPicker'
import { typeOf, useLinkIndex, ensureLinkIndex } from '@/links/linkIndex'
import { installWikilinkPresenter } from '@/links/wikilinkPresenter'
import { useTabs } from '@/nav/tabs'
import { ConflictDialog } from './ConflictDialog'
import { ObjectHeader } from './ObjectHeader'
import { PropertyPanel } from './PropertyPanel'

installWikilinkPresenter()
installLinkPicker()

export interface ObjectViewProps {
  path: string
  mode: 'page' | 'peek'
  /** Peek only: open the object as a page in the current tab. */
  onExpand?: () => void
  /** Called after an action that should dismiss the peek (e.g. open in new tab). */
  onDismiss?: () => void
  /** Bottom-right slot (the peek's pager). */
  footer?: ReactNode
}

function ToolButton({ label, icon, onClick }: { label: string; icon: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md text-fg hover:bg-hover"
    >
      <Icon name={icon} size={17} />
    </button>
  )
}

export function ObjectView({ path, mode, onExpand, onDismiss, footer }: ObjectViewProps) {
  const [detail, setDetail] = useState<ObjectDetail | null>(null)
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [deleted, setDeleted] = useState(false)
  /** An external change that collided with unsaved edits, awaiting keep-mine / take-theirs. */
  const [pending, setPending] = useState<{ mine: string; theirs: ObjectDetail } | null>(null)
  // Subscribe so the type chip and properties pick up types once the index loads.
  useLinkIndex((s) => s.revision)

  const editorRef = useRef<BodyEditorHandle | null>(null)
  /** The version the editor's next save is based on (mirrors `version` without waiting for a render). */
  const versionRef = useRef('')
  const adoptVersion = useCallback((v: string) => {
    versionRef.current = v
    setVersion(v)
  }, [])

  const load = useCallback(async () => {
    const d = await api.object(path)
    setDetail(d)
    adoptVersion(d.version)
    return d
  }, [path, adoptVersion])

  /**
   * The file changed on disk (`fromConflict`: a save was just rejected with 409).
   * A clean editor reloads; a dirty one keeps its edits and asks what to do.
   */
  const reconcile = useCallback(
    async (fromConflict: boolean) => {
      const h = editorRef.current
      // Stop autosave from racing the decision (it would only hit a 409 anyway).
      if (h && (fromConflict || h.isDirty())) h.hold()
      let theirs: ObjectDetail
      try {
        theirs = await api.object(path)
      } catch {
        return // gone or unreadable: a `deleted` event follows if it was removed
      }
      setDeleted(false)
      if (!fromConflict && theirs.version === versionRef.current) {
        if (h) void h.resume(theirs.version) // nothing new on disk: carry on saving
        return
      }
      const mine = h?.getBody() ?? null
      if (!h || mine === null || !h.isDirty()) {
        h?.reload(theirs.body, theirs.version)
        setDetail(theirs)
        adoptVersion(theirs.version)
        return
      }
      if (theirs.body === h.savedBody() || theirs.body === mine) {
        // Only the frontmatter changed (or both sides wrote the same text): no
        // conflict in the body. Keep the edits and save them on the new version.
        setDetail((d) => (d ? { ...theirs, body: d.body } : theirs))
        adoptVersion(theirs.version)
        void h.resume(theirs.version, fromConflict)
        return
      }
      setDetail((d) => (d ? { ...theirs, body: d.body } : theirs))
      setPending({ mine, theirs })
    },
    [path, adoptVersion],
  )

  // Change events arrive one at a time; handle them in order.
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const enqueue = useCallback(
    (fromConflict: boolean) => {
      queueRef.current = queueRef.current.then(() => reconcile(fromConflict)).catch(() => undefined)
    },
    [reconcile],
  )

  useEffect(() => {
    return api.onChange((e) => {
      if (e.path !== path) return
      if (e.kind === 'deleted') {
        editorRef.current?.hold()
        setDeleted(true)
        return
      }
      if (e.version && e.version === versionRef.current) return // our own write, or already loaded
      enqueue(false)
    })
  }, [path, enqueue])

  const keepMine = () => {
    const h = editorRef.current
    const p = pending
    setPending(null)
    if (!h || !p) return
    // Save my text against the version now on disk; a further conflict asks again.
    void h.resume(p.theirs.version, true)
  }

  const takeTheirs = () => {
    const h = editorRef.current
    const p = pending
    setPending(null)
    if (!p) return
    h?.reload(p.theirs.body, p.theirs.version)
    setDetail(p.theirs)
    adoptVersion(p.theirs.version)
  }

  useEffect(() => {
    let alive = true
    setDetail(null)
    setError(null)
    void ensureLinkIndex()
    api
      .object(path)
      .then((d) => {
        if (!alive) return
        setDetail(d)
        adoptVersion(d.version)
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [path, adoptVersion])

  const toggleRaw = async () => {
    // Re-read so the other mode starts from the saved text (the menu click already blurred and flushed).
    try {
      await load()
    } catch {
      /* keep what we have */
    }
    setRaw((r) => !r)
  }

  const summary = detail?.summary
  const type = typeOf(summary?.type)
  const readOnly = !!summary?.readOnly

  return (
    <div className="flex h-full min-h-0 w-full" data-object-view={mode}>
      {detail && panelOpen && <PropertyPanel type={type} frontmatter={detail.frontmatter} />}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-3 pt-3">
          <ToolButton
            label={panelOpen ? 'Hide properties' : 'Show properties'}
            icon="ph-sidebar-simple"
            onClick={() => setPanelOpen((v) => !v)}
          />
          <div className="flex items-center gap-0.5 rounded-xl border border-line px-1 py-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More"
                  title="More"
                  className="flex size-8 items-center justify-center rounded-md hover:bg-hover"
                >
                  <Icon name="ph-dots-three" size={18} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 border-line bg-raised">
                <DropdownMenuItem
                  onSelect={() => {
                    useTabs.getState().open({ kind: 'object', path }, { newTab: true })
                    onDismiss?.()
                  }}
                >
                  <Icon name="ph-arrow-square-out" size={16} />
                  Open in new tab
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void api.reveal(path).catch(() => undefined)}>
                  <Icon name="ph-folder-open" size={16} />
                  Reveal in Explorer
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={raw} onCheckedChange={() => void toggleRaw()}>
                  Raw Markdown
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {onExpand && <ToolButton label="Open as page" icon="ph-arrows-out-simple" onClick={onExpand} />}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[820px] px-12 pt-6 pb-24" data-object-path={path}>
            {error && (
              <div className="rounded-lg border border-line bg-raised p-4">
                <p className="font-semibold">Couldn't open this object.</p>
                <p className="mt-1 text-fg-muted">{error}</p>
              </div>
            )}
            {!detail && !error && <p className="text-fg-muted">Loading…</p>}
            {detail && summary && (
              <>
                <ObjectHeader summary={summary} type={type} />
                {readOnly && (
                  <div role="status" className="mb-4 rounded-lg border border-line bg-raised px-3 py-2 text-[14px] text-fg-muted">
                    This object's frontmatter couldn't be read, so it opens read-only. Fix the file to edit it.
                  </div>
                )}
                {deleted && (
                  <div role="alert" className="mb-4 rounded-lg border border-danger/60 bg-raised px-3 py-2 text-[14px]">
                    This object's file was deleted or moved on disk. Edits here aren't saved.
                  </div>
                )}
                <div className="text-[17px]">
                  {raw ? (
                    <RawMode
                      path={path}
                      text={detail.body}
                      version={version}
                      readOnly={readOnly}
                      onSaved={adoptVersion}
                      onConflict={() => enqueue(true)}
                      controlRef={editorRef}
                    />
                  ) : (
                    <Editor
                      path={path}
                      body={detail.body}
                      version={version}
                      readOnly={readOnly}
                      onSaved={adoptVersion}
                      onConflict={() => enqueue(true)}
                      controlRef={editorRef}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        {footer && <div className="absolute right-4 bottom-4">{footer}</div>}
        <ConflictDialog
          open={pending !== null}
          path={path}
          mine={pending?.mine ?? ''}
          theirs={pending?.theirs.body ?? ''}
          onKeepMine={keepMine}
          onTakeTheirs={takeTheirs}
        />
      </div>
    </div>
  )
}
