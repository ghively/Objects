import { useEffect, useMemo, useState } from 'react'
import type { ObjectSummary } from '@/api/types'
import { Icon } from '@/components/Icon'
import { fuzzyMatch } from '@/links/LinkPicker'
import { ensureLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { tagStyle } from '@/theme/palette'

const TAG_TYPE = 'tag'
const LIMIT = 30

export interface TagPickerProps {
  /** The object's tag names. */
  value: string[]
  onChange(next: string[]): void
  /** Opens a tag's object page (a click on a selected tag). */
  onOpenTag?(name: string): void
  /** The search to start with (the title's `#query`). */
  initialQuery?: string
}

/** The space's Tag objects. */
export function useTagObjects(): ObjectSummary[] {
  const objects = useLinkIndex((s) => s.objects)
  return useMemo(() => objects.filter((o) => o.type === TAG_TYPE && !o.template), [objects])
}

/** The colour of the tag called `name` (its Tag object's `color`), or null. */
export function tagColor(tags: ObjectSummary[], name: string): string | null {
  const lower = name.toLowerCase()
  return tags.find((t) => t.title.toLowerCase() === lower)?.color ?? null
}

/**
 * "Search for tags or create one": the selected tags (click opens, × removes), then matching tags
 * not yet selected, then "Create 'x'" when no tag has that name. The parent creates the Tag
 * object (`api.ensureTag`) when it saves.
 */
export function TagPicker({ value, onChange, onOpenTag, initialQuery }: TagPickerProps) {
  const tags = useTagObjects()
  const [query, setQuery] = useState(initialQuery ?? '')

  useEffect(() => {
    void ensureLinkIndex()
  }, [])

  const q = query.trim()
  const has = (name: string) => value.some((v) => v.toLowerCase() === name.toLowerCase())
  const available = useMemo(() => tags.filter((t) => !value.some((v) => v.toLowerCase() === t.title.toLowerCase())), [tags, value])
  const shown = q ? fuzzyMatch(q, available, LIMIT) : available.slice(0, LIMIT)
  const canCreate = q !== '' && !has(q) && !tags.some((t) => t.title.toLowerCase() === q.toLowerCase())

  const add = (name: string) => {
    setQuery('')
    if (!has(name)) onChange([...value, name])
  }

  return (
    <div className="flex max-h-[20rem] w-72 flex-col">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-line p-1.5">
          {value.map((name) => (
            <span
              key={name}
              className="inline-flex items-center rounded-md text-[13px]"
              style={tagStyle(tagColor(tags, name))}
            >
              <button type="button" onClick={() => onOpenTag?.(name)} className="px-1.5 py-[1px]">
                {name}
              </button>
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(value.filter((v) => v !== name))}
                className="flex h-4 w-4 items-center justify-center rounded opacity-70 hover:opacity-100"
              >
                <Icon name="ph-x" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="border-b border-line p-1.5">
        <input
          aria-label="Search for tags"
          placeholder="Search for tags or create one"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !q) return
            e.preventDefault()
            const exact = tags.find((t) => t.title.toLowerCase() === q.toLowerCase())
            add(exact ? exact.title : q)
          }}
          className="h-7 w-full rounded bg-transparent px-1.5 text-[14px] text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      <div role="listbox" aria-label="Tags" className="flex-1 overflow-y-auto p-1">
        {shown.map((t) => (
          <div
            key={t.path}
            role="option"
            aria-selected={false}
            tabIndex={-1}
            onClick={() => add(t.title)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add(t.title)
            }}
            className="flex cursor-pointer items-center rounded px-2 py-1 hover:bg-hover"
          >
            <span className="rounded-md px-1.5 py-[1px] text-[13px]" style={tagStyle(t.color)}>
              {t.title}
            </span>
          </div>
        ))}
        {canCreate && (
          <div
            role="option"
            aria-selected={false}
            tabIndex={-1}
            onClick={() => add(q)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add(q)
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[14px] text-fg hover:bg-hover"
          >
            <Icon name="ph-plus" size={14} />
            {`Create '${q}'`}
          </div>
        )}
      </div>
    </div>
  )
}
