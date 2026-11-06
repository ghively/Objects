// M23 Task 8: a station's or a turn's icon (WORK_ICONS) in its tone.
import type { JSX } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { WORK_ICONS } from '../workIcons'
import { TONE_TEXT, type ChipTone } from './Chip'

/** T7's `StationState` (logic/stations.ts), restated so this file stands on its own. */
type StationState = 'done' | 'doing' | 'waiting' | 'notStarted'
export type StatusIconState = StationState | 'you' | 'agent' | 'approval'

const ICON: Record<StatusIconState, string> = {
  done: WORK_ICONS.done,
  doing: WORK_ICONS.doing,
  waiting: WORK_ICONS.parked,
  notStarted: WORK_ICONS.open,
  you: WORK_ICONS.you,
  agent: WORK_ICONS.agent,
  approval: WORK_ICONS.approval,
}

const TONE: Record<StatusIconState, ChipTone> = {
  done: 'ok',
  doing: 'you',
  waiting: 'others',
  notStarted: 'muted',
  you: 'you',
  agent: 'agent',
  approval: 'approve',
}

export function StatusIcon({ state }: { state: StatusIconState }): JSX.Element {
  return (
    <span data-state={state} data-tone={TONE[state]} className={cn('inline-flex shrink-0', TONE_TEXT[TONE[state]])}>
      <Icon name={ICON[state]} size={14} />
    </span>
  )
}
