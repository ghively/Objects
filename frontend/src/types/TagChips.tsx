// The Tag type's page lists every tag as a coloured chip with its number of uses (the audit's
// reading of Object's Tags page, 2026-11-02). Counts come from the link index's summaries:
// an object uses a tag when its `tags` holds the tag's title (case-insensitively); templates
// don't count.
import { useMemo } from 'react'
import type { ObjectSummary } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { useTagObjects } from '@/properties/TagPicker'
import { tagStyle } from '@/theme/palette'

export interface TagCount {
  tag: ObjectSummary
  count: number
}

/** Each tag with its count, most used first, then by title (our choice). */
export function tagCounts(tags: ObjectSummary[], objects: ObjectSummary[]): TagCount[] {
  const uses = new Map<string, number>()
  for (const o of objects) {
    if (o.template) continue
    for (const name of new Set(o.tags.map((t) => t.toLowerCase()))) uses.set(name, (uses.get(name) ?? 0) + 1)
  }
  return tags
    .map((tag) => ({ tag, count: uses.get(tag.title.toLowerCase()) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.tag.title.localeCompare(b.tag.title))
}

export function TagChips() {
  const tags = useTagObjects()
  const objects = useLinkIndex((s) => s.objects)
  const counts = useMemo(() => tagCounts(tags, objects), [tags, objects])
  if (counts.length === 0) return null
  return (
    <div data-testid="tag-chips" className="flex flex-wrap gap-1.5">
      {counts.map(({ tag, count }) => (
        <button
          key={tag.path}
          type="button"
          data-testid="tag-chip"
          onClick={() => useTabs.getState().open({ kind: 'object', path: tag.path })}
          style={tagStyle(tag.color)}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-[1px] text-[13px] hover:opacity-80"
        >
          <span>{tag.title}</span>
          <span className="text-[12px] tabular-nums opacity-70">{count}</span>
        </button>
      ))}
    </div>
  )
}
