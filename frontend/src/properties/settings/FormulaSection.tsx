// M12: a formula property's settings: the expression editor (with highlighting), the property
// and function lists that insert into it, a live preview, and the result's number format.
// The expression is saved on blur, on Ctrl/Cmd+Enter or with "Save", never on every keystroke.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { api } from '@/api/client'
import type { ComputedValue, FormulaPreviewResult, PropertyDef, TypeDef } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import { formatDate, formatNumber } from '../format'
import { FORMULA_FUNCTIONS, formulaPropertyNames, propCall } from './formulaFunctions'
import { tokenizeFormula, type FormulaTokenKind } from './formulaTokens'
import { ResultNumberFormat, SettingsSection } from './shared'
import { FORMULA_TEXT } from './texts'

/** The preview debounce, in milliseconds. */
export const PREVIEW_DELAY = 300

const MAX_LENGTH = 2000

const TOKEN_CLASS: Record<FormulaTokenKind, string> = {
  function: 'text-sky-400',
  prop: 'text-violet-400',
  string: 'text-emerald-400',
  number: 'text-amber-400',
  keyword: 'text-pink-400',
  operator: 'text-fg-muted',
  punctuation: 'text-fg-muted',
  space: '',
  other: '',
}

/** A computed value as the preview shows it. */
function previewText(v: ComputedValue, def: PropertyDef): string {
  switch (v.type) {
    case 'number':
      return typeof v.value === 'number' ? formatNumber(v.value, def.options.numberFormat) : String(v.value)
    case 'boolean':
      return v.value ? 'true' : 'false'
    case 'date': {
      const s = String(v.value ?? '')
      return formatDate({ start: s, resolution: s.length <= 10 ? 'day' : 'time' }) || s
    }
    case 'list':
      return Array.isArray(v.value) ? v.value.join(', ') : String(v.value ?? '')
    case 'text':
      return String(v.value ?? '')
    default:
      return ''
  }
}

interface Preview extends FormulaPreviewResult {
  /** The expression and object the result belongs to. */
  key: string
}

export function FormulaSection({
  type,
  def,
  save,
  objectPath,
}: {
  type: TypeDef
  def: PropertyDef
  save(next: PropertyDef): void
  /** The object the settings were opened from; the preview evaluates against it. */
  objectPath?: string | null
}) {
  const saved = def.options.expression ?? ''
  const [draft, setDraft] = useState(saved)
  const [synced, setSynced] = useState(saved)
  if (synced !== saved) {
    // The stored expression changed (saved here or elsewhere): take it.
    setSynced(saved)
    setDraft(saved)
  }
  const dirty = draft !== saved

  const areaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const caretRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    const at = caretRef.current
    const el = areaRef.current
    if (at === null || !el) return
    caretRef.current = null
    el.focus()
    el.setSelectionRange(at, at)
  }, [draft])

  // The last expression sent, so a blur followed by closing the dialog saves it once.
  const sentRef = useRef<string | null>(null)
  const commit = (force = false) => {
    if (draft === saved || (!force && draft === sentRef.current)) return
    sentRef.current = draft
    save({ ...def, options: { ...def.options, expression: draft } })
  }
  // Closing the dialog while editing keeps the edit.
  const commitRef = useRef(commit)
  useEffect(() => {
    commitRef.current = commit
  })
  useEffect(
    () => () => {
      // Not when the property itself was just deleted (that would add it back).
      const current = useLinkIndex.getState().types.find((t) => t.id === type.id)
      if (current?.propertyDefinitions.some((d) => d.id === def.id)) commitRef.current()
    },
    [type.id, def.id],
  )

  const insert = (text: string, caretOffset = text.length) => {
    const el = areaRef.current
    const start = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? draft.length
    const next = (draft.slice(0, start) + text + draft.slice(end)).slice(0, MAX_LENGTH)
    caretRef.current = Math.min(next.length, start + caretOffset)
    setDraft(next)
  }

  // -- preview --
  const path = objectPath || null
  const key = `${path ?? ''}\n${draft}`
  const [preview, setPreview] = useState<Preview | null>(null)
  const seqRef = useRef(0)
  const defs = type.propertyDefinitions
  useEffect(() => {
    if (!draft.trim()) return
    const seq = ++seqRef.current
    const k = `${path ?? ''}\n${draft}`
    const t = setTimeout(() => {
      const properties = defs.map((d) => (d.id === def.id ? { ...d, options: { ...d.options, expression: draft } } : d))
      api
        .formulaPreview({ typeId: type.id, expression: draft, ...(path ? { path } : {}), properties })
        .then(
          (res) => seq === seqRef.current && setPreview({ key: k, value: res?.value ?? null, error: res?.error ?? null }),
          (err: unknown) =>
            seq === seqRef.current &&
            setPreview({ key: k, value: null, error: err instanceof Error ? err.message : String(err) }),
        )
    }, PREVIEW_DELAY)
    return () => clearTimeout(t)
  }, [draft, path, type.id, def.id, defs])
  const shown = preview && preview.key === key ? preview : null

  // -- lists --
  const names = useMemo(() => formulaPropertyNames(defs, def.id), [defs, def.id])
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const functions = FORMULA_FUNCTIONS.filter(
    (f) => !q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q),
  )
  // Keep the editor's focus and selection when a list item is pressed.
  const keepFocus = (e: MouseEvent) => e.preventDefault()

  const tokens = tokenizeFormula(draft)
  const error = shown?.error ?? (shown?.value?.type === 'error' ? (shown.value.error ?? '') : null)

  return (
    <>
      <SettingsSection title={FORMULA_TEXT.heading} description={FORMULA_TEXT.description}>
        <div className="relative rounded border border-line font-mono text-[13px] leading-[1.5]">
          <pre
            ref={preRef}
            aria-hidden
            data-formula-highlight
            className="pointer-events-none absolute inset-0 m-0 overflow-hidden px-2 py-1.5 break-words whitespace-pre-wrap"
          >
            {tokens.map((t, i) => (
              <span key={i} data-token={t.kind} className={TOKEN_CLASS[t.kind]}>
                {t.text}
              </span>
            ))}
            {'\n'}
          </pre>
          <textarea
            ref={areaRef}
            aria-label={FORMULA_TEXT.editorLabel}
            placeholder={FORMULA_TEXT.placeholder}
            value={draft}
            rows={4}
            maxLength={MAX_LENGTH}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit()}
            onScroll={(e) => {
              if (preRef.current) preRef.current.scrollTop = e.currentTarget.scrollTop
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                commit(true)
              }
            }}
            className="relative block w-full resize-y bg-transparent px-2 py-1.5 break-words whitespace-pre-wrap text-transparent caret-fg outline-none placeholder:text-fg-muted"
          />
        </div>
        <div className="mt-1 flex items-center gap-2">
          <p className="min-w-0 flex-1 text-[12px] text-fg-muted">{FORMULA_TEXT.saveHint}</p>
          {dirty && (
            <button
              type="button"
              onMouseDown={keepFocus}
              onClick={() => commit(true)}
              className="rounded bg-hover px-2 py-0.5 text-[13px] font-medium"
            >
              {FORMULA_TEXT.save}
            </button>
          )}
        </div>

        <div className="mt-2" role="status" aria-label={FORMULA_TEXT.preview}>
          <div className="text-[12px] font-semibold text-fg-muted">{FORMULA_TEXT.preview}</div>
          {!draft.trim() ? null : !shown ? (
            <p className="text-[13px] text-fg-muted">{FORMULA_TEXT.calculating}</p>
          ) : error !== null ? (
            <p data-formula-error className="text-[13px] break-words text-red-400">
              {error}
            </p>
          ) : !shown.value ? (
            <p className="text-[13px] text-fg-muted">{path ? FORMULA_TEXT.parsed : FORMULA_TEXT.openObject}</p>
          ) : shown.value.type === 'empty' ? (
            <p className="text-[13px] text-fg-muted">{FORMULA_TEXT.empty}</p>
          ) : (
            <p data-formula-value className="text-[13px] break-words">
              <span>{previewText(shown.value, def)}</span>
              <span className="ml-2 text-[12px] text-fg-muted">{shown.value.type}</span>
            </p>
          )}
        </div>

        <div className="mt-3">
          <div className="text-[12px] font-semibold text-fg-muted">{FORMULA_TEXT.properties}</div>
          <div role="group" aria-label={FORMULA_TEXT.properties} className="mt-1 flex flex-wrap gap-1">
            {names.map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`Insert ${n}`}
                onMouseDown={keepFocus}
                onClick={() => insert(propCall(n))}
                className="rounded border border-line px-1.5 py-0.5 text-[12px] hover:bg-hover"
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <div className="text-[12px] font-semibold text-fg-muted">{FORMULA_TEXT.functions}</div>
          <input
            aria-label={FORMULA_TEXT.searchFunctions}
            placeholder={FORMULA_TEXT.searchFunctions}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-transparent px-2 py-1 text-[13px] outline-none"
          />
          <ul aria-label={FORMULA_TEXT.functions} className="mt-1 max-h-48 overflow-auto">
            {functions.length === 0 && <li className="px-1 py-1 text-[13px] text-fg-muted">{FORMULA_TEXT.noFunctions}</li>}
            {functions.map((f) => {
              const noArgs = f.signature.endsWith('()')
              return (
                <li key={f.name}>
                  <button
                    type="button"
                    aria-label={`Insert ${f.name}`}
                    onMouseDown={keepFocus}
                    onClick={() => insert(`${f.name}()`, noArgs ? f.name.length + 2 : f.name.length + 1)}
                    className="w-full rounded px-1 py-0.5 text-left hover:bg-hover"
                  >
                    <span className="font-mono text-[12.5px] text-sky-400">{f.signature}</span>
                    <span className="block text-[12px] text-fg-muted">{f.description}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </SettingsSection>
      <ResultNumberFormat
        title={FORMULA_TEXT.numberFormat}
        description={FORMULA_TEXT.numberFormatDescription}
        def={def}
        save={save}
      />
    </>
  )
}
