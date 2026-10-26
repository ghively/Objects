// "Queries": every query of the space, with New and a menu per row.
import { useMemo, type MouseEvent } from 'react'
import { api } from '@/api/client'
import type { Query } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { PinMenuItems } from '@/shell/PinToMenu'
import { autoTitle, queryTitle, titleIsCustom } from './autoTitle'
import { useTitleCtx } from './QueryPage'
import { removeQuery, useQueries } from './useQueries'
import { QUERY_ICON } from '@/lib/defIcons'

export const QUERIES_TEXT = {
  heading: 'Queries',
  new: 'New',
  emptyTitle: 'No queries',
  emptyBody: 'Queries you create in this database will appear here.',
  open: 'Open',
  pin: 'Pin to sidebar',
  delete: 'Delete',
}

/** Create a query and open it (the server gives it its id; it starts as an unready draft). */
export async function createQueryAndOpen(): Promise<Query> {
  const q = await api.createQuery()
  useTabs.getState().open({ kind: 'query', id: q.id })
  return q
}

export function QueriesPage() {
  const { queries, loaded } = useQueries()
  const types = useLinkIndex((s) => s.types)
  const ctx = useTitleCtx(types)
  const open = (id: string, e?: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>) =>
    useTabs.getState().open({ kind: 'query', id }, { newTab: !!e && (e.ctrlKey || e.metaKey) })

  const rows = useMemo(
    () =>
      queries
        .map((q) => ({
          q,
          title: queryTitle(q, ctx),
          subtitle: titleIsCustom(q) ? autoTitle(q.definition, ctx) : '',
          typeNames: q.definition.structures.map((s) => types.find((t) => t.id === s.id)?.pluralName).filter((n): n is string => !!n),
        }))
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
    [queries, ctx, types],
  )

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pt-5 pb-16">
      <header className="flex items-center gap-2.5 pb-4">
        <Icon name={QUERY_ICON} size={20} />
        <h1 className="dataview-heading min-w-0 flex-1 text-[20px] font-bold md:text-[22px]">{QUERIES_TEXT.heading}</h1>
        <button
          type="button"
          onClick={() => void createQueryAndOpen().catch((e: unknown) => console.warn('Could not create a query:', e))}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-[14px] font-medium hover:bg-hover"
        >
          <Icon name="ph-plus" size={14} />
          {QUERIES_TEXT.new}
        </button>
      </header>
      {loaded && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-10 text-center">
          <p className="text-[15px] text-fg">{QUERIES_TEXT.emptyTitle}</p>
          <p className="text-[14px] text-fg-muted">{QUERIES_TEXT.emptyBody}</p>
        </div>
      ) : (
        <ul className="flex flex-col" aria-label="Queries">
          {rows.map(({ q, title, subtitle, typeNames }) => (
            <li key={q.id} data-query-row={q.id} className="group flex items-center gap-1 rounded-lg hover:bg-hover">
              <button
                type="button"
                onClick={(e) => open(q.id, e)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-2 text-left"
              >
                <IconOrEmoji icon={q.icon} fallback={QUERY_ICON} size={16} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-medium">{title}</span>
                  {subtitle && <span className="truncate text-[13px] text-fg-muted">{subtitle}</span>}
                </span>
                {typeNames.length > 0 && <span className="truncate text-[13px] text-fg-muted">{typeNames.join(', ')}</span>}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${title} menu`}
                    className="flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover-2"
                  >
                    <Icon name="ph-dots-three" size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="border-line bg-raised">
                  <DropdownMenuItem onSelect={() => open(q.id)}>
                    <Icon name="ph-arrows-out-simple" size={14} />
                    {QUERIES_TEXT.open}
                  </DropdownMenuItem>
                  <PinMenuItems pin={{ kind: 'query', id: q.id }} />
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={!!q.readOnlyReason}
                    onSelect={() => void removeQuery(q.id).catch((e: unknown) => console.warn('Could not delete the query:', e))}
                  >
                    <Icon name="ph-trash" size={14} />
                    {QUERIES_TEXT.delete}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
