// M29: a type's name patterns ("Name patterns" in type settings). A new object whose name matches
// one suggests this type in every create row (`create/typeSuggest.ts`). One pattern per line,
// saved on blur as the type's `namePatterns`; a line that isn't a pattern is flagged and nothing
// is saved; the server's own check (422) shows its detail here.
import { useState } from 'react'
import type { TypeDef } from '@/api/types'
import { compilePattern } from '@/create/typeSuggest'
import type { TypeEditor } from '@/object/useTypeEditor'

/** Our strings. */
export const NAME_PATTERNS_TEXT = {
  title: 'Name patterns',
  description:
    'New objects whose name matches one of these suggest this type. One per line: * any characters, ? one character, # a digit, @ a letter, or {ip}, {cidr}, {fqdn}, {version}.',
  invalid: (line: string) => `"${line}" isn't a name pattern.`,
}

const T = NAME_PATTERNS_TEXT

/** The box's lines as patterns: trimmed, blank lines left out. */
function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

export function NamePatternsSection({ type, editor }: { type: TypeDef; editor: TypeEditor }) {
  const saved = type.namePatterns ?? []
  const savedText = saved.join('\n')
  const [draft, setDraft] = useState(savedText)
  const [bad, setBad] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  // Edits from elsewhere (or a save's answer) replace the draft while it isn't being edited.
  const [seen, setSeen] = useState(savedText)
  if (seen !== savedText && !editing) {
    setSeen(savedText)
    setDraft(savedText)
  }

  const commit = async () => {
    setEditing(false)
    const lines = linesOf(draft)
    const wrong = [...new Set(lines.filter((l) => compilePattern(l) === null))]
    setBad(wrong)
    if (wrong.length) return
    if (sameList(lines, saved)) return
    const res = await editor.save((latest) => ({ ...latest, namePatterns: lines }))
    setFailed(res === null)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] text-fg-muted">{T.description}</p>
      <textarea
        aria-label={T.title}
        aria-invalid={bad.length > 0}
        value={draft}
        rows={Math.min(8, Math.max(3, draft.split('\n').length + 1))}
        spellCheck={false}
        onChange={(e) => {
          setEditing(true)
          setDraft(e.target.value)
        }}
        onBlur={() => void commit()}
        className="w-full max-w-[420px] rounded-md border border-line bg-transparent px-2 py-1.5 font-mono text-[14px] outline-none focus:border-fg-muted disabled:opacity-60 aria-[invalid=true]:border-red-400"
      />
      {bad.map((line) => (
        <p key={line} data-pattern-error className="text-[13px] text-red-400">
          {T.invalid(line)}
        </p>
      ))}
      {failed && editor.error && (
        <p role="alert" className="text-[13px] text-red-400">
          {editor.error}
        </p>
      )}
    </div>
  )
}
