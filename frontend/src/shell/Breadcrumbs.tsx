/**
 * The breadcrumb row at the top of the main panel content: the active entry's trail (the pages
 * followed by link to get here), each as its icon and title, then the current page, separated by
 * `/`. A crumb goes back to its history entry; the current page is not clickable.
 * At most 3 crumbs inline counting the current page; every earlier crumb goes
 * into a menu behind a leading dots button, most recent first. Earlier crumbs are at 80 % opacity
 * (100 % on hover). Nothing renders when the trail is empty.
 *
 * The row's host element and position are not pinned down: flagged for Gene's check.
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

/** Crumbs shown inline, the current page included. */
export const MAX_VISIBLE_CRUMBS = 3

function Separator() {
  return (
    <span aria-hidden className="shrink-0 px-1 text-fg-muted select-none">
      /
    </span>
  )
}

const crumbClass =
  'flex h-7 min-w-0 max-w-full shrink items-center gap-1.5 rounded-md px-1 text-sm select-none [&_[data-type-chip]]:size-[18px]'

export function Breadcrumbs({ space }: { space: SpaceInfo | null }) {
  const tab = useTabs(activeTab)
  const goToCrumb = useTabs((s) => s.goToCrumb)
  const trail = tabCrumbs(tab)
  const current = tabTarget(tab)
  if (trail.length === 0 || !current) return null

  // The path is the trail plus the current page; all but its last 3 go into the menu.
  const cut = Math.max(0, trail.length + 1 - MAX_VISIBLE_CRUMBS)
  const hidden = trail
    .slice(0, cut)
    .map((t, k) => ({ t, k }))
    .reverse()
  const shown = trail.map((t, k) => ({ t, k })).slice(cut)

  const items: ReactNode[] = []
  if (hidden.length > 0) {
    items.push(
      <DropdownMenu key="more">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Show hidden breadcrumbs"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Icon name="ph-dots-three-bold" size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 border-line bg-raised text-fg">
          {hidden.map(({ t, k }) => (
            <DropdownMenuItem key={k} data-crumb={k} onSelect={() => goToCrumb(k)}>
              <TargetLabel target={t} space={space} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>,
    )
  }
  for (const { t, k } of shown) {
    if (items.length > 0) items.push(<Separator key={`s${k}`} />)
    items.push(
      <button
        key={`c${k}`}
        type="button"
        data-crumb={k}
        onClick={() => goToCrumb(k)}
        className={`${crumbClass} cursor-pointer text-fg opacity-80 hover:bg-hover hover:opacity-100`}
      >
        <TargetLabel target={t} space={space} />
      </button>,
    )
  }

  return (
    <nav aria-label="Breadcrumbs" className="flex h-10 shrink-0 items-center overflow-hidden bg-panel px-3">
      {items}
      <Separator />
      <span aria-current="page" className={`${crumbClass} text-fg`}>
        <TargetLabel target={current} space={space} />
      </span>
    </nav>
  )
}
