/**
 * The object's header, in this order: type chip, icon (and a Tag's colour swatch), title,
 * description, aliases and tags. Hovering offers "Add icon", "Add cover image", "Add description"
 * and "Add aliases" for whichever is empty. Every edit writes through `onPropertiesChange` (the
 * view's serialized `updateProperties`); the title commits through `onRename`.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { Icon as IconValue, ObjectSummary, PropertyDef, TypeDef } from '@/api/types'
import { ColorPicker } from '@/components/ColorPicker'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { ImagePicker } from '@/components/ImagePicker'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { typeLabel } from '@/lib/typeLabel'
import { useTabs } from '@/nav/tabs'
import { AliasesCell } from '@/properties/cells/AliasesCell'
import { DescriptionCell } from '@/properties/cells/DescriptionCell'
import { takeFresh } from '@/create/freshObjects'
import { TagsCell } from '@/properties/cells/TagsCell'
import { TagPicker } from '@/properties/TagPicker'
import { chipStyle, lineColor } from '@/theme/palette'
import { decodeIcon } from './PropertyPanel'
import { claimTitle, peekTitleDraft } from './renameHandover'

/**
 * M32 (the walk's W1): how long after the last key in the title its text is committed. Not on
 * every key and with no cap while typing goes on: a commit renames the file, so one per pause.
 */
export const TITLE_COMMIT_MS = 2000

/** The title `draft` would commit: trimmed, not empty and not the title the note has; else null. */
function titleToCommit(draft: string, saved: string): string | null {
  const t = draft.trim()
  return t && t !== saved ? t : null
}

/** An object's icon: an Iconify id (`ph-…`, `vscode-icons-…`) renders as an icon; anything else (emoji) as text. */
export function ObjectIcon({ icon, size }: { icon: IconValue | string | null; size: number }) {
  return <IconOrEmoji icon={icon} size={size} />
}

/** Open the Tag object called `name`, creating it first when it doesn't exist. */
export async function openTag(name: string): Promise<void> {
  const { path } = await api.ensureTag(name)
  useTabs.getState().open({ kind: 'object', path })
}

/** Create the Tag objects for tags that `next` adds to `prev` (in the background). */
export function ensureNewTags(prev: readonly string[], next: readonly string[]): void {
  const had = new Set(prev.map((t) => t.toLowerCase()))
  for (const name of next) {
    if (!had.has(name.toLowerCase())) void api.ensureTag(name).catch(() => undefined)
  }
}

/** `#query` at the end of the text before the caret: at the start or after a non-word character. */
const HASH_QUERY = /(?:^|[^\p{L}\p{N}_])#([^\s#]{0,50})$/u

export function isTagType(type: TypeDef | undefined, typeId?: string | null): boolean {
  return type ? type.id === 'tag' || type.name.toLowerCase() === 'tag' : typeId === 'tag'
}

export function isDailyNoteType(type: TypeDef | undefined, typeId?: string | null): boolean {
  return type ? type.id === 'dailynote' || type.name.toLowerCase() === 'dailynote' : typeId === 'dailynote'
}

function sysDef(id: string, type: PropertyDef['type'], name: string): PropertyDef {
  return { id, key: id, name, type, description: name, icon: null, visibility: 'alwaysShow', options: {} }
}

const TAGS_DEF = sysDef('tags', 'entity_tags', 'Tags')
const DESCRIPTION_DEF = sysDef('description', 'entity_description', 'Description')
const ALIASES_DEF = sysDef('aliases', 'entity_aliases', 'Aliases')

export interface ObjectHeaderProps {
  summary: ObjectSummary
  type?: TypeDef
  readOnly?: boolean
  /**
   * Commit a new title (trimmed, changed, not empty). A promise that resolves false says the
   * title was refused: it is not sent again by the timer until the text changes.
   */
  onRename?(title: string): void | Promise<boolean>
  /**
   * M32 (W1): the title typed and not yet committed (as `onRename` would get it), or null. The
   * view commits it when the note is left (the window going, the view closing).
   */
  onDraft?(title: string | null): void
  /** Write frontmatter properties (API values). */
  onPropertiesChange?(updates: Record<string, unknown>): void
  /** Open a tag's page; default: `openTag`. */
  onOpenTag?(name: string): void
  /**
   * M32: put the caret at the start of the body (Enter, ArrowDown or Tab in the title). False
   * when the body can't take it; Enter then leaves the field as before.
   */
  onEnterBody?(): boolean
  /**
   * M33: this header took a brand-new note's mark, so its title gets the focus, selected. Called
   * in the header's mount effect (before its owner's), so the owner leaves the focus to the title.
   */
  onFreshTitle?(): void
  /** Shown after the type chip, on its row (the note page's count of backlinks and mentions). */
  beside?: ReactNode
  /** Shown before the title, on its row (a task's tick). */
  beforeTitle?: ReactNode
}

/** A hover action. Used as a popover trigger (`asChild`), so it passes the trigger's ref and props on. */
function HoverAction({ label, icon, ...props }: { label: string; icon: string } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[14px] text-fg-muted hover:bg-hover hover:text-fg"
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  )
}

/** A trigger that opens a picker in a popover. */
function PickerPopover({ trigger, children }: { trigger: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-line bg-raised p-0 text-fg">
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  )
}

export function ObjectHeader({
  summary,
  type,
  readOnly,
  onRename,
  onDraft,
  onPropertiesChange,
  onOpenTag,
  onEnterBody,
  onFreshTitle,
  beside,
  beforeTitle,
}: ObjectHeaderProps) {
  const color = type?.color ?? 'gray'
  const editable = !readOnly && !!onPropertiesChange
  const titleEditable = !readOnly && !!onRename && !isDailyNoteType(type, summary.type)
  const icon = decodeIcon(summary.icon, summary.iconColor)
  const tagObject = isTagType(type, summary.type)

  // After a rename that moved the file while the person was still in the title, the field shows
  // its own text from the first render (`renameHandover.ts`), not the title the server answered.
  const [draft, setDraft] = useState(() => peekTitleDraft(summary.path) ?? summary.title)
  const focusedRef = useRef(false)
  const titleRef = useRef<HTMLInputElement | null>(null)
  /** An IME composition is running in the title: its text is not final. */
  const [composing, setComposing] = useState(false)
  /** The title sent and not yet answered: the same text is not sent twice. */
  const sentRef = useRef<string | null>(null)
  /** The title the server last refused: the timer leaves it alone until the text changes. */
  const [refused, setRefused] = useState<string | null>(null)
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  /** The `#query` being typed in the title: where the `#` is, and the text after it. */
  const [hash, setHash] = useState<{ start: number; end: number; query: string } | null>(null)
  const [addingDescription, setAddingDescription] = useState(false)
  const [addingAliases, setAddingAliases] = useState(false)

  useEffect(() => {
    sentRef.current = null
    if (!focusedRef.current && hash === null) setDraft(summary.title)
  }, [summary.title, hash])

  const onRenameRef = useRef(onRename)
  onRenameRef.current = onRename
  /** Send `t` as the new title, once: the same text is not sent again while it is on its way. */
  const send = (t: string) => {
    if (sentRef.current === t) return
    sentRef.current = t
    const answer = onRenameRef.current?.(t)
    if (!answer) return
    void answer.then((ok) => {
      if (sentRef.current === t) sentRef.current = null
      if (!ok && aliveRef.current) setRefused(t)
    })
  }
  const sendRef = useRef(send)
  sendRef.current = send

  // M32 (W1): the title is kept like the text. A typed title that differs from the note's is
  // committed 2 s after the last key; the field is not touched (its text, the focus and the
  // selection stay; keys typed while the rename runs stay too, and the next pause commits them).
  // An emptied title waits (the person may be retyping), as does a `#tag` being picked, an IME
  // composition, and a title the server just refused.
  const waiting = titleEditable ? titleToCommit(draft, summary.title) : null
  const onDraftRef = useRef(onDraft)
  onDraftRef.current = onDraft
  useEffect(() => {
    onDraftRef.current?.(waiting)
  }, [waiting])
  useEffect(() => {
    if (waiting === null || hash !== null || composing || waiting === refused) return
    const timer = setTimeout(() => sendRef.current(waiting), TITLE_COMMIT_MS)
    return () => clearTimeout(timer)
    // `draft`: every key starts the wait again, also one that leaves the trimmed title as it was.
  }, [waiting, draft, hash, composing, refused])

  // The view our own rename replaced left the title field for this one: the focus and the
  // selection are put back before the first paint, so no key lands anywhere else. A view of the
  // same note in another place does not take them, and shows the note's title.
  const handedDraftRef = useRef(draft !== summary.title)
  useLayoutEffect(() => {
    const el = titleRef.current
    const field = el ? claimTitle(summary.path, el.closest('[data-object-view]')?.parentElement ?? null) : null
    if (field && el && titleEditable) {
      focusedRef.current = true
      el.focus({ preventScroll: true })
      if (field.start !== null && field.end !== null) el.setSelectionRange(field.start, field.end, field.direction ?? undefined)
    } else if (handedDraftRef.current) {
      setDraft(summary.title)
    }
    // Once, at mount: a handover is for the view that takes the leaving one's place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A freshly created object ("+ New" and friends) starts with its title focused and selected, so
  // typing names it at once (acceptance M2#3). The mark is taken once, by the first header to show it.
  const path = summary.path
  useEffect(() => {
    if (!takeFresh(path) || !titleEditable) return
    onFreshTitle?.()
    requestAnimationFrame(() => {
      const el = titleRef.current
      if (!el) return
      el.focus()
      el.select()
    })
  }, [path, titleEditable, onFreshTitle])

  // "Add description" reveals the field and puts the caret in it.
  const descriptionRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (addingDescription) descriptionRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [addingDescription])

  const write = (updates: Record<string, unknown>) => onPropertiesChange?.(updates)

  const commitTitle = (text: string) => {
    const t = text.trim()
    if (!t || t === summary.title) {
      setDraft(summary.title)
      return
    }
    setDraft(t)
    send(t)
  }

  const onTitleChange = (value: string, caret: number | null) => {
    setDraft(value)
    const at = caret ?? value.length
    const m = HASH_QUERY.exec(value.slice(0, at))
    if (m) {
      const start = at - m[1].length - 1
      setHash({ start, end: at, query: m[1] })
    } else {
      setHash(null)
    }
  }

  const setTags = (next: string[]) => {
    ensureNewTags(summary.tags, next)
    write({ tags: next })
  }

  const pickHashTag = (next: string[]) => {
    const h = hash
    if (!h) return
    const added = next.filter((n) => !summary.tags.some((t) => t.toLowerCase() === n.toLowerCase()))
    const cut = (draft.slice(0, h.start) + draft.slice(h.end)).replace(/\s+$/, '')
    setHash(null)
    setDraft(cut)
    if (added.length) setTags([...summary.tags, ...added])
    // The title keeps focus; it commits on Enter or blur as usual.
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const closeHash = () => {
    setHash(null)
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const iconPicker = (close: () => void) => (
    <IconPicker
      value={icon}
      onChange={(next) => {
        write({ icon: next })
        if (next === null || next.type === 'emoji') close()
      }}
    />
  )

  const showDescription = !!summary.description || addingDescription
  const showAliases = summary.aliases.length > 0 || addingAliases

  return (
    <header className="group/header mb-9">
      <div className="flex items-center gap-2">
        <span
          data-type-chip=""
          data-color={color}
          style={chipStyle(color)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--chip-bg)_85%,white)] bg-[var(--chip-bg)] px-2 text-[15px] font-medium text-[var(--chip-fg)]"
        >
          <IconOrEmoji icon={type?.icon ?? null} fallback="ph-file-text" size={15} />
          {/* M32: the built-in Page reads "Note", DailyNote "Daily note"; a renamed type keeps its name. */}
          {typeLabel(type, summary.type)}
        </span>
        {beside}
      </div>

      {editable && (
        <div
          data-header-actions=""
          className="mt-2 flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100"
        >
          {!icon && (
            <PickerPopover trigger={<HoverAction label="Add icon" icon="ph-smiley" />}>{iconPicker}</PickerPopover>
          )}
          {!summary.coverImage && (
            <PickerPopover trigger={<HoverAction label="Add cover image" icon="ph-image" />}>
              {(close) => (
                <ImagePicker
                  value={null}
                  onChange={(path) => {
                    close()
                    if (path) write({ coverImage: path })
                  }}
                />
              )}
            </PickerPopover>
          )}
          {!showDescription && (
            <HoverAction label="Add description" icon="ph-info" onClick={() => setAddingDescription(true)} />
          )}
          {!showAliases && <HoverAction label="Add aliases" icon="ph-cards" onClick={() => setAddingAliases(true)} />}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        {beforeTitle}
        {icon &&
          (editable ? (
            <PickerPopover
              trigger={
                <button
                  type="button"
                  aria-label="Change icon"
                  title="Change icon"
                  className="flex shrink-0 items-center rounded-md hover:bg-hover"
                  style={icon.type === 'iconify' && icon.color ? { color: lineColor(icon.color) } : undefined}
                >
                  <ObjectIcon icon={icon} size={36} />
                </button>
              }
            >
              {iconPicker}
            </PickerPopover>
          ) : (
            <span style={icon.type === 'iconify' && icon.color ? { color: lineColor(icon.color) } : undefined}>
              <ObjectIcon icon={icon} size={36} />
            </span>
          ))}
        {tagObject && editable && (
          <PickerPopover
            trigger={
              <button
                type="button"
                aria-label="Tag color"
                title="Tag color"
                className="size-5 shrink-0 rounded-full border border-line"
                style={{ backgroundColor: lineColor(summary.color) }}
              />
            }
          >
            {(close) => (
              <ColorPicker
                className="p-2"
                value={summary.color}
                onChange={(c) => {
                  close()
                  if (`bg-${c}` !== summary.color) write({ color: `bg-${c}` })
                }}
              />
            )}
          </PickerPopover>
        )}
        <Popover open={hash !== null} onOpenChange={(o) => !o && closeHash()}>
          <PopoverAnchor asChild>
            <h1 className="min-w-0 flex-1">
            <input
              ref={titleRef}
              aria-label="Title"
              value={draft}
              placeholder="Untitled"
              readOnly={!titleEditable}
              onFocus={() => (focusedRef.current = true)}
              onChange={(e) => onTitleChange(e.target.value, e.target.selectionStart)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onKeyDown={(e) => {
                // Keys that confirm or cancel an IME composition belong to the IME.
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                // Escape with the `#query` tag picker open closes only the picker.
                if (e.key === 'Escape' && hash !== null) {
                  e.preventDefault()
                  closeHash()
                  return
                }
                // M32: Enter, ArrowDown or Tab go on to the body (the caret at its start); the
                // blur that causes commits the typed title. Tab never walks the property pane.
                const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
                if (plain && hash === null && (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'Tab') && onEnterBody?.()) {
                  e.preventDefault()
                  return
                }
                // As the table's title cells: Enter and Escape both end the edit, which
                // commits the typed text (an empty title still reverts).
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
              }}
              onBlur={() => {
                focusedRef.current = false
                // Picking a tag for `#query` moves the focus; the title commits after.
                if (hash !== null || !titleEditable) return
                commitTitle(draft)
              }}
              className="w-full bg-transparent text-[36px] leading-tight font-bold text-fg outline-none placeholder:text-fg-muted"
            />
            </h1>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-auto border-line bg-raised p-0 text-fg"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {hash !== null && (
              <TagPicker
                key={hash.start}
                value={summary.tags}
                initialQuery={hash.query}
                onChange={pickHashTag}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>

      {showDescription && (
        <div ref={descriptionRef} className="mt-2 text-fg-muted">
          <DescriptionCell
            def={DESCRIPTION_DEF}
            value={summary.description}
            readOnly={!editable}
            onChange={(next) => {
              setAddingDescription(false)
              write({ description: next })
            }}
          />
        </div>
      )}

      {showAliases && (
        <div className="mt-2" aria-label="Aliases">
          <AliasesCell
            def={ALIASES_DEF}
            value={summary.aliases}
            readOnly={!editable}
            onChange={(next) => write({ aliases: next })}
          />
        </div>
      )}

      <HeaderTags tags={summary.tags} readOnly={!editable} onChange={setTags} onOpenTag={onOpenTag} />
    </header>
  )
}

/**
 * The header's "Tags" row on its own: the tag chips, or the muted "Tags" placeholder that opens the
 * tag picker. The calendar's inline daily note draws it above the body, also for a day with no note yet.
 */
export function HeaderTags({
  tags,
  readOnly,
  onChange,
  onOpenTag,
  className = 'mt-2',
}: {
  tags: string[]
  readOnly?: boolean
  onChange(next: string[]): void
  onOpenTag?(name: string): void
  className?: string
}) {
  return (
    <div className={className} data-header-tags="">
      <TagsCell
        def={TAGS_DEF}
        value={tags}
        readOnly={readOnly}
        onChange={onChange}
        onOpenTag={(name) => (onOpenTag ? onOpenTag(name) : void openTag(name).catch(() => undefined))}
      />
    </div>
  )
}
