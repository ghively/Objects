// The step lines shown while the graph loads and lays out.

export const LOADING_STEPS = [
  'Reading notes',
  'Calculating connections',
  'Applying filters',
  'Arranging the layout',
  'Drawing the graph',
] as const

export interface GraphLoadingProps {
  /** Index of the current step in `LOADING_STEPS`. */
  step: number
  /** 0–1 progress of the current step, when known (the layout). */
  progress?: number
}

export function GraphLoading({ step, progress }: GraphLoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="graph-loading"
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
    >
      <ol className="flex flex-col gap-1.5 rounded-lg border border-line bg-raised px-4 py-3 text-[13px] shadow-lg">
        {LOADING_STEPS.map((label, i) => (
          <li
            key={label}
            data-state={i < step ? 'done' : i === step ? 'active' : 'todo'}
            className={i === step ? 'text-fg' : i < step ? 'text-fg-muted' : 'text-fg-muted opacity-50'}
          >
            {label}
            {i === step && progress !== undefined && progress > 0 && progress < 1 && (
              <span className="ml-2 tabular-nums text-fg-muted">{Math.round(progress * 100)}%</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
