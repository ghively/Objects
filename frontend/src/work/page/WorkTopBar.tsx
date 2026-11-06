// M23 Task 9: the Work page's top bar: Energy (pressing the chosen one clears it, ported), Just one
// thing, the agent pill and the search (typing switches to Everything, filtered; Esc clears).
import type { JSX } from 'react'
import { create } from 'zustand'
import type { Energy } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import type { WorkDataState } from '../state/useWorkData'
import { useWorkUi } from '../state/useWorkUi'
import { activeAlerts } from '../views/registry'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'
import { AgentPill } from './AgentPill'

/** The search text (not stored: a new visit starts with none). */
export const useWorkSearch = create<{ q: string; setQ(q: string): void }>()((set) => ({
  q: '',
  setQ: (q) => set({ q }),
}))

/** Clear the search (Esc). */
export function clearWorkSearch(): void {
  useWorkSearch.getState().setQ('')
}

const ENERGIES: { id: Energy; label: string; icon: string }[] = [
  { id: 'low', label: WORK_TEXT.energyLow, icon: WORK_ICONS.low },
  { id: 'medium', label: WORK_TEXT.energyMedium, icon: WORK_ICONS.medium },
  { id: 'high', label: WORK_TEXT.energyHigh, icon: WORK_ICONS.high },
]

const TOGGLE =
  'inline-flex h-7 items-center gap-1 rounded border border-line px-2 text-[12px] text-fg-muted hover:bg-hover aria-pressed:border-[var(--work-you)] aria-pressed:text-[var(--work-you)]'

export function WorkTopBar({ data }: { data: WorkDataState }): JSX.Element {
  const energy = useWorkUi((s) => s.energy)
  const calm = useWorkUi((s) => s.calm)
  const { q, setQ } = useWorkSearch()

  const pickEnergy = (e: Energy) => useWorkUi.getState().setEnergy(energy === e ? null : e)
  const toggleCalm = () => {
    const ui = useWorkUi.getState()
    ui.setCalm(!calm)
    if (!calm) ui.setView('now')
  }
  const search = (text: string) => {
    setQ(text)
    if (text.trim() && !useWorkUi.getState().calm) useWorkUi.getState().setView('everything')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={WORK_TEXT.energy} className="flex items-center gap-1">
        <span className="text-[12px] text-fg-muted">{WORK_TEXT.energy}</span>
        {ENERGIES.map((e) => (
          <button key={e.id} type="button" aria-pressed={energy === e.id} className={TOGGLE} onClick={() => pickEnergy(e.id)}>
            <Icon name={e.icon} size={12} />
            {e.label}
          </button>
        ))}
      </div>
      <button type="button" aria-pressed={calm} className={TOGGLE} onClick={toggleCalm}>
        <Icon name={WORK_ICONS.focus} size={12} />
        {WORK_TEXT.justOneThing}
      </button>
      <AgentPill carrying={data.agent?.carrying ?? 0} alerts={activeAlerts(data)} />
      <div className="ml-auto flex min-w-0 items-center">
        <input
          type="search"
          data-work-search=""
          aria-label={WORK_TEXT.searchWork}
          placeholder={WORK_TEXT.searchWork}
          value={q}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setQ('')
            }
          }}
          className={cn(
            'h-7 w-56 min-w-0 rounded border border-line bg-transparent px-2 text-[13px] text-fg outline-none',
            'placeholder:text-fg-muted focus:border-[var(--work-you)]',
          )}
        />
      </div>
    </div>
  )
}

/** Focus the search field (`/`). */
export function focusSearchField(): void {
  const el = document.querySelector<HTMLInputElement>('[data-work-search]')
  el?.focus()
}
