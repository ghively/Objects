/**
 * An object's full view, shared by the page and the peek: property panel,
 * header and body editor (formatted or raw), with the `…` menu.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { ObjectDetail, ObjectSummary, RenameResult, TypeDef, UpdateResult } from '@/api/types'
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
import { cn } from '@/lib/utils'
import { useTabs } from '@/nav/tabs'
import { ConflictDialog } from './ConflictDialog'
import { ensureNewTags, ObjectHeader, openTag } from './ObjectHeader'
import { PropertyPanel } from './PropertyPanel'
import { useObjectWrites, type BodyControl } from './useObjectWrites'
import { useTypeEditor } from './useTypeEditor'

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

/** The summary fields a property write changes, read back from the written frontmatter. */
export function patchSummary(summary: ObjectSummary, fm: Record<string, unknown>): ObjectSummary {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  const list = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]).filter((x) => x != null).map(String)
  const next = { ...summary }
  if ('title' in fm) next.title = str(fm.title) ?? summary.title
  if ('icon' in fm) next.icon = str(fm.icon)
  if ('icon' in fm || 'iconColor' in fm) next.iconColor = str(fm.iconColor)
  if ('description' in fm) next.description = str(fm.description)
  if ('aliases' in fm) next.aliases = list(fm.aliases)
  if ('tags' in fm) next.tags = list(fm.tags)
  if ('coverImage' in fm) next.coverImage = str(fm.coverImage)
  if ('color' in fm) next.color = str(fm.color)
  return next
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
  /** Mirrors `deleted` for the change listener (which must not wait for a render). */
  const deletedRef = useRef(false)
  const markDeleted = useCallback((v: boolean) => {
    deletedRef.current = v
    setDeleted(v)
  }, [])
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

  /**
   * True while a conflict (a body save or a property write rejected with 409, or an external
   * change colliding with unsaved edits) is unresolved: property writes wait for it.
   */
  const blockedRef = useRef(false)
  /** Mirrors `pending` for callbacks that must not wait for a render. */
  const pendingRef = useRef(false)
  /** The path our own rename moved this object to (its reload keeps the view on screen). */
  const renamedToRef = useRef<string | null>(null)

  const bodyControl = useRef<BodyControl>({
    flush: async () => {
      if (!blockedRef.current) {
        try {
          await editorRef.current?.flush()
        } catch {
          /* the save reported its own error */
        }
      }
      return { ok: !blockedRef.current }
    },
    resume: (v: string) => editorRef.current?.resume(v),
  }).current

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
      markDeleted(false)
      if (!fromConflict && theirs.version === versionRef.current) {
        if (h) void h.resume(theirs.version) // nothing new on disk: carry on saving
        return
      }
      const mine = h?.getBody() ?? null
      if (!h || mine === null || !h.isDirty()) {
        h?.reload(theirs.body, theirs.version)
        setDetail(theirs)
        adoptVersion(theirs.version)
        unblockRef.current()
        return
      }
      if (theirs.body === h.savedBody() || theirs.body === mine) {
        // Only the frontmatter changed (or both sides wrote the same text): no
        // conflict in the body. Keep the edits and save them on the new version.
        setDetail((d) => (d ? { ...theirs, body: d.body } : theirs))
        adoptVersion(theirs.version)
        void h.resume(theirs.version, fromConflict)
        unblockRef.current()
        return
      }
      setDetail((d) => (d ? { ...theirs, body: d.body } : theirs))
      blockedRef.current = true
      pendingRef.current = true
      setPending({ mine, theirs })
    },
    [path, adoptVersion, markDeleted],
  )

  const onConflict = useCallback(() => {
    blockedRef.current = true
    enqueueRef.current(true)
  }, [])

  const writes = useObjectWrites({
    path,
    versionRef,
    bodyControl,
    adoptVersion,
    onConflict,
    onUpdated: (res: UpdateResult, _updates, remove) => {
      setDetail((d) => {
        if (!d) return d
        const frontmatter = { ...d.frontmatter, ...res.frontmatter }
        for (const k of remove) delete frontmatter[k]
        return {
          ...d,
          frontmatter,
          links: { ...d.links, ...res.links },
          summary: patchSummary(d.summary, res.frontmatter),
          version: res.version,
        }
      })
    },
    onRenamed: (res: RenameResult, oldPath: string, title: string) => {
      // The title changed even when the path didn't (safe_filename may map both titles to one name).
      setDetail((d) =>
        d
          ? {
              ...d,
              frontmatter: { ...d.frontmatter, title },
              summary: { ...d.summary, path: res.path, title },
              version: res.version,
            }
          : d,
      )
      if (res.path !== oldPath) {
        renamedToRef.current = res.path
        useTabs.getState().retarget(oldPath, res.path)
      }
    },
  })

  /** The conflict is resolved: property writes queued behind it are sent on the new version. */
  const replay = writes.replay
  const unblock = useCallback(() => {
    if (pendingRef.current) return
    blockedRef.current = false
    replay()
  }, [replay])
  const unblockRef = useRef(unblock)
  useLayoutEffect(() => {
    unblockRef.current = unblock
  }, [unblock])

  // Change events arrive one at a time; handle them in order.
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const enqueue = useCallback(
    (fromConflict: boolean) => {
      queueRef.current = queueRef.current.then(() => reconcile(fromConflict)).catch(() => undefined)
    },
    [reconcile],
  )
  const enqueueRef = useRef(enqueue)
  useLayoutEffect(() => {
    enqueueRef.current = enqueue
  }, [enqueue])

  useEffect(() => {
    return api.onChange((e) => {
      if (e.path !== path) return
      if (e.kind === 'deleted') {
        editorRef.current?.hold()
        markDeleted(true)
        return
      }
      // The file is back (stash pop, branch switch, undo elsewhere), perhaps with
      // the very bytes we last knew: reconcile anyway, which clears the banner and
      // resumes autosave even when the version is unchanged.
      if (e.kind === 'created' || deletedRef.current) {
        enqueue(false)
        return
      }
      if (e.version && e.version === versionRef.current) return // our own write, or already loaded
      enqueue(false)
    })
  }, [path, enqueue, markDeleted])

  const keepMine = () => {
    const h = editorRef.current
    const p = pending
    setPending(null)
    pendingRef.current = false
    if (!h || !p) return
    // Save my text against the version now on disk; a further conflict asks again.
    adoptVersion(p.theirs.version)
    void h.resume(p.theirs.version, true)
    unblockRef.current()
  }

  const takeTheirs = () => {
    const h = editorRef.current
    const p = pending
    setPending(null)
    pendingRef.current = false
    if (!p) return
    h?.reload(p.theirs.body, p.theirs.version)
    setDetail(p.theirs)
    adoptVersion(p.theirs.version)
    unblockRef.current()
  }

  useEffect(() => {
    let alive = true
    blockedRef.current = false
    pendingRef.current = false
    setPending(null)
    if (renamedToRef.current === path) {
      // Our own rename: keep showing the object while its new path loads.
      renamedToRef.current = null
      api
        .object(path)
        .then((d) => {
          if (!alive) return
          setDetail(d)
          adoptVersion(d.version)
        })
        .catch(() => undefined)
      return () => {
        alive = false
      }
    }
    setDetail(null)
    setError(null)
    markDeleted(false)
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
  }, [path, adoptVersion, markDeleted])

  const toggleRaw = async () => {
    // Save everything first (and wait for saves already in flight or queued),
    // then stop this mode saving, so the re-read below is what's on disk and no
    // late save from this mode can land after the other mode has loaded.
    const h = editorRef.current
    try {
      await h?.flush()
    } catch {
      /* the save reported its own error */
    }
    h?.hold()
    try {
      await load()
    } catch {
      /* keep what we have */
    }
    setRaw((r) => !r)
  }

  const summary = detail?.summary
  const typeEditor = useTypeEditor(summary?.type)
  const type = typeEditor.type ?? typeOf(summary?.type)
  const readOnly = !!summary?.readOnly
  /** Properties and the title can't be written while the file is gone. */
  const propsReadOnly = readOnly || deleted

  const writeProperties = (updates: Record<string, unknown>) => {
    if ('tags' in updates && Array.isArray(updates.tags)) {
      ensureNewTags(detail?.summary.tags ?? [], updates.tags as string[])
    }
    void writes.updateProperties(updates)
  }
  const onTypeChange = (next: TypeDef) => typeEditor.save(next)
  const onOpenTag = (name: string) => void openTag(name).catch(() => undefined)
  const onOpenObject = (p: string) => useTabs.getState().open({ kind: 'object', path: p })

  return (
    <div className="flex h-full min-h-0 w-full" data-object-view={mode}>
      {detail && panelOpen && (
        <PropertyPanel
          type={type}
          frontmatter={detail.frontmatter}
          links={detail.links}
          summary={detail.summary}
          readOnly={propsReadOnly}
          onChange={(key, value) => writeProperties({ [key]: value })}
          onTypeChange={onTypeChange}
          onOpenTag={onOpenTag}
          onOpenObject={onOpenObject}
        />
      )}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-3.5 pt-3.5">
          <button
            type="button"
            aria-label={panelOpen ? 'Hide properties' : 'Show properties'}
            title={panelOpen ? 'Hide properties' : 'Show properties'}
            aria-pressed={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
            className="flex size-10 items-center justify-center rounded-[11px] border border-[#29282d] bg-[#18181b] p-[3px] text-fg"
          >
            <span
              className={cn(
                'flex size-full items-center justify-center rounded-lg hover:bg-hover',
                panelOpen && 'bg-line hover:bg-line',
              )}
            >
              <Icon name="ph-sidebar-simple" size={17} />
            </span>
          </button>
          <div className="flex h-10 items-center gap-0.5 rounded-xl border border-[#232226] bg-[#18181b] px-1">
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
              <DropdownMenuContent align="end" className="w-[272px] border-line bg-raised">
                <DropdownMenuItem
                  onSelect={() => {
                    useTabs.getState().open({ kind: 'object', path }, { newTab: true })
                    onDismiss?.()
                  }}
                >
                  <Icon name="ph-arrow-square-out" size={14} />
                  Open in new tab
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void api.reveal(path).catch(() => undefined)}>
                  <Icon name="ph-folder-open" size={14} />
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
          <div className="mx-auto w-full max-w-[820px] px-12 pt-10 pb-24" data-object-path={path}>
            {error && (
              <div className="rounded-lg border border-line bg-raised p-4">
                <p className="font-semibold">Couldn't open this object.</p>
                <p className="mt-1 text-fg-muted">{error}</p>
              </div>
            )}
            {!detail && !error && <p className="text-fg-muted">Loading…</p>}
            {detail && summary && (
              <>
                <ObjectHeader
                  summary={summary}
                  type={type}
                  readOnly={propsReadOnly}
                  onRename={(title) => void writes.rename(title)}
                  onPropertiesChange={writeProperties}
                  onOpenTag={onOpenTag}
                />
                {readOnly && (
                  <div role="status" className="mb-4 rounded-lg border border-line bg-raised px-3 py-2 text-[14px] text-fg-muted">
                    {summary.readOnlyReason
                      ? `This object opens read-only: ${summary.readOnlyReason}. Fix the file to edit it.`
                      : "This object's frontmatter couldn't be read, so it opens read-only. Fix the file to edit it."}
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
                      onConflict={onConflict}
                      controlRef={editorRef}
                    />
                  ) : (
                    <Editor
                      path={path}
                      body={detail.body}
                      version={version}
                      readOnly={readOnly}
                      onSaved={adoptVersion}
                      onConflict={onConflict}
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
        {typeEditor.dialog}
      </div>
    </div>
  )
}
