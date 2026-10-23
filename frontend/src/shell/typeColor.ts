import type { CSSProperties } from 'react'

const KNOWN = new Set(['blue', 'green', 'orange', 'purple', 'pink', 'teal', 'yellow', 'red', 'gray'])

/** CSS custom properties for a type's colour chip (`--chip-fg`, `--chip-bg`). */
export function chipStyle(color: string): CSSProperties {
  const c = KNOWN.has(color) ? color : 'gray'
  return {
    '--chip-fg': `var(--type-${c}-fg)`,
    '--chip-bg': `var(--type-${c}-bg)`,
  } as CSSProperties
}
