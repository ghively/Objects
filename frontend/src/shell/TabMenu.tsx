/**
 * The "Tab menu": a searchable list of the open tabs. Typing filters by
 * title, the arrow keys move the highlight, Enter activates. Opened by its button in the tab strip
 * or by the `openTabList` shortcut (through `useTabMenu`).
 */
import { useMemo, useState } from 'react'
import { create } from 'zustand'
import type { SpaceInfo } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { tabTarget, useTabs } from '@/nav/tabs'
import { TargetLabel, useTargetTitle } from '@/shell/TabStrip'

interface TabMenuState {
  open: boolean
  setOpen(open: boolean): void
}

export const useTabMenu = create<TabMenuState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

function TabMenuList({ space, onDone }: { space: SpaceInfo | null; onDone: () => void }) {
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const titleOf = useTargetTitle(space)
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tabs.filter((t) => !q || titleOf(tabTarget(t)).toLowerCase().includes(q))
  }, [tabs, query, titleOf])
  const index = Math.min(hi, Math.max(0, matches.length - 1))

  const choose = (id: string) => {
    useTabs.getState().activate(id)
    onDone()
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Icon name="ph-magnifying-glass" size={15} className="text-fg-muted" />
        <input
          autoFocus
          aria-label="Search tabs"
          placeholder="Search tabs"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setHi(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHi(Math.min(index + 1, matches.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHi(Math.max(index - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const t = matches[index]
              if (t) choose(t.id)
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      {matches.length === 0 ? (
        <p className="px-3 py-3 text-[14px] text-fg-muted">No tabs found</p>
      ) : (
        <div role="listbox" aria-label="Tabs" className="max-h-[360px] overflow-y-auto p-1">
          {matches.map((t, i) => (
            <div
              key={t.id}
              role="option"
              aria-selected={i === index}
              aria-current={t.id === activeId ? 'page' : undefined}
              onMouseEnter={() => setHi(i)}
              onClick={() => choose(t.id)}
              className={cn(
                'flex h-8 min-w-0 cursor-default items-center gap-2 rounded-md px-2 text-[14px]',
                !t.persistent && 'italic',
                i === index && 'bg-hover',
              )}
            >
              <TargetLabel target={tabTarget(t)} space={space} />
              {t.pinned && <Icon name="ph-push-pin" size={13} className="ml-auto shrink-0 text-fg-muted" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TabMenu({ space }: { space: SpaceInfo | null }) {
  const open = useTabMenu((s) => s.open)
  const setOpen = useTabMenu((s) => s.setOpen)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Tab menu"
          title="Tab menu"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg hover:bg-hover"
        >
          <Icon name="ph-caret-down" size={15} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] border-line bg-raised p-0 text-fg">
        <TabMenuList space={space} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
