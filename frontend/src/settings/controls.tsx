// Building blocks shared by the Settings modal's sections: the section header (icon tile,
// heading, description), a setting group (bold title, muted help, control), option cards and a
// switch row. Every colour is a theme token.
import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export function SectionHeader({ icon, heading, description }: { icon: string; heading: string; description: string }) {
  return (
    <header className="flex items-start gap-3 border-b border-line pb-5">
      <span
        data-section-icon={icon}
        className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-fg"
      >
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <h2 className="text-[20px] leading-7 font-semibold text-fg">{heading}</h2>
        <p className="text-[14px] text-fg-muted">{description}</p>
      </div>
    </header>
  )
}

/** One setting: a bold title, muted help and its control below. */
export function SettingGroup({
  title,
  help,
  children,
  className,
}: {
  title: string
  help?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section aria-label={title} className={cn('flex flex-col gap-2 py-4', className)}>
      <div>
        <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
        {help && <div className="mt-0.5 text-[13px] text-fg-muted">{help}</div>}
      </div>
      {children}
    </section>
  )
}

export interface OptionItem<T extends string> {
  value: T
  label: string
  description?: string
}

/** A radio group of option cards (name and description). */
export function OptionCards<T extends string>({
  label,
  value,
  options,
  onChange,
  columns,
}: {
  label: string
  value: T
  options: OptionItem<T>[]
  onChange(next: T): void
  columns?: number
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns ?? Math.min(options.length, 3)}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const checked = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.label}
            data-value={o.value}
            onClick={() => {
              if (!checked) onChange(o.value)
            }}
            className={cn(
              'flex min-w-0 flex-col items-start gap-0.5 rounded-lg border bg-raised px-3 py-2 text-left hover:bg-hover',
              checked ? 'border-fg-muted' : 'border-line',
            )}
          >
            <span className="flex w-full items-center gap-1.5 text-[14px] font-medium text-fg">
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {checked && <Icon name="ph-check" size={14} />}
            </span>
            {o.description && <span className="text-[12px] text-fg-muted">{o.description}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** A setting whose control is a switch at the row's end. */
export function SwitchRow({
  title,
  help,
  checked,
  onChange,
  children,
}: {
  title: string
  help?: ReactNode
  checked: boolean
  onChange(next: boolean): void
  children?: ReactNode
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 py-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
          {help && <div className="mt-0.5 text-[13px] text-fg-muted">{help}</div>}
        </div>
        <Switch aria-label={title} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-1" />
      </div>
      {children}
    </section>
  )
}

/** An outlined secondary button, as the settings buttons are. */
export function SecondaryButton({ children, onClick, disabled }: { children: ReactNode; onClick(): void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-line bg-raised px-3 text-[14px] font-medium text-fg hover:bg-hover disabled:opacity-60"
    >
      {children}
    </button>
  )
}

/** Shows a failed save under the controls. */
export function SaveError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="text-[13px] text-[var(--danger)]">
      {error}
    </p>
  )
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
