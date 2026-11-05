// M12: pieces the new kinds' settings sections share: the section frame (as PropertySettings
// draws its own) and the number format picker for formula and rollup results.
import { useState, type ReactNode } from 'react'
import type { PropertyDef } from '@/api/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CURRENCIES } from '../currencies'
import { NumberFormatMenu } from '../NumberFormatMenu'
import { setDecimals, setNumberFormat } from '../typeEdits'

export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-line pt-3">
      <h3 className="text-[14px] font-semibold">{title}</h3>
      {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

function formatName(def: PropertyDef): string {
  const f = def.options.numberFormat
  if (!f) return 'None'
  if (f.type === 'currency') return CURRENCIES.find((c) => c.code === f.options.currency)?.name ?? 'Currency'
  return f.type.charAt(0).toUpperCase() + f.type.slice(1)
}

/**
 * The number format of a computed result: the same picker and decimals as a number property
 * (`NumberFormatMenu`, `setNumberFormat`, `setDecimals`). Progress keeps its defaults here.
 */
export function ResultNumberFormat({
  title,
  description,
  def,
  save,
}: {
  title: string
  description?: string
  def: PropertyDef
  save(next: PropertyDef): void
}) {
  const [open, setOpen] = useState(false)
  const fmt = def.options.numberFormat
  const decimals = fmt?.options.decimals
  const d = decimals?.max ?? decimals?.min ?? 0
  return (
    <SettingsSection title={title} description={description}>
      <div className="flex items-center gap-2">
        <span className="w-28 text-[13px] text-fg-muted">Type</span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Number format" className="rounded border border-line px-2 py-0.5 text-[13px]">
              {formatName(def)}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
            <NumberFormatMenu
              value={fmt}
              onChange={(c) => {
                setOpen(false)
                save(setNumberFormat(def, c))
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
      {fmt && (
        <div className="mt-2 flex items-center gap-2">
          <span className="w-28 text-[13px] text-fg-muted">Decimals</span>
          {decimals ? (
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Fewer decimals"
                disabled={d <= 0}
                onClick={() => save(setDecimals(def, d - 1))}
                className="rounded border border-line px-1.5 text-[13px] disabled:opacity-40"
              >
                −
              </button>
              <span data-decimals className="w-5 text-center text-[13px]">
                {d}
              </span>
              <button
                type="button"
                aria-label="More decimals"
                disabled={d >= 5}
                onClick={() => save(setDecimals(def, d + 1))}
                className="rounded border border-line px-1.5 text-[13px] disabled:opacity-40"
              >
                +
              </button>
              <button
                type="button"
                aria-label="Stop enforcing decimals"
                onClick={() => save(setDecimals(def, null))}
                className="rounded px-1.5 text-[13px] text-fg-muted hover:text-fg"
              >
                ✕
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => save(setDecimals(def, 2))} className="text-[13px] text-fg-muted hover:text-fg">
              + Enforce
            </button>
          )}
        </div>
      )}
    </SettingsSection>
  )
}
