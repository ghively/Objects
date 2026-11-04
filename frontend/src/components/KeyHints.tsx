/**
 * The footer under the keyboard-driven menus (slash menu, `@` picker, New menu, search):
 * "↑↓ to navigate  Esc to abort  ↵ to select".
 */
export interface KeyHint {
  keys: string
  label: string
}

export const KEY_HINTS: readonly KeyHint[] = [
  { keys: '↑↓', label: 'to navigate' },
  { keys: 'Esc', label: 'to abort' },
  { keys: '↵', label: 'to select' },
]

export function KeyHints({ extra = [], bare = false }: { extra?: readonly KeyHint[]; bare?: boolean }) {
  return (
    <div role="note" aria-label="Keyboard hints" className={bare ? 'key-hints key-hints-bare' : 'key-hints'}>
      {[...KEY_HINTS, ...extra].map((h) => (
        <span key={h.keys + h.label} className="key-hint">
          <span className="key-hint-keys">{h.keys}</span> {h.label}
        </span>
      ))}
    </div>
  )
}
