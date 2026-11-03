/**
 * An object's full view, shared by the page and the peek: property panel,
 * header and body editor (formatted or raw), with the `…` menu. `mode='inline'` (M4: the
 * calendar's daily note) renders only the body editor and its autosave.
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api, ConflictError, isResync } from '@/api/client'
import type { ObjectDetail, ObjectSummary, RenameResult, TypeDef, UpdateResult } from '@/api/types'
import { CollectionPicker } from '@/collections/CollectionPicker'
import { Icon } from '@/components/Icon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Editor } from '@/editor/Editor'
import { RecoveryDialog } from '@/editor/RecoveryDialog'
import { dropUnsaved, keptUnsaved } from '@/editor/unsaved'
import type { BodyEditorHandle } from '@/editor/useAutosave'
import { FindBar } from '@/find/FindBar'
import { useFind } from '@/find/useFind'
import { installLinkPicker } from '@/links/LinkPicker'
import { invalidateLinkIndex, typeOf, useLinkIndex, ensureLinkIndex } from '@/links/linkIndex'
import { installWikilinkPresenter } from '@/links/wikilinkPresenter'
import { formatKeys, keysFor } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'
import { canGoBack, usePeek, useTabs, type Target } from '@/nav/tabs'
import { ReferencesSection } from '@/references/ReferencesSection'
import { byPluralName, TypeChip } from '@/shell/Sidebar'
import { templatesAllowed } from '@/types/TemplateManager'
import { ChangeTypeDialog } from './ChangeTypeDialog'
import { ConflictDialog } from './ConflictDialog'
import { DeleteObjectDialog, DELETE_OBJECT_TEXT, useDeleteRequest } from './DeleteObjectDialog'
import { PinMenuItems } from '@/shell/PinToMenu'
import { DeletedBanner } from './DeletedBanner'
import { ExportDialog } from './ExportDialog'
import { TextStatsMenu } from './TextStatsMenu'
import { showToast } from '@/editor/media/upload'
import { TemplateMarker } from './TemplateMarker'
import { UseTemplateMenu, USE_TEMPLATE_TEXT } from './UseTemplateMenu'
import { ensureNewTags, isDailyNoteType, isTagType, ObjectHeader, openTag } from './ObjectHeader'
import { frontmatterLayout, objectWideLayout, PageLayout, pageDesign, type PanelVariant } from './PageLayout'
import { PropertyPanel } from './PropertyPanel'
import { useObjectWrites, type BodyControl } from './useObjectWrites'
import { useTypeEditor } from './useTypeEditor'
import { COLLECTION_ICON } from '@/lib/defIcons'
import { isTaskRoleType } from '@/editor/embed/ObjectEmbedView'
import { useFocusMode } from '@/focus/useFocusMode'
import { useVersionHistory } from '@/history/useVersionHistory'
import { useMerge } from '@/merge/useMerge'
import { usePresentation } from '@/present/usePresentation'
import { CompletionLog } from '@/tasks/CompletionLog'
import { TaskStatsSection } from '@/tasks/TaskStatsSection'
import { isWhiteboardType } from '@/whiteboard/isWhiteboard'

// Raw mode (CodeMirror) loads when first switched to, not with the shell (audit 2026-11-01 F1).
const RawMode = lazy(() => import('@/editor/RawMode').then((m) => ({ default: m.RawMode })))

installWikilinkPresenter()
installLinkPicker()

export interface ObjectViewProps {
  path: string
  mode: 'page' | 'peek' | 'inline'
  /** Inline only: muted text shown while the body is empty. */
  placeholder?: string
  /** Inline only: focus the editor once the object has loaded. */
  autoFocus?: boolean
  /** Called with each version this view adopts (load, saves, reloads). */
  onVersion?: (version: string) => void
  /**
   * Inline only: an element the owner provides for the object's `…` menu (the same menu as the
   * page's), drawn into it. The Calendar's Daily note header holds it beside Reviewed.
   */
  menuSlot?: HTMLElement | null
  /** Called after this view deleted the object (the owner drops it: the calendar shows "+ Daily Note"). */
  onDeleted?: () => void
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
  if ('lastUpdated' in fm) next.lastUpdated = str(fm.lastUpdated) ?? summary.lastUpdated
  return next
}

/** The `…` menu item (`EntityMenu.openInSidepanel`). */
export const OPEN_IN_SIDEPANEL_MENU_ITEM = 'Open in side panel'

/** The `…` menu item (`FindInPage.menuItem`). */
export const FIND_IN_PAGE_MENU_ITEM = 'Find in page'

/** M8 menu items and the focus-mode button (reference strings). */
export const OBJECT_M8_TEXT = {
  /** `EntityMenu.versionHistory.text` */
  versionHistory: 'Version History',
  /** `EntityMenu.mergeObject.text` */
  mergeObject: 'Merge into object',
  /** `EntityMenu.mergeTag.text` */
  mergeTag: 'Merge into tag',
  /** `EntityMenu.presentationMode.text` */
  present: 'Present',
  /** `Whiteboard.addTo.action` */
  addToWhiteboard: 'Add to whiteboard',
  /** `ComponentHeader.focusMode.enterLabel` */
  enterFocusMode: 'Enter Focus Mode',
  /** `ComponentHeader.focusMode.leaveLabel` */
  leaveFocusMode: 'Leave Focus Mode',
} as const

/** M9 menu items (reference strings). */
export const OBJECT_M9_TEXT = {
  /** `components.RootPagePage.enterWideMode` */
  wideLayout: 'Wide layout',
  /** `components.RootPagePage.leaveWideMode` */
  normalLayout: 'Normal layout',
  /** `EntityMenu.textStats.text` */
  textStats: 'Text Stats',
  /** `EntityMenu.openExportMenu.text` */
  export: 'Export',
  /** `EntityMenu.duplicateObject.text` */
  duplicate: 'Duplicate',
} as const

/** A menu row's keys, as Capacities draws them ("Ctrl Alt P", "Ctrl ⌫"): the registry's first key. */
function MenuKeys({ id }: { id: string }) {
  const keys = keysFor(id)
  if (!keys.length) return null
  const text = formatKeys(keys[0]).split('+').map((k) => (k === 'Backspace' ? '⌫' : k)).join(' ')
  return <DropdownMenuShortcut>{text}</DropdownMenuShortcut>
}

function ToolButton({ label, icon, onClick, pressed }: { label: string; icon: string; onClick?: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md text-fg hover:bg-hover"
    >
      <Icon name={icon} size={17} />
    </button>
  )
}

export function ObjectView({
  path,
  mode,
  onExpand,
  onDismiss,
  footer,
  placeholder,
  autoFocus,
  onVersion,
  menuSlot,
  onDeleted,
}: ObjectViewProps) {
  const [detail, setDetail] = useState<ObjectDetail | null>(null)
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  /** The pane toggled in this view; until then the object's own `hideProperties` decides. */
  const [paneToggled, setPaneToggled] = useState<boolean | null>(null)
  const [deleted, setDeleted] = useState(false)
  /** The Trash entry of this window's own delete ("Undo Delete"). */
  const [trashId, setTrashId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [collectionsOpen, setCollectionsOpen] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [changeTo, setChangeTo] = useState<TypeDef | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  /** Mirrors `deleted` for the change listener (which must not wait for a render). */
  const deletedRef = useRef(false)
  const markDeleted = useCallback((v: boolean) => {
    deletedRef.current = v
    setDeleted(v)
  }, [])
  /** An external change that collided with unsaved edits, awaiting keep-mine / take-theirs. */
  const [pending, setPending] = useState<{ mine: string; theirs: ObjectDetail } | null>(null)
  /** Edits kept when this object was last left unsaved (`editor/unsaved.ts`), offered on open. */
  const [recovery, setRecovery] = useState<{ kept: string; onDisk: string; error: string | null } | null>(null)
  /** Set while "Save changes" is writing the kept text. */
  const [savingKept, setSavingKept] = useState(false)
  const savingKeptRef = useRef(false)
  /** Mirrors `recovery` for `reconcile`. */
  const recoveryRef = useRef(recovery)
  recoveryRef.current = recovery
  /** The shown object's id, when known (kept unsaved text is tied to it). */
  const objectIdRef = useRef<string | null>(null)
  objectIdRef.current = detail?.summary.path === path ? detail.summary.id : null
  // Subscribe so the type chip and properties pick up types once the index loads.
  useLinkIndex((s) => s.revision)

  const editorRef = useRef<BodyEditorHandle | null>(null)
  /** The version the editor's next save is based on (mirrors `version` without waiting for a render). */
  const versionRef = useRef('')
  const onVersionRef = useRef(onVersion)
  onVersionRef.current = onVersion
  const adoptVersion = useCallback((v: string) => {
    versionRef.current = v
    setVersion(v)
    onVersionRef.current?.(v)
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
        // The recovery dialog compares the kept text with what is on disk: show the
        // new version, or close it when the file now holds the kept text.
        if (recoveryRef.current) {
          const kept = keptUnsaved(path, theirs.summary.id)
          if (kept === null || kept === theirs.body) {
            if (kept !== null) dropUnsaved(path, theirs.summary.id)
            setRecovery(null)
          } else {
            setRecovery({ kept, onDisk: theirs.body, error: null })
          }
        }
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
      // The stream reconnected: whatever happened meanwhile is unknown, so re-check the version
      // on disk (`reconcile` carries on when it is still ours).
      if (isResync(e, 'types')) {
        enqueue(false)
        return
      }
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
        if (e.kind === 'created') setTrashId(null)
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
    // Their version replaces my edits: any text kept from them is stale too.
    dropUnsaved(path, p.theirs.summary.id)
    h?.reload(p.theirs.body, p.theirs.version)
    setDetail(p.theirs)
    adoptVersion(p.theirs.version)
    unblockRef.current()
  }

  /** Offer the edits kept for this object, if any differ from what is on disk. */
  const offerKept = useCallback(
    (d: ObjectDetail) => {
      const kept = keptUnsaved(path, d.summary.id)
      if (kept === null) return
      if (kept === d.body) dropUnsaved(path, d.summary.id)
      else setRecovery({ kept, onDisk: d.body, error: null })
    },
    [path],
  )

  /** "Save changes": write the kept text over the version on disk and show it. */
  const saveKept = async () => {
    const r = recovery
    const h = editorRef.current
    // One save at a time: a second click would send the same text on the same version.
    if (!r || savingKeptRef.current) return
    savingKeptRef.current = true
    setSavingKept(true)
    h?.hold()
    try {
      const res = await api.saveBody(path, r.kept, versionRef.current)
      dropUnsaved(path, objectIdRef.current)
      setRecovery(null)
      h?.reload(r.kept, res.version)
      setDetail((d) => (d ? { ...d, body: r.kept, version: res.version } : d))
      adoptVersion(res.version)
    } catch (err) {
      if (err instanceof ConflictError) {
        // Changed again meanwhile: show the newest version and ask again.
        try {
          const d = await api.object(path)
          h?.reload(d.body, d.version)
          setDetail(d)
          adoptVersion(d.version)
          if (d.body === r.kept) {
            // The file already holds the kept text: nothing left to recover.
            dropUnsaved(path, d.summary.id)
            setRecovery(null)
          } else {
            setRecovery({ kept: r.kept, onDisk: d.body, error: null })
          }
        } catch {
          /* gone or unreadable: keep asking with what we have */
        }
      } else {
        setRecovery({ ...r, error: 'Could not save the changes.' })
      }
      void h?.resume(versionRef.current)
    } finally {
      savingKeptRef.current = false
      setSavingKept(false)
    }
  }

  const discardKept = () => {
    dropUnsaved(path, objectIdRef.current)
    setRecovery(null)
  }

  useEffect(() => {
    let alive = true
    blockedRef.current = false
    pendingRef.current = false
    setPending(null)
    setRecovery(null)
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
    setTrashId(null)
    markDeleted(false)
    void ensureLinkIndex()
    api
      .object(path)
      .then((d) => {
        if (!alive) return
        setDetail(d)
        adoptVersion(d.version)
        offerKept(d)
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [path, adoptVersion, markDeleted, offerKept])

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

  /** Save pending body edits; resolves with the version to send, or rejects while a conflict is open. */
  const settle = async (): Promise<string> => {
    const { ok } = await bodyControl.flush()
    if (!ok) throw new Error('Resolve the conflict first.')
    return versionRef.current
  }

  const deleteObject = async () => {
    const baseVersion = await settle()
    editorRef.current?.hold()
    try {
      const res = await api.deleteObject(path, { baseVersion })
      setTrashId(res.trashId)
      setUndoError(null)
      markDeleted(true)
      void invalidateLinkIndex()
      onDeleted?.()
    } catch (err) {
      void editorRef.current?.resume(versionRef.current)
      if (err instanceof ConflictError) {
        enqueueRef.current(false)
        throw new Error('The object changed on disk. It has been reloaded; try again.', { cause: err })
      }
      throw err
    }
  }

  const undoDelete = async () => {
    if (!trashId) return
    try {
      const res = await api.restore(trashId)
      setTrashId(null)
      const restored = res.paths?.[0]
      if (restored && restored !== path) useTabs.getState().retarget(path, restored)
      else enqueueRef.current(false)
      void invalidateLinkIndex()
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : String(err))
    }
  }

  const goBack = () => {
    if (mode === 'peek') {
      onDismiss?.()
      return
    }
    const tabs = useTabs.getState()
    if (canGoBack(tabs)) tabs.back()
  }

  const applyTemplate = async (templateId: string) => {
    try {
      const baseVersion = await settle()
      editorRef.current?.hold()
      await api.applyTemplate(path, templateId, baseVersion)
      const d = await api.object(path)
      editorRef.current?.reload(d.body, d.version)
      setDetail(d)
      adoptVersion(d.version)
    } catch (err) {
      if (err instanceof ConflictError) onConflict()
      else void editorRef.current?.resume(versionRef.current)
      console.warn('Could not apply the template:', err)
    }
  }

  const openTarget = (target: Target) => {
    useTabs.getState().open(target)
    onDismiss?.()
  }

  /** M9 "Duplicate": save pending edits, copy the file as "<Title> (Copy)", open the copy. */
  const duplicate = async () => {
    try {
      await settle()
      const res = await api.duplicateObject(path)
      void invalidateLinkIndex()
      openTarget({ kind: 'object', path: res.path })
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    }
  }

  // Ctrl+Backspace (handled by the app) asks the view showing this object to confirm a delete.
  const deleteRequest = useDeleteRequest((s) => s.request)
  useEffect(() => {
    if (deleteRequest && deleteRequest.path === path && deleteRequest.where === mode) {
      useDeleteRequest.getState().clear()
      if (!deletedRef.current) setDeleteOpen(true)
    }
  }, [deleteRequest, path, mode])

  // Ctrl+F opens Find in page for the active view: the peek, or the page while no peek is open.
  // Capture phase, so it works with the caret in the editor; preventDefault stops the browser's find.
  useEffect(() => {
    if (mode === 'inline') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return
      const peekPath = usePeek.getState().path
      if (mode === 'page' ? peekPath !== null : peekPath !== path) return
      e.preventDefault()
      useFind.getState().open(path)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [mode, path])

  // M9: the page inspector reads the editor's current Markdown (the loaded body before it mounts).
  const loadedBodyRef = useRef('')
  loadedBodyRef.current = detail?.body ?? ''
  const getMarkdown = useCallback(() => editorRef.current?.getBody() ?? loadedBodyRef.current, [])

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
  // Polish item 17: the pane toggle is per object (Capacities' `ComponentData.hideProperties`):
  // hiding saves `hideProperties: true`, showing removes the key. Read-only: this view only.
  const panelOpen = paneToggled ?? detail?.frontmatter.hideProperties !== true
  const togglePanel = () => {
    const next = !panelOpen
    setPaneToggled(next)
    if (!propsReadOnly && detail) writeProperties({ hideProperties: next ? null : true })
  }
  const onTypeChange = (next: TypeDef) => typeEditor.save(next)
  const onOpenTag = (name: string) => void openTag(name).catch(() => undefined)
  const onOpenObject = (p: string) => useTabs.getState().open({ kind: 'object', path: p })

  const allTypes = useLinkIndex((s) => s.types)
  const otherTypes = allTypes.filter((t) => t.id !== summary?.type).sort(byPluralName)
  const isTemplate = summary?.template != null
  const canTemplate = !!type && !isTemplate && templatesAllowed(type)
  const isTag = !!summary && isTagType(type, summary.type)
  const isTask = !!summary && !isTemplate && isTaskRoleType(type, summary.type)
  const focusOn = useFocusMode((s) => s.on)
  // M9: the object's own layout keys override the type's.
  const layout = detail ? frontmatterLayout(detail.frontmatter) : undefined
  const wideOn = objectWideLayout(type, layout)
  /** Capacities hides "Wide layout" for whiteboards and the index card design. */
  const canWide = !!summary && pageDesign(type) !== 'indexCard' && !isWhiteboardType(type)
  const dailyNote = !!summary && isDailyNoteType(type, summary.type)
  /** Capacities offers no Duplicate for daily notes and templates; whiteboards are ours to refuse. */
  const canDuplicate = !!summary && !isTemplate && !dailyNote && !isWhiteboardType(type)

  // A render function: the layout picks the variant (inline as a card when the page is narrow).
  const properties =
    detail && panelOpen ? (variant: PanelVariant) => (
      <>
      <PropertyPanel
        type={type}
        frontmatter={detail.frontmatter}
        links={detail.links}
        summary={detail.summary}
        backlinks={detail.backlinks ?? []}
        readOnly={propsReadOnly}
        onChange={(key, value) => writeProperties({ [key]: value })}
        onChangeMany={(u, r) => void writes.updateProperties(u, r)}
        onSetReminder={(key, remind) => void writes.setReminder(key, remind)}
        onTypeChange={onTypeChange}
        onOpenTag={onOpenTag}
        onOpenObject={onOpenObject}
        variant={variant}
      />
      {/* M8: "Task Stats" under the property panel of a recurring task-role object. */}
      {isTask && typeof detail.frontmatter.repeat === 'string' && detail.frontmatter.repeat.trim() !== '' && (
        <>
          <TaskStatsSection path={path} version={version} />
          {/* "Completion Log": deleting an entry writes only the log's remaining lines. */}
          <CompletionLog
            log={typeof detail.frontmatter.occurrenceLog === 'string' ? detail.frontmatter.occurrenceLog : null}
            readOnly={propsReadOnly}
            onChange={(next) =>
              void (next === null
                ? writes.updateProperties({}, ['occurrenceLog'])
                : writes.updateProperties({ occurrenceLog: next }))
            }
          />
        </>
      )}
      </>
    ) : null

  // The `…` menu: in the page and peek toolbar, and (inline mode) in a slot the owner provides.
  const objectMenu = (
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
            <DropdownMenuItem
              onSelect={() => {
                useTabs.getState().openInSidepanel({ kind: 'object', path })
                onDismiss?.()
              }}
            >
              <Icon name="ph-square-split-horizontal" size={14} />
              {OPEN_IN_SIDEPANEL_MENU_ITEM}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void api.reveal(path).catch(() => undefined)}>
              <Icon name="ph-folder-open" size={14} />
              Reveal in Explorer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useFind.getState().open(path)}>
              <Icon name="ph-magnifying-glass" size={14} />
              {FIND_IN_PAGE_MENU_ITEM}
              <MenuKeys id="findInPage" />
            </DropdownMenuItem>
            <PinMenuItems pin={{ kind: 'object', path, id: summary?.id }} />
            <DropdownMenuItem
              disabled={!summary}
              onSelect={() => {
                usePresentation.getState().start(path)
                onDismiss?.()
              }}
            >
              <Icon name="ph-presentation" size={14} />
              {OBJECT_M8_TEXT.present}
              <MenuKeys id="openPresentationMode" />
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!summary} onSelect={() => setExportOpen(true)}>
              <Icon name="ph-export" size={14} />
              {OBJECT_M9_TEXT.export}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!summary} onSelect={() => useVersionHistory.getState().open(path)}>
              <Icon name="ph-clock-counter-clockwise" size={14} />
              {OBJECT_M8_TEXT.versionHistory}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!summary}>
                <Icon name="ph-chart-bar" size={14} />
                {OBJECT_M9_TEXT.textStats}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="border-line bg-raised">
                {summary && <TextStatsMenu getMarkdown={getMarkdown} summary={summary} dailyNote={dailyNote} />}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              disabled={!summary || isTemplate}
              // The dialog's module (and the whiteboard code behind it) loads on first use.
              onSelect={() => void import('@/whiteboard/AddToWhiteboardDialog').then((m) => m.useAddToWhiteboard.getState().open(path))}
            >
              <Icon name="ph-chalkboard-simple" size={14} />
              {OBJECT_M8_TEXT.addToWhiteboard}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={propsReadOnly || !summary || isTemplate}>
                <Icon name="ph-swap" size={14} />
                Change type
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[360px] overflow-auto border-line bg-raised">
                {otherTypes.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => setChangeTo(t)}>
                    <TypeChip type={t} size={18} />
                    {t.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {canTemplate && type && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={propsReadOnly}>
                  <Icon name="ph-file-dashed" size={14} />
                  {USE_TEMPLATE_TEXT.menu}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="border-line bg-raised">
                  <UseTemplateMenu
                    type={type}
                    editor={typeEditor}
                    onApply={(id) => void applyTemplate(id)}
                    onEdit={(p) => openTarget({ kind: 'object', path: p })}
                    onCreated={(p) => openTarget({ kind: 'object', path: p })}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuItem
              disabled={propsReadOnly || !summary || isTemplate}
              onSelect={() => setCollectionsOpen(true)}
            >
              <Icon name={COLLECTION_ICON} size={14} />
              Edit Collections
            </DropdownMenuItem>
            {canDuplicate && (
              <DropdownMenuItem disabled={propsReadOnly} onSelect={() => void duplicate()}>
                <Icon name="ph-copy" size={14} />
                {OBJECT_M9_TEXT.duplicate}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={propsReadOnly || !summary || isTemplate}
              onSelect={() => useMerge.getState().open(path)}
            >
              <Icon name="ph-git-merge" size={14} />
              {isTag ? OBJECT_M8_TEXT.mergeTag : OBJECT_M8_TEXT.mergeObject}
            </DropdownMenuItem>
            {type && (
              <DropdownMenuItem data-structure-setting="" onSelect={() => openTarget({ kind: 'typeSettings', typeId: type.id })}>
                <Icon name="ph-gear-six" size={14} />
                Object Type Settings
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {canWide && (
              <DropdownMenuItem
                disabled={propsReadOnly}
                onSelect={() => writeProperties({ wideLayoutMode: !wideOn })}
              >
                <Icon name={wideOn ? 'ph-arrows-in-simple' : 'ph-arrows-out-simple'} size={14} />
                {wideOn ? OBJECT_M9_TEXT.normalLayout : OBJECT_M9_TEXT.wideLayout}
              </DropdownMenuItem>
            )}
            <DropdownMenuCheckboxItem checked={raw} onCheckedChange={() => void toggleRaw()}>
              Raw Markdown
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={propsReadOnly || !summary}
              onSelect={() => setDeleteOpen(true)}
            >
              <Icon name="ph-trash" size={14} />
              {DELETE_OBJECT_TEXT.action}
              <MenuKeys id="deleteCurrentPage" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
  )

  const toolbar = (
    <div data-typing-fade="" className="flex items-center justify-between px-3.5 pt-3.5">
      <button
        type="button"
        aria-label={panelOpen ? 'Hide properties' : 'Show properties'}
        title={panelOpen ? 'Hide properties' : 'Show properties'}
        aria-pressed={panelOpen}
        onClick={togglePanel}
        className="flex size-10 items-center justify-center rounded-[11px] border border-[var(--float-btn-border)] bg-[var(--float-bg)] p-[3px] text-fg"
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
      <div className="flex min-w-0 items-center gap-2">
      <FindBar path={path} editorRef={editorRef} />
      <div className="flex h-10 shrink-0 items-center gap-0.5 rounded-xl border border-[var(--float-border)] bg-[var(--float-bg)] px-1">
        {mode === 'page' && (
          <ToolButton
            label={focusOn ? OBJECT_M8_TEXT.leaveFocusMode : OBJECT_M8_TEXT.enterFocusMode}
            icon={focusOn ? 'ph-arrows-in-simple' : 'ph-frame-corners'}
            pressed={focusOn}
            onClick={() => useFocusMode.getState().toggle()}
          />
        )}
        {objectMenu}
        {onExpand && <ToolButton label="Open as page" icon="ph-arrows-out-simple" onClick={onExpand} />}
      </div>
      </div>
    </div>
  )

  // Inline mode: the placeholder while the body is empty, and focus once loaded.
  const inlineRef = useRef<HTMLDivElement | null>(null)
  const [bodyEmpty, setBodyEmpty] = useState(true)
  const loadedBody = detail?.body
  useEffect(() => {
    if (loadedBody !== undefined) setBodyEmpty(loadedBody.trim() === '')
  }, [loadedBody])
  const focusedRef = useRef(false)
  const hasDetail = detail !== null
  useEffect(() => {
    if (mode !== 'inline' || !autoFocus || !hasDetail || focusedRef.current) return
    const el = inlineRef.current?.querySelector<HTMLElement>('.ProseMirror')
    if (el) {
      focusedRef.current = true
      el.focus()
    }
  }, [mode, autoFocus, hasDetail])

  const recoveryDialog = (
    <RecoveryDialog
      open={recovery !== null}
      path={path}
      kept={recovery?.kept ?? ''}
      onDisk={recovery?.onDisk ?? ''}
      error={recovery?.error}
      saving={savingKept}
      onSave={() => void saveKept()}
      onDiscard={discardKept}
    />
  )

  const overlays = (
    <>
      {footer && <div className="absolute right-4 bottom-4">{footer}</div>}
      <ConflictDialog
        open={pending !== null}
        path={path}
        mine={pending?.mine ?? ''}
        theirs={pending?.theirs.body ?? ''}
        onKeepMine={keepMine}
        onTakeTheirs={takeTheirs}
      />
      {recoveryDialog}
      {typeEditor.dialog}
      <DeleteObjectDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={deleteObject} />
      {exportOpen && <ExportDialog open onOpenChange={setExportOpen} path={path} prepare={settle} />}
      {summary && (
        <Dialog open={collectionsOpen} onOpenChange={setCollectionsOpen}>
          <DialogContent className="w-auto border-line bg-raised p-0 text-fg sm:max-w-none">
            <DialogTitle className="sr-only">Edit Collections</DialogTitle>
            <DialogDescription className="sr-only">Choose the collections this object belongs to.</DialogDescription>
            <CollectionPicker
              value={summary.collections ?? []}
              typeId={summary.type}
              onChange={(next) => writeProperties({ collections: next })}
            />
          </DialogContent>
        </Dialog>
      )}
      {changeTo && (
        <ChangeTypeDialog
          open
          onOpenChange={(o) => !o && setChangeTo(null)}
          path={path}
          toType={changeTo}
          prepare={async () => {
            const v = await settle()
            editorRef.current?.hold()
            return v
          }}
          onAbort={(err) => {
            void editorRef.current?.resume(versionRef.current)
            if (err instanceof ConflictError) enqueueRef.current(false)
          }}
          onChanged={(res) => {
            void invalidateLinkIndex()
            if (res.path !== path) {
              renamedToRef.current = res.path
              useTabs.getState().retarget(path, res.path)
            } else {
              void load().then((d) => editorRef.current?.reload(d.body, d.version))
            }
          }}
        />
      )}
    </>
  )

  if (mode === 'inline') {
    // Emptiness from the editor's DOM first: any text, or any block but a paragraph (an image,
    // a divider, an embed: each writes Markdown of its own), means not empty, with no
    // serialising of the body (this ran twice per keystroke, on input and keyup). Only a
    // document of textless paragraphs is serialised.
    const checkEmpty = () => {
      const pm = inlineRef.current?.querySelector('.ProseMirror')
      if (pm && ((pm.textContent ?? '').trim() !== '' || [...pm.children].some((c) => c.tagName !== 'P'))) {
        setBodyEmpty(false)
        return
      }
      const b = editorRef.current?.getBody()
      if (b != null) setBodyEmpty(b.trim() === '')
    }
    return (
      <div className="relative w-full" data-object-view="inline" data-object-path={path} ref={inlineRef}>
        {!detail || !summary ? (
          error ? (
            <p className="text-[14px] text-fg-muted">{`Couldn't open this object. ${error}`}</p>
          ) : (
            <p className="text-[14px] text-fg-muted">Loading…</p>
          )
        ) : (
          <>
            {deleted && (
              <div role="alert" className="mb-3 rounded-lg border border-danger/60 bg-raised px-3 py-2 text-[14px]">
                This object's file was deleted or moved on disk. Edits here aren't saved.
              </div>
            )}
            <div className="object-body-text relative" onInput={checkEmpty} onKeyUp={checkEmpty} onBlur={checkEmpty}>
              {placeholder && bodyEmpty && (
                <div aria-hidden data-testid="inline-placeholder" className="pointer-events-none absolute top-0 left-0 text-fg-muted">
                  {placeholder}
                </div>
              )}
              <Editor
                path={path}
                body={detail.body}
                version={version}
                readOnly={readOnly || deleted}
                onSaved={adoptVersion}
                onConflict={onConflict}
                objectId={detail.summary.path === path ? detail.summary.id : undefined}
                controlRef={editorRef}
                ownPlaceholder={!placeholder}
              />
            </div>
          </>
        )}
        {/* The conflict and recovery dialogs, and the ones the `…` menu opens (delete, export, ...). */}
        {overlays}
        {menuSlot && summary && createPortal(objectMenu, menuSlot)}
      </div>
    )
  }

  if (!detail || !summary) {
    return (
      <div className="flex h-full min-h-0 w-full" data-object-view={mode}>
        <div className="relative flex min-w-0 flex-1 flex-col">
          {toolbar}
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[var(--page-content-width)] px-12 pt-10 pb-24" data-object-path={path}>
              {error ? (
                <div className="rounded-lg border border-line bg-raised p-4">
                  <p className="font-semibold">Couldn't open this object.</p>
                  <p className="mt-1 text-fg-muted">{error}</p>
                </div>
              ) : (
                <p className="text-fg-muted">Loading…</p>
              )}
            </div>
          </div>
          {overlays}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 w-full" data-object-view={mode}>
      <PageLayout
        type={type}
        summary={summary}
        mode={mode}
        toolbar={toolbar}
        properties={properties}
        onCoverChange={
          propsReadOnly
            ? undefined
            : (next) =>
                // A new image drops the old one's position (Capacities' `referenceImageId` rule).
                writeProperties(
                  'coverImageOffset' in detail.frontmatter
                    ? { coverImage: next, coverImageOffset: null }
                    : { coverImage: next },
                )
        }
        layout={layout}
        onLayoutChange={propsReadOnly ? undefined : (patch) => writeProperties({ ...patch })}
        inspector={mode === 'page' ? { getMarkdown, dailyNote } : undefined}
        header={
          <ObjectHeader
            summary={summary}
            type={type}
            readOnly={propsReadOnly}
            onRename={(title) => void writes.rename(title)}
            onPropertiesChange={writeProperties}
            onOpenTag={onOpenTag}
          />
        }
        body={
          <>
            {readOnly && (
              <div role="status" className="mb-4 rounded-lg border border-line bg-raised px-3 py-2 text-[14px] text-fg-muted">
                {summary.readOnlyReason
                  ? `This object opens read-only: ${summary.readOnlyReason}. Fix the file to edit it.`
                  : "This object's frontmatter couldn't be read, so it opens read-only. Fix the file to edit it."}
              </div>
            )}
            {isTemplate && (
              <TemplateMarker
                summary={summary}
                type={type}
                editor={typeEditor}
                readOnly={propsReadOnly}
                onRename={(name) => writeProperties({ template: name })}
                onManage={() => type && openTarget({ kind: 'typeSettings', typeId: type.id })}
              />
            )}
            {deleted && trashId && (
              <DeletedBanner onBack={goBack} onUndo={() => void undoDelete()} error={undoError} />
            )}
            {deleted && !trashId && (
              <div role="alert" className="mb-4 rounded-lg border border-danger/60 bg-raised px-3 py-2 text-[14px]">
                This object's file was deleted or moved on disk. Edits here aren't saved.
              </div>
            )}
            <div className="object-body-text">
              {raw ? (
                <Suspense fallback={null}>
                  <RawMode
                    path={path}
                    text={detail.body}
                    version={version}
                    readOnly={readOnly}
                    onSaved={adoptVersion}
                    onConflict={onConflict}
                    objectId={detail.summary.path === path ? detail.summary.id : undefined}
                    controlRef={editorRef}
                  />
                </Suspense>
              ) : (
                <Editor
                  path={path}
                  body={detail.body}
                  version={version}
                  readOnly={readOnly}
                  onSaved={adoptVersion}
                  onConflict={onConflict}
                  objectId={detail.summary.path === path ? detail.summary.id : undefined}
                  controlRef={editorRef}
                />
              )}
            </div>
            <ReferencesSection path={path} summary={summary} type={type} />
          </>
        }
      >
        {overlays}
      </PageLayout>
    </div>
  )
}
