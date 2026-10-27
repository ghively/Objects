/**
 * The breadcrumb row at the top of the main panel content: the active entry's trail (the pages
 * followed by link to get here), each as its icon and title, then the current page, separated by
 * carets. A crumb goes back to its history entry; the current page is not clickable. Long trails
 * collapse the middle into "…" with a menu. Nothing renders when the trail is empty.
 *
 * Capacities has no reference screenshot for this row: its position and styling are ours, flagged
 * for Gene's hands-on check.
 */
import type { ReactNode } from 'react'
import type { SpaceInfo } from '@/api/types'
import { Icon } from '@/components/Icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { activeTab, tabCrumbs, tabTarget, useTabs } from '@/nav/tabs'
import { TargetLabel } from '@/shell/TabStrip'

/** Trails longer than this show the first crumb, "…", and the last two. */
export const MAX_VISIBLE_CRUMBS = 3

function Separator() {
  return (
    <span aria-hidden className="flex shrink-0 items-center text-fg-muted">
      <Icon name="ph-caret-right" size={12} />
    </span>
  )
}

const crumbClass =
  'flex h-7 min-w-0 max-w-[220px] shrink items-center gap-1.5 rounded-md px-1.5 text-[14px] [&_[data-type-chip]]:size-[18px]'

export function Breadcrumbs({ space }: { space: SpaceInfo | null }) {
  const tab = useTabs(activeTab)
  const goToCrumb = useTabs((s) => s.goToCrumb)
  const trail = tabCrumbs(tab)
  const current = tabTarget(tab)
  if (trail.length === 0 || !current) return null

  const collapse = trail.length > MAX_VISIBLE_CRUMBS
  const hidden = collapse ? trail.slice(1, trail.length - 2).map((t, i) => ({ t, k: i + 1 })) : []
  const shown = trail.map((t, k) => ({ t, k })).filter(({ k }) => !collapse || k === 0 || k >= trail.length - 2)

  const crumb = ({ t, k }: { t: (typeof trail)[number]; k: number }) => (
    <button
      key={`c${k}`}
      type="button"
      data-crumb={k}
      onClick={() => goToCrumb(k)}
      className={`${crumbClass} text-fg-muted hover:bg-hover hover:text-fg`}
    >
      <TargetLabel target={t} space={space} />
    </button>
  )

  const items: ReactNode[] = []
  shown.forEach((c, i) => {
    if (i > 0) items.push(<Separator key={`s${c.k}`} />)
    items.push(crumb(c))
    if (collapse && c.k === 0) {
      items.push(<Separator key="s-more" />)
      items.push(
        <DropdownMenu key="more">
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Show hidden breadcrumbs"
              className="flex h-7 shrink-0 items-center rounded-md px-1.5 text-[14px] text-fg-muted hover:bg-hover hover:text-fg"
            >
              …
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="border-line bg-raised text-fg">
            {hidden.map(({ t, k }) => (
              <DropdownMenuItem key={k} data-crumb={k} onSelect={() => goToCrumb(k)} className="max-w-[280px]">
                <TargetLabel target={t} space={space} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>,
      )
    }
  })

  return (
    <nav
      aria-label="Breadcrumbs"
      className="flex h-10 shrink-0 items-center gap-0.5 overflow-hidden bg-panel px-3"
    >
      {items}
      <Separator />
      <span aria-current="page" className={`${crumbClass} text-fg`}>
        <TargetLabel target={current} space={space} />
      </span>
    </nav>
  )
}
