/**
 * The code block's node view: the code area in the
 * code tokens (`--code-bg`, `--code-border`, `--code-text`) and a bar shown on
 * hover or focus with:
 * - "Select language": our language list;
 * - for `markdown` and `mermaid`, "Edit" / "Edit & Display" / "Display"
 *   written as `preview=edit|split|display`; absent means "Display";
 * - "Wrap lines" (option `wrap`);
 * - "Lock editing" (option `lock`: read-only
 *   until unlocked; `codeBlock.ts` also refuses edits inside a locked block);
 * - "Copy to clipboard";
 * - "Download as file" (a client-side download).
 */
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Check, ChevronDown, Copy, Download, Lock, LockOpen, WrapText } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Option } from '../annotations'
import { filterLanguages, hasPreview, languageOf } from './languages'
import { MarkdownPreview } from './MarkdownPreview'
import { MermaidPreview } from './MermaidPreview'

export type PreviewMode = 'edit' | 'split' | 'display'

const MODES: { mode: PreviewMode; label: string }[] = [
  { mode: 'edit', label: 'Edit' },
  { mode: 'split', label: 'Edit & Display' },
  { mode: 'display', label: 'Display' },
]

function optionOf(options: Option[] | null | undefined, key: string): string | true | undefined {
  return (options ?? []).find((o) => o.key === key)?.value
}

/** The preview mode a code block shows: its `preview` option, "Display" when absent or unknown. */
export function previewModeOf(options: Option[] | null | undefined): PreviewMode {
  const v = optionOf(options, 'preview')
  return v === 'edit' || v === 'split' || v === 'display' ? v : 'display'
}

/** Save `text` as a file through a temporary object URL (no server round trip). */
export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function LanguagePicker({ value, onPick, disabled }: { value: string; onPick: (id: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const matches = useMemo(() => filterLanguages(query), [query])
  const current = languageOf(value)

  const pick = (id: string) => {
    setOpen(false)
    setQuery('')
    onPick(id)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && matches[0]) {
      e.preventDefault()
      pick(matches[0].id)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="code-block-btn code-block-lang"
          aria-label="Select language"
          title="Select language"
          disabled={disabled}
        >
          <span>{current.label}</span>
          <ChevronDown size={12} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="code-block-lang-menu w-56 p-1">
        <input
          className="code-block-lang-filter"
          placeholder="Select language"
          aria-label="Select language"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="code-block-lang-list" role="listbox" aria-label="Languages">
          {matches.map((l) => (
            <button
              key={l.id || 'plain'}
              type="button"
              role="option"
              aria-selected={l.id === current.id}
              className="code-block-lang-item"
              onClick={() => pick(l.id)}
            >
              <span>{l.label}</span>
              {l.id === current.id && <Check size={12} aria-hidden />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function CodeBlockView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const options = node.attrs.blockOptions as Option[] | null
  const language = String(node.attrs.language ?? '')
  const wrap = optionOf(options, 'wrap') === true
  const locked = optionOf(options, 'lock') === true
  const preview = hasPreview(language)
  const mode = preview ? previewModeOf(options) : 'edit'
  const editable = editor.isEditable
  const [copied, setCopied] = useState(false)

  const setOption = (key: string, value: string | true | null) => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (pos == null) return
    editor.commands.setBlockOption(key, value, pos)
  }

  const setMode = (next: PreviewMode) => {
    if (next === mode) return
    setOption('preview', next)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard refused (permissions): nothing to do.
    }
  }

  const download = () => downloadText(node.textContent, `snippet.${languageOf(language).ext}`)

  return (
    <NodeViewWrapper
      className="code-block"
      data-language={language || undefined}
      data-wrap={wrap || undefined}
      data-lock={locked || undefined}
      data-preview={preview ? mode : undefined}
    >
      <div className="code-block-bar" contentEditable={false}>
        <LanguagePicker
          value={language}
          disabled={!editable}
          onPick={(id) => updateAttributes({ language: id || null })}
        />
        <span className="code-block-bar-spacer" />
        {preview && (
          <div className="code-block-modes" role="group" aria-label="Preview">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                className="code-block-mode"
                aria-pressed={mode === m.mode}
                disabled={!editable}
                onClick={() => setMode(m.mode)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="code-block-btn"
          aria-label="Wrap lines"
          title="Wrap lines"
          aria-pressed={wrap}
          disabled={!editable}
          onClick={() => setOption('wrap', wrap ? null : true)}
        >
          <WrapText size={14} aria-hidden />
        </button>
        <button
          type="button"
          className="code-block-btn"
          aria-label="Lock editing"
          title="Lock editing"
          aria-pressed={locked}
          disabled={!editable}
          onClick={() => setOption('lock', locked ? null : true)}
        >
          {locked ? <Lock size={14} aria-hidden /> : <LockOpen size={14} aria-hidden />}
        </button>
        <button type="button" className="code-block-btn" aria-label="Copy to clipboard" title="Copy to clipboard" onClick={copy}>
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        </button>
        <button type="button" className="code-block-btn" aria-label="Download as file" title="Download as file" onClick={download}>
          <Download size={14} aria-hidden />
        </button>
      </div>
      <div className={`code-block-body code-block-mode-${mode}`}>
        <pre className="code-block-pre" spellCheck={false}>
          <NodeViewContent<'code'>
            as="code"
            className={language ? `language-${language}` : undefined}
            contentEditable={editable && !locked}
            suppressContentEditableWarning
          />
        </pre>
        {preview && mode !== 'edit' && (
          <div className="code-block-preview" contentEditable={false}>
            {preview === 'mermaid' ? <MermaidPreview text={node.textContent} /> : <MarkdownPreview text={node.textContent} />}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}
