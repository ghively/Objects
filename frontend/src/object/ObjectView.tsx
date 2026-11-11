/**
 * An object's full view, shared by the page and the peek: property panel,
 * header and body editor (formatted or raw), with the `…` menu. `mode='inline'` (M4: the
 * calendar's daily note) renders only the body editor and its autosave.
 */
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core'
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api, ConflictError, isResync } from '@/api/client'
import { openAiChat, useAiHidden } from '@/ai/store'
import {
  COMPUTED_KINDS,
  type ObjectDetail,
  type ObjectSummary,
  type PropertyType,
  type RenameResult,
  type ResolutionNote,
  type TypeDef,
  type UpdateResult,
  type WorkWriteResult,
} from '@/api/types'
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
import { dropRenaming, dropUnsaved, keepRenaming, keepUnsaved, keptUnsaved } from '@/editor/unsaved'
import type { BodyEditorHandle } from '@/editor/useAutosave'
import { FindBar } from '@/find/FindBar'
import { useFind } from '@/find/useFind'
import { installLinkPicker } from '@/links/LinkPicker'
import { invalidateLinkIndex, typeOf, useLinkIndex, ensureLinkIndex } from '@/links/linkIndex'
import { installWikilinkPresenter } from '@/links/wikilinkPresenter'
import { formatKeys, isEditableTarget, keysFor, matches } from '@/lib/shortcuts'
import { typeLabel } from '@/lib/typeLabel'
import { cn } from '@/lib/utils'
import { NOTE_LOWER, TYPE_SETTINGS } from '@/lib/words'
import { revealMenuLabel } from '@/lib/platformText'
import { takeBodyFocus } from '@/nav/focusRequest'
import { canGoBack, usePeek, useTabs, type Target } from '@/nav/tabs'
import { ReferencesSection } from '@/references/ReferencesSection'
import { byPluralName, TypeChip } from '@/shell/Sidebar'
import { templatesAllowed } from '@/types/TemplateManager'
import { ChangeTypeDialog } from './ChangeTypeDialog'
import { ConflictDialog } from './ConflictDialog'
import { DeleteObjectDialog, DELETE_OBJECT_TEXT, useDeleteRequest } from './DeleteObjectDialog'
import { PinMenuItems } from '@/shell/PinToMenu'
import { pinnedActions, useUiStore } from '@/shell/usePinned'
import { ImportCsvDialog } from '@/types/ImportCsvDialog'
import { wikilinkMarkdown } from '@/editor/extensions/wikilink'
import { DeletedBanner } from './DeletedBanner'
import { ExportDialog } from './ExportDialog'
import { TextStatsMenu } from './TextStatsMenu'
import { showToast } from '@/editor/media/upload'
import { lazyWithReload } from '@/lib/lazyReload'
import { TemplateMarker } from './TemplateMarker'
import { UseTemplateMenu, USE_TEMPLATE_TEXT } from './UseTemplateMenu'
import { ensureNewTags, HeaderTags, isDailyNoteType, isTagType, ObjectHeader, openTag } from './ObjectHeader'
import { keyIsForView, usePageShortcuts } from './pageShortcuts'
import { frontmatterLayout, objectWideLayout, PageLayout, pageDesign, type PanelVariant } from './PageLayout'
import { ImportSourceLine, importSourceOf } from './ImportSourceLine'
import { counterpartEditor } from './CounterpartRows'
import {
  bodyEditorOf,
  caretAtBodyStart,
  caretInTopLevelBlock,
  focusBody,
  focusBodyEnd,
  focusedBodyCaret,
} from './bodyCaret'
import { claimHandover, dropHandover, focusedTitle, handOver, peekHandover } from './renameHandover'
import { retitledBody } from './titleHeading'
import { typeHasOwnProperties } from './ownProperties'
import { PropertyPanel } from './PropertyPanel'
import { clearTitleSaveState, setTitleSaveState } from '@/editor/saveStateStore'
import { SaveMark } from './SaveMark'
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
import { isWorkType } from '@/types/WorkFieldsSection'
import { ResolutionNoteSection } from '@/work/ResolutionNote'
import { WorkHeader } from '@/work/panel/WorkHeader'
import { useWorkOn } from '@/work/useWorkOn'
import { useSettings } from '@/settings/useSettings'

// Raw mode (CodeMirror) loads when first switched to, not with the shell (audit 2026-11-01 F1).
const RawMode = lazyWithReload(() => import('@/editor/RawMode').then((m) => ({ default: m.RawMode })))

installWikilinkPresenter()
installLinkPicker()

export interface ObjectViewProps {
  path: string
  mode: 'page' | 'peek' | 'inline'
  /** Inline only: muted text shown while the body is empty. */
  placeholder?: string
  /** Inline only: focus the editor once the object has loaded. */
  autoFocus?: boolean
  /**
   * Inline only, with `autoFocus`: text typed before the object existed, inserted as plain text
   * (never parsed as Markdown or HTML) at the end of the body, in a paragraph of its own when the
   * body already has content. A function is called once, when the editor is ready (or the load
   * failed), so the owner can hand over everything typed up to that moment.
   */
  initialText?: string | (() => string | undefined)
  /** Called with each version this view adopts (load, saves, reloads). */
  onVersion?: (version: string) => void
  /**
   * Called with the object's detail each time this view's copy changes (load, property writes,
   * reloads), so an owner (the peek's daily-note header) reads nothing of its own.
   */
  onDetail?: (detail: ObjectDetail) => void
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
  /**
   * M23: the item panel. A work item shows the work header above its title (its writes go through
   * this view's `writes.work`), and the header carries the Resolution note, so M22's under-panel
   * copy is left out.
   */
  workHeader?: boolean
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

/** The `…` menu item. */
export const OPEN_IN_SIDEPANEL_MENU_ITEM = 'Open in side panel'

/** The `…` menu item. */
export const FIND_IN_PAGE_MENU_ITEM = 'Find in page'

/** M8 menu items and the focus-mode button. */
export const OBJECT_M8_TEXT = {
  versionHistory: 'Version history',
  /** M32: was "Merge into object". */
  mergeObject: `Merge into ${NOTE_LOWER}`,
  mergeTag: 'Merge into tag',
  present: 'Present',
  addToWhiteboard: 'Add to whiteboard',
  enterFocusMode: 'Enter focus mode',
  leaveFocusMode: 'Leave focus mode',
} as const

/** M9 menu items. */
export const OBJECT_M9_TEXT = {
  wideLayout: 'Wide layout',
  normalLayout: 'Normal layout',
  textStats: 'Text stats',
  export: 'Export',
  duplicate: 'Duplicate',
} as const

/**
 * M10: the AI rows of the `…` menu and the peek's sparkle. "Add tags using AI" is the plan's;
 * "Fill empty properties using AI" and "AI Chat" (the peek button's name, as the Explore card)
 * are our strings.
 */
export const OBJECT_AI_TEXT = {
  addTags: 'Add tags using AI',
  autofill: 'Fill empty properties using AI', // our string
  peek: 'AI Chat', // our string
} as const

/** The menu's Import and Copy > rows. */
export const OBJECT_MENU_TEXT = {
  import: 'Import',
  copy: 'Copy',
  /** M32: was "Copy object reference" / "Link to object copied". */
  copyReference: 'Copy reference',
  referenceCopied: 'Link copied',
  copyAsMarkdown: 'Copy as Markdown',
  markdownCopied: 'Markdown copied',
} as const

/** M32: the view's notices, in the glossary's words (each said "object"). */
export const OBJECT_VIEW_TEXT = {
  cantOpen: `Couldn't open this ${NOTE_LOWER}.`,
  fileGone: `This ${NOTE_LOWER}'s file was deleted or moved on disk. Edits here aren't saved.`,
  readOnly: (reason: string) => `This ${NOTE_LOWER} opens read-only: ${reason}. Fix the file to edit it.`,
  readOnlyFrontmatter: `This ${NOTE_LOWER}'s frontmatter couldn't be read, so it opens read-only. Fix the file to edit it.`,
  /** M32 (W1): a typed title the server refused, when it gave no reason of its own. */
  titleNotSaved: 'The title could not be saved.',
} as const

/** Write `text` to the clipboard, then toast `done`. */
async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text)
    showToast(done)
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e))
  }
}

/** A menu row's keys, drawn as "Ctrl Alt P", "Ctrl ⌫"): the registry's first key. */
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

/**
 * Put `text` at the end of the body as plain text nodes (each line a paragraph; never parsed as
 * Markdown or HTML), into the empty paragraph of an empty body, else after the existing content,
 * and leave the caret after it with the editor focused.
 */
function appendPlainText(ed: TiptapEditor, text: string) {
  const paragraphs: JSONContent[] = text
    .split(/\r?\n/)
    .map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))
  const { doc } = ed.state
  const only = doc.childCount === 1 ? doc.firstChild : null
  const empty = only !== null && only.type.name === 'paragraph' && only.content.size === 0
  const range = empty ? { from: 0, to: doc.content.size } : doc.content.size
  ed.chain().insertContentAt(range, paragraphs).focus('end').run()
  // The focus command defers DOM focus a frame; take it now so the next keystroke lands here.
  ed.view.focus()
}

/**
 * Fix pass H2 (M4#3): focus a just-created inline note for typing. A body that came from a
 * template (e.g. `## Yesterday / ## Today / ## Blockers`) must not take the first keystrokes at the
 * end of its last heading: the caret goes to the template's first empty paragraph, else to a new
 * empty paragraph after the template content. An empty body just takes the focus.
 */
function focusForTyping(ed: TiptapEditor, el: HTMLElement) {
  const { doc } = ed.state
  const blank = (n: { type: { name: string }; content: { size: number } }) => n.type.name === 'paragraph' && n.content.size === 0
  if (doc.childCount === 1 && blank(doc.firstChild!)) {
    el.focus()
    return
  }
  let pos = -1
  doc.forEach((node, offset) => {
    if (pos < 0 && blank(node)) pos = offset + 1
  })
  if (pos >= 0) ed.chain().setTextSelection(pos).focus().run()
  else ed.chain().insertContentAt(doc.content.size, { type: 'paragraph' }).focus('end').run()
  // The focus command defers DOM focus a frame; take it now so the next keystroke lands here.
  ed.view.focus()
}

/** How long `computed` refreshes wait, so a burst of changes makes one read. */
const COMPUTED_REFRESH_MS = 150
const OBJECT_EVENT_KINDS = new Set(['created', 'changed', 'deleted', 'renamed'])

/** Whether the type has a property of a kind matching `test` (the link index's copy). */
function typeHas(typeId: string | null | undefined, test: (kind: PropertyType) => boolean): boolean {
  return !!typeOf(typeId)?.propertyDefinitions.some((d) => test(d.type))
}

/** M28: whether objects of the type can have computed other sides (`TypeDef.counterparts`). */
function typeHasCounterparts(typeId: string | null | undefined): boolean {
  return (typeOf(typeId)?.counterparts?.length ?? 0) > 0
}

/** M22: the keys of a work type's `steps` and `floorItems` properties (decoded by the server). */
function workKeysOf(type: TypeDef | undefined): string[] {
  if (!isWorkType(type)) return []
  return type!.propertyDefinitions.filter((d) => d.type === 'steps' || d.type === 'floorItems').map((d) => d.key)
}

const NO_KEYS: string[] = []

/** The stored values of `keys`, as one string (what a decoded read belongs to). */
function rawWorkValues(frontmatter: Record<string, unknown>, keys: string[]): string {
  return JSON.stringify(keys.map((k) => frontmatter[k] ?? null))
}

export function ObjectView({
  path,
  mode,
  onExpand,
  onDismiss,
  footer,
  placeholder,
  autoFocus,
  initialText,
  onVersion,
  onDetail,
  menuSlot,
  onDeleted,
  workHeader,
}: ObjectViewProps) {
  /**
   * M32: the note as the view this one replaces left it when its own rename moved the file
   * (`renameHandover.ts`). With it the first render already shows the editor; nothing is loaded
   * again. The caret and the text not yet saved are claimed once the view has mounted.
   */
  const [handed] = useState(() => (mode === 'inline' ? null : peekHandover(path)))
  const [detail, setDetail] = useState<ObjectDetail | null>(handed)
  /** Mirrors `detail` for callbacks that must not wait for a render (a work write's result). */
  const detailRef = useRef<ObjectDetail | null>(null)
  detailRef.current = detail
  /** M22: the resolution note the last work write handed back, at that write's version. */
  const [workNote, setWorkNote] = useState<{ version: string; note: ResolutionNote | null } | null>(null)
  /**
   * M22: the decoded `steps` and `floorItems` values (each step's id and rev) of a work item, read
   * with `api.workItem` (the front matter holds them as stored), for the raw values in `raw`.
   */
  const [decoded, setDecoded] = useState<{ path: string; raw: string; fields: Record<string, unknown> } | null>(null)
  const [version, setVersion] = useState(handed?.version ?? '')
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  /** The pane toggled in this view; until then the object's own `hideProperties` decides. */
  const [paneToggled, setPaneToggled] = useState<boolean | null>(null)
  const propertiesByDefault = useSettings((s) => s.settings.showPropertiesByDefault !== false)
  const [deleted, setDeleted] = useState(false)
  /** The Trash entry of this window's own delete ("Undo Delete"). */
  const [trashId, setTrashId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [collectionsOpen, setCollectionsOpen] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [changeTo, setChangeTo] = useState<TypeDef | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
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
  const versionRef = useRef(handed?.version ?? '')
  const onVersionRef = useRef(onVersion)
  onVersionRef.current = onVersion
  const onDetailRef = useRef(onDetail)
  onDetailRef.current = onDetail
  useEffect(() => {
    if (detail && detail.summary.path === path) onDetailRef.current?.(detail)
  }, [detail, path])
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

  /**
   * M32: our own rename moved the file. The page and the peek are keyed by path, so this view and
   * its editor are replaced at once (here, and by the app on the rename's event), and Enter in the
   * title has already put the caret in the body. So that nothing typed meanwhile is lost and the
   * caret stays, the view that takes over is handed the note as it stands, the caret, and the
   * text this editor has not saved; it shows them in its first render and saves the text.
   */
  const viewRootRef = useRef<HTMLDivElement | null>(null)
  const handOverTo = (res: RenameResult, title: string, d: ObjectDetail | null) => {
    const h = editorRef.current
    if (mode === 'inline' || !d || !h) return
    // The rename rewrote a first `# Old title` heading in the file (`titleHeading.ts`). What is
    // handed over stands on the rename's version, so it carries the same change: the text as the
    // file now holds it, and the text typed meanwhile with the heading it now has. Without this
    // the next save would write the old heading back, with no conflict.
    const then = h.getBody()
    const before = h.savedBody() ?? d.body
    const onDisk = retitledBody(before, d.summary.title, title)
    const shown = then === null ? null : retitledBody(then, d.summary.title, title)
    handOver(res.path, {
      detail: {
        ...d,
        body: onDisk,
        version: res.version,
        frontmatter: { ...d.frontmatter, title },
        summary: { ...d.summary, path: res.path, title },
      },
      caret: focusedBodyCaret(viewRootRef.current),
      unsaved: shown !== null && shown !== onDisk ? shown : null,
      slot: viewRootRef.current?.parentElement ?? null,
      // W1: a title is committed while the person is still in its field: the field goes over too.
      title: focusedTitle(viewRootRef.current),
    })
    // This editor is leaving: what it holds is handed over, and it must not write to the old path.
    if (then !== null && then !== before) h.reload(then, res.version)
  }

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
      if (h && mine !== null && !h.isDirty() && theirs.body === h.savedBody()) {
        // Only the frontmatter changed (a property write outside this view's own write path: the
        // peek's Reviewed, another window): adopt the version and keep the editor's document
        // (a reload would drop its selection, scroll and undo history for nothing).
        setDetail(theirs)
        adoptVersion(theirs.version)
        void h.resume(theirs.version)
        unblockRef.current()
        return
      }
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

  // M12: formula and rollup values are computed by the server on each read. After a property
  // write, a change to this object's type, or (when the type has a rollup) a change to any other
  // object, read the object again and take only its `computed` values: the body, frontmatter and
  // version keep their own handling. Requests within one window make one read.
  const typeIdRef = useRef<string | null>(null)
  typeIdRef.current = detail?.summary.type ?? null
  const computedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const computedSeq = useRef(0)
  const refreshComputed = useCallback(() => {
    if (computedTimer.current) return
    computedTimer.current = setTimeout(() => {
      computedTimer.current = null
      const n = ++computedSeq.current
      api
        .object(path)
        .then((fresh) => {
          if (n !== computedSeq.current) return
          setDetail((d) =>
            d && d.summary.path === fresh.summary.path
              ? { ...d, computed: fresh.computed, backlinks: fresh.backlinks, counterparts: fresh.counterparts }
              : d,
          )
        })
        .catch(() => undefined)
    }, COMPUTED_REFRESH_MS)
  }, [path])
  useEffect(
    () => () => {
      if (computedTimer.current) clearTimeout(computedTimer.current)
      computedTimer.current = null
      computedSeq.current++
    },
    [path],
  )

  // M29: a sync of this object's type changes no file: read the object again and take only its
  // `synced` block (and `computed`, which is computed from the synced values too).
  const syncedSeq = useRef(0)
  const refreshSynced = useCallback(() => {
    const n = ++syncedSeq.current
    api
      .object(path)
      .then((fresh) => {
        if (n !== syncedSeq.current) return
        setDetail((d) => (d && d.summary.path === fresh.summary.path ? { ...d, synced: fresh.synced, computed: fresh.computed } : d))
      })
      .catch(() => undefined)
  }, [path])
  useEffect(
    () => () => {
      syncedSeq.current++
    },
    [path],
  )

  // M28: a counterpart edit writes the other objects' stored side; the answer's rows replace ours.
  const onEditCounterpart = useMemo(
    () =>
      counterpartEditor(
        path,
        () => detailRef.current?.counterparts ?? [],
        (rows) => setDetail((d) => (d && d.summary.path === path ? { ...d, counterparts: rows } : d)),
      ),
    [path],
  )

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
      if (typeHas(typeIdRef.current, (k) => COMPUTED_KINDS.has(k))) refreshComputed()
    },
    // M22: a work write changed the front matter and appended Activity (and Work notes) lines to
    // the body. The body was flushed before the write, so a clean editor loads the returned body
    // at the returned version; edits typed while the write was in flight are kept and asked about,
    // as for an external change. The item's decoded values (`item.fields`) are kept for the panel.
    onWorkWritten: (res: WorkWriteResult) => {
      const d = detailRef.current
      if (!d) return
      const frontmatter: Record<string, unknown> = { ...d.frontmatter, ...res.frontmatter }
      const keys = workKeysOf(typeOf(typeIdRef.current))
      if (res.item?.fields) setDecoded({ path, raw: rawWorkValues(frontmatter, keys), fields: res.item.fields })
      const next: ObjectDetail = {
        ...d,
        frontmatter,
        body: res.body,
        summary: patchSummary(d.summary, res.frontmatter ?? {}),
        version: res.version,
      }
      setWorkNote({ version: res.version, note: res.item?.resolution ?? null })
      const h = editorRef.current
      if (h && h.isDirty() && h.getBody() !== res.body) {
        h.hold()
        setDetail({ ...next, body: d.body })
        blockedRef.current = true
        pendingRef.current = true
        setPending({ mine: h.getBody() ?? '', theirs: next })
        return
      }
      setDetail(next)
      if (h) h.reload(res.body, res.version)
      if (typeHas(typeIdRef.current, (k) => COMPUTED_KINDS.has(k))) refreshComputed()
    },
    onWorkError: (err: unknown) => showToast(err instanceof Error ? err.message : String(err)),
    // W1: a title is now also committed without the person asking (after a pause), so a refusal
    // is said on screen, once (the header does not send that title again by itself).
    onRenameRefused: (err: unknown) => showToast(err instanceof Error && err.message ? err.message : OBJECT_VIEW_TEXT.titleNotSaved),
    onRenamed: (res: RenameResult, oldPath: string, title: string) => {
      // The note as it was before the rename (its old title decides whether the text changed).
      const was = detailRef.current
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
        handOverTo(res, title, was)
        renamedToRef.current = res.path
        // The view on the new path takes over: this one's title is done here (it commits nothing
        // when it unmounts), and the save mark there starts from a save that was running.
        replacedRef.current = true
        clearTitleSaveState(oldPath)
        setTitleSaveState(res.path, 'saving')
        useTabs.getState().retarget(oldPath, res.path)
      } else if (was) {
        // The file kept its name, so this view and its editor stay. When the rename rewrote the
        // text's `# Old title` heading, the editor still shows the old one on the new version:
        // read the file again as after a rejected save (a clean editor reloads; one with words
        // typed meanwhile asks), so the next save cannot put the old heading back.
        const held = editorRef.current?.savedBody() ?? was.body
        if (retitledBody(held, was.summary.title, title) !== held) enqueueRef.current(true)
      }
    },
  })

  // W1 (the M32 walk): the title is kept like the text. The header commits a typed title after a
  // pause and on blur; this view commits it when the note is left (the window going, the view
  // closing), and says where it stands for the save mark. A rename is one write in this note's
  // queue: the text is flushed first, and the handover carries what is typed meanwhile.
  /** The title typed and not yet committed (the header reports it), or null. */
  const pendingTitleRef = useRef<string | null>(null)
  /** The title being renamed to right now, and its answer. */
  const titleFlightRef = useRef<{ title: string; done: Promise<boolean> } | null>(null)
  /** The title the server last refused: not sent again when the note is left. */
  const refusedTitleRef = useRef<string | null>(null)
  /** Our own rename moved the file: the view on the new path has taken this one's place. */
  const replacedRef = useRef(false)
  const publishTitle = useCallback(() => {
    if (replacedRef.current || mode === 'inline') return
    const waiting = pendingTitleRef.current
    setTitleSaveState(
      path,
      titleFlightRef.current ? 'saving' : waiting === null ? 'saved' : waiting === refusedTitleRef.current ? 'error' : 'unsaved',
    )
  }, [path, mode])
  const renameTo = writes.rename
  const commitTitle = useCallback(
    (title: string): Promise<boolean> => {
      const flight = titleFlightRef.current
      if (flight?.title === title) return flight.done
      const done = renameTo(title).then((res) => {
        if (titleFlightRef.current?.done === done) titleFlightRef.current = null
        // Answered while the page lives: its tabs have followed the file (`keepRenaming`).
        dropRenaming(path)
        refusedTitleRef.current = res === null ? title : null
        publishTitle()
        return res !== null
      })
      titleFlightRef.current = { title, done }
      publishTitle()
      return done
    },
    [renameTo, publishTitle],
  )
  const onTitleDraft = useCallback(
    (title: string | null) => {
      pendingTitleRef.current = title
      publishTitle()
    },
    [publishTitle],
  )
  /**
   * The note is being left: commit the title that waits (not one just refused: it would be
   * again). `going`: the window may be gone before the answer says where the file moved to, so
   * the note's id is left for the next page to find it by (`keepRenaming`).
   */
  const commitWaitingTitle = useCallback(
    (going = false) => {
      const title = pendingTitleRef.current
      if (title === null || title === refusedTitleRef.current || replacedRef.current) return
      const id = detailRef.current?.summary.id
      if (going && id) keepRenaming(path, id)
      void commitTitle(title)
    },
    [commitTitle, path],
  )
  useEffect(() => {
    // The window is going, or hidden: commit now. With nothing of the text to save first, the
    // request leaves while the event is handled (a keepalive request, as the text's).
    const onGoing = () => commitWaitingTitle(true)
    const onHidden = () => {
      if (document.visibilityState === 'hidden') commitWaitingTitle(true)
    }
    window.addEventListener('pagehide', onGoing)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', onGoing)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [commitWaitingTitle])
  // The view closes (a tab or note switch, the peek closed) with a title typed: commit it. In the
  // layout phase, while the editor's handle is still there, so the text is flushed before the rename.
  const commitWaitingTitleRef = useRef(commitWaitingTitle)
  commitWaitingTitleRef.current = commitWaitingTitle
  useLayoutEffect(
    () => () => {
      commitWaitingTitleRef.current()
      if (!replacedRef.current) clearTitleSaveState(path)
    },
    [path],
  )

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

  useEffect(() => {
    return api.onChange((e) => {
      const typeId = typeIdRef.current
      if (!typeId || deletedRef.current) return
      if (e.kind === 'synced') {
        if (e.path === typeId) refreshSynced()
        // Another type's facts: a rollup of this type may read them.
        else if (typeHas(typeId, (k) => k === 'rollup')) refreshComputed()
        return
      }
      if (e.kind === 'types') {
        // This type's formulas or rollups may have changed; a rollup also reads other types.
        const own = e.path === typeId || isResync(e, 'types')
        if (own ? typeHas(typeId, (k) => COMPUTED_KINDS.has(k)) : typeHas(typeId, (k) => k === 'rollup')) refreshComputed()
        return
      }
      // This object's own changes reload it (or are our writes, refreshed above). Any other
      // object may be one a rollup reads (a related object, or its title), or may have gained or
      // lost a link to this one (the Backlinks property; fix pass H, M5#5; M28: a counterpart row).
      if (e.path === path || !OBJECT_EVENT_KINDS.has(e.kind)) return
      // A type that only receives other sides from "any type" sources (Command or Runbook "Covers")
      // has no `counterparts` of its own, so the object's own rows count too.
      const hasCounterparts = typeHasCounterparts(typeId) || (detailRef.current?.counterparts?.length ?? 0) > 0
      if (typeHas(typeId, (k) => k === 'rollup' || k === 'entity_backlinks') || hasCounterparts) refreshComputed()
    })
  }, [path, refreshComputed, refreshSynced])

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
    if (handed && handed.summary.path === path) {
      // M32: handed over by the view our own rename replaced: the note is already shown, at the
      // version the rename answered. Only what the server works out is read again.
      adoptVersion(versionRef.current)
      void ensureLinkIndex()
      refreshComputed()
      return () => {
        alive = false
      }
    }
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
  }, [path, adoptVersion, markDeleted, offerKept, handed, refreshComputed])

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
        throw new Error(`This ${NOTE_LOWER} changed on disk. It has been reloaded; try again.`, { cause: err })
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
      console.warn("The template couldn't be applied:", err)
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

  // The menu's page keys for the active view (`keyIsForView`: the view holding focus, or the main
  // page with focus on the body and nothing open over it): Ctrl+E Export and Ctrl+I Import outside
  // the editor (inside it they are code and italic), Ctrl+Shift+* pins or unpins, the editor included.
  const pageKeysRef = useRef({ summary, type })
  pageKeysRef.current = { summary, type }
  useEffect(() => {
    if (mode === 'inline') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!keyIsForView(e, viewRootRef.current, mode)) return
      const { summary: s, type: t } = pageKeysRef.current
      if (!s) return
      if (matches(e, keysFor('toggleFavorite')) || (e.key === '*' && (e.ctrlKey || e.metaKey) && !e.altKey)) {
        e.preventDefault()
        const pinnedNow = !!s.id && useUiStore.getState().ui.pinned.some((p) => p.kind === 'object' && p.id === s.id)
        if (pinnedNow && s.id) void pinnedActions.unpin({ kind: 'object', id: s.id })
        else void pinnedActions.pin({ kind: 'object', path, id: s.id })
        return
      }
      if (isEditableTarget(e.target)) return
      if (matches(e, keysFor('openExportMenu'))) {
        e.preventDefault()
        setExportOpen(true)
      } else if (t && matches(e, keysFor('openImportMenu'))) {
        e.preventDefault()
        setImportOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, path])
  // M31: the Page group's Select all top-level blocks, Copy deep link and the scroll keys.
  usePageShortcuts({ mode, path, summary, editorRef, rootRef: viewRootRef })

  const writeProperties = (updates: Record<string, unknown>) => {
    if ('tags' in updates && Array.isArray(updates.tags)) {
      ensureNewTags(detail?.summary.tags ?? [], updates.tags as string[])
    }
    void writes.updateProperties(updates)
  }
  // Polish item 17: the pane toggle is per object. With "Show properties by default" on (the
  // default), hiding saves `hideProperties: true` and showing removes the key; off (2026-11-09),
  // the pane starts hidden, showing saves `hideProperties: false` and hiding removes the key.
  // Read-only: this view only.
  // M32, item 11: the pane also starts hidden for a type with no properties of its own (the Note
  // and the Daily note: system rows only), so the text gets the room; the same two saved values
  // decide for the object (`true` hides, `false` shows), and a toggle back to the start removes it.
  const hideProperties = detail?.frontmatter.hideProperties
  const startsOpen = propertiesByDefault && typeHasOwnProperties(type)
  const panelOpen = paneToggled ?? (typeof hideProperties === 'boolean' ? !hideProperties : startsOpen)
  const togglePanel = () => {
    const next = !panelOpen
    setPaneToggled(next)
    if (!propsReadOnly && detail) writeProperties({ hideProperties: next === startsOpen ? null : !next })
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
  // M32: with the Work page off for this space a work type's page is a plain note page: no work
  // header, no resolution note, no empty work rows (`PropertyPanel`) and no work fetch. A work
  // value the note already holds still shows (no value is hidden by the Work switch), and only
  // such a note reads its decoded steps.
  const workOn = useWorkOn()
  /** M22: a work item with a Ticket ID shows its resolution note. */
  const ticketId = detail?.frontmatter.ticketId
  const isTicket = workOn && !!summary && !isTemplate && isWorkType(type) && typeof ticketId === 'string' && ticketId.trim() !== ''
  /** M23: the item panel's work header (a work item, not a template). */
  const showWorkHeader = workOn && !!workHeader && !!summary && !isTemplate && isWorkType(type)
  // M22: a work item's steps and floor items are shown as the server decodes them (each with its
  // id and rev, which step actions send back): read once per stored value (a load, an external
  // change), taken from a work write's result otherwise. Reading never writes.
  const typeWorkKeys = workKeysOf(type)
  const storedWork = detail?.frontmatter
  const workKeys = workOn
    ? typeWorkKeys
    : storedWork
      ? typeWorkKeys.filter((k) => Array.isArray(storedWork[k]) && (storedWork[k] as unknown[]).length > 0)
      : NO_KEYS
  const workRaw = detail && workKeys.length > 0 ? rawWorkValues(detail.frontmatter, workKeys) : null
  const decodedNow = decoded && workRaw !== null && decoded.path === path && decoded.raw === workRaw ? decoded : null
  useEffect(() => {
    if (workRaw === null || decodedNow) return
    let alive = true
    api
      .workItem(path)
      .then((item) => alive && setDecoded({ path, raw: workRaw, fields: item.fields ?? {} }))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [path, workRaw, decodedNow])
  let panelFrontmatter = detail?.frontmatter ?? {}
  if (decodedNow) {
    panelFrontmatter = { ...panelFrontmatter }
    for (const k of workKeys) if (Array.isArray(decodedNow.fields[k])) panelFrontmatter[k] = decodedNow.fields[k]
  }
  const focusOn = useFocusMode((s) => s.on)
  const aiHidden = useAiHidden()
  // M9: the object's own layout keys override the type's.
  const layout = detail ? frontmatterLayout(detail.frontmatter) : undefined
  const wideOn = objectWideLayout(type, layout)
  /** "Wide layout" is hidden for whiteboards and the index card design. */
  const canWide = !!summary && pageDesign(type) !== 'indexCard' && !isWhiteboardType(type)
  const dailyNote = !!summary && isDailyNoteType(type, summary.type)
  /** No Duplicate for daily notes and templates; whiteboards are ours to refuse. */
  const canDuplicate = !!summary && !isTemplate && !dailyNote && !isWhiteboardType(type)

  // What shows under the properties goes inside the panel: in the side layout a sibling of the
  // panel would be a flex column of its own and squeeze the page (D3).
  const showSource = !!detail && importSourceOf(detail.frontmatter.importSource) !== null
  const showResolution = isTicket && !showWorkHeader
  const showTaskStats =
    isTask && typeof detail?.frontmatter.repeat === 'string' && detail.frontmatter.repeat.trim() !== ''
  const panelFooter =
    detail && (showSource || showResolution || showTaskStats) ? (
      <>
        {/* M25: where an imported object came from, under its properties. */}
        <ImportSourceLine source={detail.frontmatter.importSource} />
        {/* M22: a ticket's resolution note (two copy-ready texts), collapsed by default. */}
        {showResolution && (
          <ResolutionNoteSection
            path={path}
            version={version}
            note={workNote && workNote.version === version ? workNote.note : undefined}
          />
        )}
        {/* M8: "Task Stats" under the property panel of a recurring task-role object. */}
        {showTaskStats && (
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
    ) : undefined

  // A render function: the layout picks the variant (inline as a card when the page is narrow).
  const properties =
    detail && panelOpen ? (variant: PanelVariant) => (
      <PropertyPanel
        type={type}
        frontmatter={panelFrontmatter}
        links={detail.links}
        summary={detail.summary}
        backlinks={detail.backlinks ?? []}
        computed={detail.computed}
        counterparts={detail.counterparts ?? []}
        synced={detail.synced}
        onEditCounterpart={onEditCounterpart}
        readOnly={propsReadOnly}
        onChange={(key, value) => writeProperties({ [key]: value })}
        onChangeMany={(u, r) => void writes.updateProperties(u, r)}
        onSetReminder={(key, remind) => void writes.setReminder(key, remind)}
        onWorkWrite={propsReadOnly ? undefined : (run) => writes.work(run)}
        onTypeChange={onTypeChange}
        onOpenTag={onOpenTag}
        onOpenObject={onOpenObject}
        variant={variant}
        footer={panelFooter}
      />
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
              {revealMenuLabel()}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useFind.getState().open(path)}>
              <Icon name="ph-magnifying-glass" size={14} />
              {FIND_IN_PAGE_MENU_ITEM}
              <MenuKeys id="findInPage" />
            </DropdownMenuItem>
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
            <PinMenuItems pin={{ kind: 'object', path, id: summary?.id }} shortcut={<MenuKeys id="toggleFavorite" />} />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={propsReadOnly || !summary || isTemplate}>
                <Icon name="ph-swap" size={14} />
                Change type
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[360px] overflow-auto border-line bg-raised">
                {otherTypes.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => setChangeTo(t)}>
                    <TypeChip type={t} size={18} />
                    {typeLabel(t)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {type && (
              <DropdownMenuItem data-type-setting="" onSelect={() => openTarget({ kind: 'typeSettings', typeId: type.id })}>
                <Icon name="ph-gear-six" size={14} />
                {TYPE_SETTINGS}
              </DropdownMenuItem>
            )}
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
              <MenuKeys id="openExportMenu" />
            </DropdownMenuItem>
            {/* Our choice: Object's import is the type's CSV import. */}
            <DropdownMenuItem disabled={!type || propsReadOnly} onSelect={() => setImportOpen(true)}>
              <Icon name="ph-download-simple" size={14} />
              {OBJECT_MENU_TEXT.import}
              <MenuKeys id="openImportMenu" />
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
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!summary}>
                <Icon name="ph-copy" size={14} />
                {OBJECT_MENU_TEXT.copy}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="border-line bg-raised">
                <DropdownMenuItem
                  onSelect={() => summary && void copyText(wikilinkMarkdown(summary.title, null), OBJECT_MENU_TEXT.referenceCopied)}
                >
                  <Icon name="ph-link" size={14} />
                  {OBJECT_MENU_TEXT.copyReference}
                </DropdownMenuItem>
                {/* Our choice: the body's Markdown, as saved (no title heading). */}
                <DropdownMenuItem onSelect={() => void copyText(getMarkdown(), OBJECT_MENU_TEXT.markdownCopied)}>
                  <Icon name="ph-markdown-logo" size={14} />
                  {OBJECT_MENU_TEXT.copyAsMarkdown}
                </DropdownMenuItem>
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
            {/* M10: the AI rows; their place (after "Add to whiteboard") is our choice. */}
            {!aiHidden && (
              <>
                <DropdownMenuItem
                  disabled={propsReadOnly || !summary}
                  onSelect={() => openAiChat({ mode: 'tagObject', contextPaths: [path] })}
                >
                  <Icon name="ph-sparkle" size={14} />
                  {OBJECT_AI_TEXT.addTags}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={propsReadOnly || !summary}
                  onSelect={() => openAiChat({ mode: 'autofill', contextPaths: [path] })}
                >
                  <Icon name="ph-sparkle" size={14} />
                  {OBJECT_AI_TEXT.autofill}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={propsReadOnly || !summary || isTemplate}
              onSelect={() => setCollectionsOpen(true)}
            >
              <Icon name={COLLECTION_ICON} size={14} />
              Edit collections
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
      {/* M32: just before the right-aligned group, so "Saving…" / "Saved" never moves the buttons;
          a part of the toolbar of its own, so it stays while the buttons fade for typing. */}
      <SaveMark key={path} path={path} className="mr-2 ml-auto" />
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
        {/* M10: the peek's sparkle (catalog section 5, "focus/AI sparkle"): the AI chat about this object. */}
        {mode === 'peek' && !aiHidden && (
          <ToolButton label={OBJECT_AI_TEXT.peek} icon="ph-sparkle" onClick={() => openAiChat({ mode: 'chat', contextPaths: [path] })} />
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
  const loadFailed = error !== null && !hasDetail
  useEffect(() => {
    if (mode !== 'inline' || !autoFocus || focusedRef.current) return
    if (loadFailed) {
      // Let the owner show this view (and its error) in place of whatever it drew meanwhile.
      focusedRef.current = true
      if (typeof initialText === 'function') initialText()
      return
    }
    if (!hasDetail) return
    const el = inlineRef.current?.querySelector<HTMLElement>('.ProseMirror')
    if (!el) return
    focusedRef.current = true
    const text = typeof initialText === 'function' ? initialText() : initialText
    const ed = (el as HTMLElement & { editor?: TiptapEditor }).editor
    if (text && ed) {
      appendPlainText(ed, text)
      setBodyEmpty(false)
    } else if (ed) {
      focusForTyping(ed, el)
    } else {
      el.focus()
    }
    // `initialText` is read once, with the first focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, autoFocus, hasDetail, loadFailed])

  // M32: once the editor shows the loaded body, the view takes what was left for it: after our
  // own rename the text typed meanwhile (shown at once, saved here) and the caret; otherwise a
  // body-focus request for this note ("Today's note": the end of its text). Each is taken once.
  const takenRef = useRef(false)
  useEffect(() => {
    if (mode === 'inline' || !hasDetail || takenRef.current) return
    takenRef.current = true
    // One view takes the caret and the text (the one in the leaving view's place); the entry
    // goes once every view of this update has had its turn.
    const claim = handed ? claimHandover(path, viewRootRef.current?.parentElement ?? null) : null
    if (handed) setTimeout(() => dropHandover(path), 0)
    // The rename that brought this view here has answered: the title is saved, unless the field
    // was handed over with more typed in it (the header has reported that by now).
    if (handed) publishTitle()
    const h = editorRef.current
    const text = claim?.unsaved
    if (h && text != null) {
      // Shown now, saved by this view; the editor's own saving waits for the answer.
      h.reload(text, versionRef.current)
      h.hold()
      api
        .saveBody(path, text, versionRef.current)
        .then((res) => {
          setDetail((d) => (d && d.summary.path === path ? { ...d, body: text, version: res.version } : d))
          adoptVersion(res.version)
          // Anything typed since is saved on that version.
          void editorRef.current?.resume(res.version)
        })
        .catch((err: unknown) => {
          // It could not be written (the file changed again): the editor goes back to the file
          // and the text is kept and offered, as text left unsaved always is.
          const d = detailRef.current
          const kept = editorRef.current?.getBody() ?? text
          keepUnsaved(path, kept, d?.summary.id)
          if (d) {
            editorRef.current?.reload(d.body, versionRef.current)
            setRecovery({ kept, onDisk: d.body, error: null })
          }
          if (err instanceof ConflictError) enqueueRef.current(false)
        })
    }
    const at = claim?.caret ?? takeBodyFocus(path)
    if (at) focusBody(viewRootRef.current, at)
  }, [mode, hasDetail, path, handed, adoptVersion, publishTitle])

  /** M32, item 2: Enter, ArrowDown or Tab in the title: the caret goes to the start of the body. */
  const enterBody = useCallback(() => focusBody(viewRootRef.current, 'start'), [])

  /**
   * M32, item 2: ArrowUp or Shift+Tab with the caret at the body's very first position goes back
   * to the end of the title. Shift+Tab in a list item or an indented block stays the editor's
   * (it unindents). Capture phase: the editor never sees the key.
   */
  const onBodyKeyDown = (e: ReactKeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
    const up = e.key === 'ArrowUp' && !e.shiftKey
    const back = e.key === 'Tab' && e.shiftKey
    if (!up && !back) return
    const ed = bodyEditorOf(viewRootRef.current)
    // Only the body's own caret: not a field inside a block (a table cell's formula, a code block).
    if (!ed || e.target !== ed.view.dom || !caretAtBodyStart(ed) || (back && !caretInTopLevelBlock(ed))) return
    const title = viewRootRef.current?.querySelector<HTMLInputElement>('[data-page-title] input[aria-label="Title"]')
    if (!title) return
    e.preventDefault()
    e.stopPropagation()
    title.focus()
    title.setSelectionRange(title.value.length, title.value.length)
  }

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
      <DeleteObjectDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={deleteObject} title={summary?.title} />
      {exportOpen && <ExportDialog open onOpenChange={setExportOpen} path={path} prepare={settle} />}
      {importOpen && type && <ImportCsvDialog type={type} open onOpenChange={setImportOpen} />}
      {summary && (
        <Dialog open={collectionsOpen} onOpenChange={setCollectionsOpen}>
          <DialogContent className="w-auto border-line bg-raised p-0 text-fg sm:max-w-none">
            <DialogTitle className="sr-only">Edit collections</DialogTitle>
            <DialogDescription className="sr-only">{`Choose the collections this ${NOTE_LOWER} belongs to.`}</DialogDescription>
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
      <div
        className="relative w-full"
        data-object-view="inline"
        data-object-path={path}
        data-object-template={summary?.template != null ? '' : undefined}
        ref={inlineRef}
      >
        {!detail || !summary ? (
          error ? (
            <p className="text-[14px] text-fg-muted">{`${OBJECT_VIEW_TEXT.cantOpen} ${error}`}</p>
          ) : (
            <p className="text-[14px] text-fg-muted">Loading…</p>
          )
        ) : (
          <>
            {deleted && (
              <div role="alert" className="mb-3 rounded-lg border border-danger/60 bg-raised px-3 py-2 text-[14px]">
                {OBJECT_VIEW_TEXT.fileGone}
              </div>
            )}
            {/* The header's Tags row (the inline view's only header row; the calendar shows the date). */}
            <HeaderTags
              className="mb-2"
              tags={summary.tags}
              readOnly={propsReadOnly}
              onChange={(next) => writeProperties({ tags: next })}
              onOpenTag={onOpenTag}
            />
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
      <div className="flex h-full min-h-0 w-full" data-object-view={mode} ref={viewRootRef}>
        <div className="relative flex min-w-0 flex-1 flex-col">
          {toolbar}
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[var(--page-content-width)] px-12 pt-10 pb-24" data-object-path={path}>
              {error ? (
                <div className="rounded-lg border border-line bg-raised p-4">
                  <p className="font-semibold">{OBJECT_VIEW_TEXT.cantOpen}</p>
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
    <div className="h-full min-h-0 w-full" data-object-view={mode} ref={viewRootRef}>
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
                // A new image drops the old one's position.
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
          <>
            {showWorkHeader && <WorkHeader path={path} work={writes.work} />}
            <ObjectHeader
              summary={summary}
              type={type}
              readOnly={propsReadOnly}
              onRename={commitTitle}
              onDraft={onTitleDraft}
              onPropertiesChange={writeProperties}
              onOpenTag={onOpenTag}
              onEnterBody={enterBody}
            />
          </>
        }
        body={
          <>
            {readOnly && (
              <div role="status" className="mb-4 rounded-lg border border-line bg-raised px-3 py-2 text-[14px] text-fg-muted">
                {summary.readOnlyReason ? OBJECT_VIEW_TEXT.readOnly(summary.readOnlyReason) : OBJECT_VIEW_TEXT.readOnlyFrontmatter}
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
                {OBJECT_VIEW_TEXT.fileGone}
              </div>
            )}
            {/* M32, item 11: the text has at least 60% of the window (not while the properties sit
                under it in a narrow layout), and a click in the empty space below it is a click at
                its end. */}
            <div
              className="object-body-text min-h-[60vh] cursor-text [[data-properties=inline]_&]:min-h-0"
              onKeyDownCapture={onBodyKeyDown}
              onMouseDown={(e) => {
                if (e.target !== e.currentTarget || e.button !== 0) return
                if (focusBodyEnd(viewRootRef.current)) e.preventDefault()
              }}
            >
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
          </>
        }
        below={<ReferencesSection path={path} summary={summary} type={type} />}
      >
        {overlays}
      </PageLayout>
    </div>
  )
}
