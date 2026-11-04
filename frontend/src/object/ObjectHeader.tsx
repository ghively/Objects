/**
 * The object's header, in this order: type chip, icon (and a Tag's colour swatch), title,
 * description, aliases and tags. Hovering offers "Add icon", "Add cover image", "Add description"
 * and "Add aliases" for whichever is empty. Every edit writes through `onPropertiesChange` (the
 * view's serialized `updateProperties`); the title commits through `onRename`.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { Icon as IconValue, ObjectSummary, PropertyDef, TypeDef } from '@/api/types'
import { ColorPicker } from '@/components/ColorPicker'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { ImagePicker } from '@/components/ImagePicker'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTabs } from '@/nav/tabs'
import { AliasesCell } from '@/properties/cells/AliasesCell'
import { DescriptionCell } from '@/properties/cells/DescriptionCell'
import { TagsCell } from '@/properties/cells/TagsCell'
import { TagPicker } from '@/properties/TagPicker'
import { chipStyle, lineColor } from '@/theme/palette'
import { decodeIcon } from './PropertyPanel'

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
  /** Commit a new title (trimmed, changed, not empty). */
  onRename?(title: string): void
  /** Write frontmatter properties (API values). */
  onPropertiesChange?(updates: Record<string, unknown>): void
  /** Open a tag's page; default: `openTag`. */
  onOpenTag?(name: string): void
}

function HoverAction({ label, icon, onClick }: { label: string; icon: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
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

export function ObjectHeader({ summary, type, readOnly, onRename, onPropertiesChange, onOpenTag }: ObjectHeaderProps) {
  const color = type?.color ?? 'gray'
  const editable = !readOnly && !!onPropertiesChange
  const titleEditable = !readOnly && !!onRename && !isDailyNoteType(type, summary.type)
  const icon = decodeIcon(summary.icon, summary.iconColor)
  const tagObject = isTagType(type, summary.type)

  const [draft, setDraft] = useState(summary.title)
  const focusedRef = useRef(false)
  const titleRef = useRef<HTMLInputElement | null>(null)
  /** The `#query` being typed in the title: where the `#` is, and the text after it. */
  const [hash, setHash] = useState<{ start: number; end: number; query: string } | null>(null)
  const [addingDescription, setAddingDescription] = useState(false)
  const [addingAliases, setAddingAliases] = useState(false)

  useEffect(() => {
    if (!focusedRef.current && hash === null) setDraft(summary.title)
  }, [summary.title, hash])

  const write = (updates: Record<string, unknown>) => onPropertiesChange?.(updates)

  const commitTitle = (text: string) => {
    const t = text.trim()
    if (!t || t === summary.title) {
      setDraft(summary.title)
      return
    }
    setDraft(t)
    onRename?.(t)
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
          {type?.name ?? summary.type}
        </span>
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
              onKeyDown={(e) => {
                // Escape with the `#query` tag picker open closes only the picker.
                if (e.key === 'Escape' && hash !== null) {
                  e.preventDefault()
                  closeHash()
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
        <div className="mt-2 text-fg-muted">
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
