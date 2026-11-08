/**
 * "Page layout": four cards, each a small SVG sketch of the layout (our own drawings), for the
 * type's `viewDesign`. Standard is `null`.
 */
import type { ReactNode } from 'react'
import type { ViewDesign } from '@/api/types'
import { cn } from '@/lib/utils'

export interface PageLayoutCardsProps {
  value: ViewDesign | null
  onChange(next: ViewDesign | null): void
  disabled?: boolean
}

export const PAGE_LAYOUTS: readonly { value: ViewDesign | null; name: string; description: string }[] = [
  { value: null, name: 'Standard', description: 'A plain, all-purpose layout.' },
  { value: 'indexCard', name: 'Index card', description: 'A small layout for short notes and drafts.' },
  {
    value: 'profile',
    name: 'Profile',
    description: 'Round image with properties at the side, made for people and organizations.',
  },
  {
    value: 'encyclopedia',
    name: 'Encyclopedia',
    description: 'Properties at the side, plus contents, links and text statistics.',
  },
]

const line = (x: number, y: number, w: number, key?: string | number) => (
  <rect key={key} x={x} y={y} width={w} height={3} rx={1.5} fill="currentColor" opacity={0.35} />
)

function Sketch({ value }: { value: ViewDesign | null }): ReactNode {
  const body = [0, 1, 2].map((i) => line(10, 46 + i * 7, 60 - i * 8, i))
  switch (value) {
    case 'indexCard':
      return (
        <>
          <rect x={10} y={8} width={34} height={5} rx={2} fill="currentColor" opacity={0.7} />
          <rect x={10} y={18} width={60} height={20} rx={3} fill="none" stroke="currentColor" opacity={0.5} />
          {line(14, 23, 30)}
          {line(14, 30, 40)}
          {body}
        </>
      )
    case 'profile':
      return (
        <>
          <circle cx={20} cy={18} r={9} fill="currentColor" opacity={0.45} />
          <rect x={34} y={14} width={30} height={5} rx={2} fill="currentColor" opacity={0.7} />
          {line(10, 34, 18)}
          {line(10, 40, 18)}
          {line(10, 46, 18)}
          {[0, 1, 2, 3].map((i) => line(34, 32 + i * 7, 36 - (i % 2) * 8, `b${i}`))}
        </>
      )
    case 'encyclopedia':
      return (
        <>
          <rect x={10} y={8} width={34} height={5} rx={2} fill="currentColor" opacity={0.7} />
          {[0, 1, 2, 3, 4].map((i) => line(10, 20 + i * 7, 36 - (i % 2) * 8, `b${i}`))}
          <rect x={52} y={18} width={20} height={34} rx={3} fill="none" stroke="currentColor" opacity={0.5} />
          {line(55, 24, 14)}
          {line(55, 31, 12)}
          {line(55, 38, 14)}
        </>
      )
    default:
      return (
        <>
          <rect x={10} y={8} width={34} height={5} rx={2} fill="currentColor" opacity={0.7} />
          {line(10, 20, 40)}
          {line(10, 27, 32)}
          {line(10, 34, 40)}
          {body}
        </>
      )
  }
}

export function PageLayoutCards({ value, onChange, disabled }: PageLayoutCardsProps) {
  return (
    <div role="radiogroup" aria-label="Page layout" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {PAGE_LAYOUTS.map((l) => {
        const selected = (value ?? null) === l.value
        return (
          <button
            key={l.name}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={l.name}
            title={l.description}
            disabled={disabled}
            onClick={() => !selected && onChange(l.value)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-lg border border-line p-2 text-[13px] hover:bg-hover disabled:opacity-60',
              selected && 'border-fg bg-hover',
            )}
          >
            <svg viewBox="0 0 80 70" className="h-16 w-full text-fg" aria-hidden="true">
              <rect x={1} y={1} width={78} height={68} rx={6} fill="none" stroke="currentColor" opacity={0.2} />
              <Sketch value={l.value} />
            </svg>
            <span>{l.name}</span>
            <span className="text-center text-[11px] leading-tight text-fg-muted">{l.description}</span>
          </button>
        )
      })}
    </div>
  )
}
