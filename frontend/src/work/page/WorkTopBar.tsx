// The Tasks dashboard's controls (Gene's redesign; ported from M23's top bar): Energy (pressing the
// chosen one clears it), Just one thing and the agent pill sit quietly at the view row's right end;
// the search (typing switches to Everything, filtered; Esc clears) sits in the page header.
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

/** A pill toggle in the app's own pill style (the task tabs, the view switcher). */
const TOGGLE =
  'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-fg-muted hover:bg-hover aria-pressed:bg-hover-2 aria-pressed:text-fg'

/** Energy, Just one thing and the agent pill. */
export function WorkControls({ data }: { data: WorkDataState }): JSX.Element {
  const energy = useWorkUi((s) => s.energy)
  const calm = useWorkUi((s) => s.calm)

  const pickEnergy = (e: Energy) => useWorkUi.getState().setEnergy(energy === e ? null : e)
  const toggleCalm = () => {
    const ui = useWorkUi.getState()
    ui.setCalm(!calm)
    if (!calm) ui.setView('now')
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 self-start">
      <div role="group" aria-label={WORK_TEXT.energy} className="flex items-center gap-0.5">
        <span className="px-1 text-[13px] text-fg-muted">{WORK_TEXT.energy}</span>
        {ENERGIES.map((e) => (
          <button key={e.id} type="button" aria-pressed={energy === e.id} className={TOGGLE} onClick={() => pickEnergy(e.id)}>
            <Icon name={e.icon} size={13} />
            {e.label}
          </button>
        ))}
      </div>
      <button type="button" aria-pressed={calm} className={TOGGLE} onClick={toggleCalm}>
        <Icon name={WORK_ICONS.focus} size={13} />
        {WORK_TEXT.justOneThing}
      </button>
      <AgentPill carrying={data.agent?.carrying ?? 0} alerts={activeAlerts(data)} />
    </div>
  )
}

/** The search field. */
export function WorkSearch(): JSX.Element {
  const { q, setQ } = useWorkSearch()
  const search = (text: string) => {
    setQ(text)
    if (text.trim() && !useWorkUi.getState().calm) useWorkUi.getState().setView('everything')
  }
  return (
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
        'h-8 w-56 min-w-0 rounded-lg border border-line bg-raised px-2.5 text-[14px] text-fg outline-none',
        'placeholder:text-fg-muted focus:border-fg-muted',
      )}
    />
  )
}

/** M23's top bar, kept for anything that still renders it whole: the controls and the search. */
export function WorkTopBar({ data }: { data: WorkDataState }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <WorkControls data={data} />
      <div className="ml-auto flex min-w-0 items-center">
        <WorkSearch />
      </div>
    </div>
  )
}

/** Focus the search field (`/`). */
export function focusSearchField(): void {
  const el = document.querySelector<HTMLInputElement>('[data-work-search]')
  el?.focus()
}
