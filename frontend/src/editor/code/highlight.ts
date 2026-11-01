/**
 * Code syntax highlighting (M8 Task 29). highlight.js's core with exactly the
 * grammars our language list names (`languages.ts` `hljs`), applied to code
 * blocks as ProseMirror inline decorations: the document text and the saved
 * bytes never change, only the rendered spans gain `hljs-*` classes
 * (`nodes/codeBlock.css` colours them from the `--code-*` theme tokens).
 *
 * Plain text, Mermaid and unknown languages stay unhighlighted (no guessing
 * with `highlightAuto`; our choice). A block is re-highlighted when its text or
 * language changes, debounced (`HIGHLIGHT_DEBOUNCE_MS`); in between, the old
 * decorations are mapped through the edit so nothing flickers. Blocks above
 * `MAX_HIGHLIGHT_CHARS` are left plain (our choice, keeps typing responsive).
 *
 * A grammar is loaded and registered the first time a block in its language
 * is seen (audit 2026-11-01 F1: the grammars are 180 KB the app's entry does
 * not need); until then the block is plain, and the plugin highlights it as
 * soon as the grammar is there.
 */
import type { LanguageFn } from 'highlight.js'
import hljs from 'highlight.js/lib/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { languageOf } from './languages'

type GrammarModule = { default: LanguageFn }

/** The grammars our language list names (`languages.ts` `hljs`), each loaded on demand. */
const LOADERS: Record<string, () => Promise<GrammarModule>> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  diff: () => import('highlight.js/lib/languages/diff'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  go: () => import('highlight.js/lib/languages/go'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  latex: () => import('highlight.js/lib/languages/latex'),
  lua: () => import('highlight.js/lib/languages/lua'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  nginx: () => import('highlight.js/lib/languages/nginx'),
  php: () => import('highlight.js/lib/languages/php'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  python: () => import('highlight.js/lib/languages/python'),
  r: () => import('highlight.js/lib/languages/r'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  scss: () => import('highlight.js/lib/languages/scss'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
}

export const HIGHLIGHT_DEBOUNCE_MS = 150
export const MAX_HIGHLIGHT_CHARS = 200_000

const loads = new Map<string, Promise<boolean>>()
const loadListeners = new Set<() => void>()

/** Load and register the grammar `name` once; true when it is registered (false for one we do not ship). */
export function loadGrammar(name: string): Promise<boolean> {
  if (hljs.getLanguage(name)) return Promise.resolve(true)
  const loader = LOADERS[name]
  if (!loader) return Promise.resolve(false)
  let load = loads.get(name)
  if (!load) {
    load = loader()
      .then((mod) => {
        if (!hljs.getLanguage(name)) hljs.registerLanguage(name, mod.default)
        for (const fn of loadListeners) fn()
        return true
      })
      .catch(() => false)
    loads.set(name, load)
  }
  return load
}

/** Run `fn` each time a grammar has loaded; returns the unsubscribe. */
function onGrammarLoaded(fn: () => void): () => void {
  loadListeners.add(fn)
  return () => loadListeners.delete(fn)
}

/** The grammars we ship (loaded or not). */
export function knownGrammars(): string[] {
  return Object.keys(LOADERS)
}

/** The highlight.js grammars registered so far. */
export function registeredGrammars(): string[] {
  return hljs.listLanguages()
}

/** A highlighted run: `[from, to)` offsets into the code text and its classes. */
export type Token = { from: number; to: number; className: string }

const CONTEXT = new Set(['hljs-tag', 'hljs-meta'])

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" }

/**
 * Parse highlight.js's HTML output (only `<span class="…">`, `</span>` and the
 * five escaped characters) into runs over the original text. A run takes the
 * classes of its innermost span, after those of any enclosing `CONTEXT` span
 * (`hljs-tag hljs-name`, `hljs-meta hljs-keyword`), so the CSS can colour a
 * scope inside a tag or a meta line with compound selectors.
 */
function tokensFromHtml(html: string): Token[] {
  const out: Token[] = []
  const stack: string[] = []
  let offset = 0
  let i = 0
  let runStart = 0
  const flush = () => {
    if (offset > runStart && stack.length) {
      const inner = stack[stack.length - 1]
      const context = stack.slice(0, -1).filter((c) => CONTEXT.has(c) && c !== inner)
      const className = [...context, inner].join(' ')
      const last = out[out.length - 1]
      if (last && last.to === runStart && last.className === className) last.to = offset
      else out.push({ from: runStart, to: offset, className })
    }
    runStart = offset
  }
  while (i < html.length) {
    const ch = html[i]
    if (ch === '<') {
      const end = html.indexOf('>', i)
      const tag = html.slice(i + 1, end)
      flush()
      if (tag.startsWith('/')) stack.pop()
      else stack.push(/class="([^"]*)"/.exec(tag)?.[1] ?? '')
      i = end + 1
    } else if (ch === '&') {
      const end = html.indexOf(';', i)
      const name = html.slice(i + 1, end)
      if (end > i && name in ENTITIES) {
        offset += ENTITIES[name].length
        i = end + 1
      } else {
        offset += 1
        i += 1
      }
    } else {
      offset += 1
      i += 1
    }
  }
  flush()
  return out.filter((t) => t.className.trim())
}

/** The grammar for a fence language (loaded or still to load), or null when it stays plain. */
export function grammarOf(language: string | null | undefined): string | null {
  const g = languageOf(language).hljs
  return g && g in LOADERS ? g : null
}

/**
 * The highlighted runs of `text` in `language` ([] when plain, unknown or too
 * long, and until the grammar has loaded, which this starts).
 */
export function highlightTokens(text: string, language: string | null | undefined): Token[] {
  const grammar = grammarOf(language)
  if (!grammar || !text || text.length > MAX_HIGHLIGHT_CHARS) return []
  if (!hljs.getLanguage(grammar)) {
    void loadGrammar(grammar)
    return []
  }
  try {
    return tokensFromHtml(hljs.highlight(text, { language: grammar, ignoreIllegals: true }).value)
  } catch {
    return []
  }
}

// Per node (nodes are immutable, so an unchanged block reuses its runs).
const cache = new WeakMap<PMNode, Token[]>()

function nodeTokens(node: PMNode): Token[] {
  let tokens = cache.get(node)
  if (!tokens) {
    const language = String(node.attrs.language ?? '')
    tokens = highlightTokens(node.textContent, language)
    // A block waiting for its grammar is not remembered as plain.
    const grammar = grammarOf(language)
    if (!grammar || hljs.getLanguage(grammar)) cache.set(node, tokens)
  }
  return tokens
}

/** Inline decorations for every code block of `doc`. */
export function highlightDecorations(doc: PMNode, typeName = 'codeBlock'): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== typeName) return true
    for (const t of nodeTokens(node)) {
      decos.push(Decoration.inline(pos + 1 + t.from, pos + 1 + t.to, { class: t.className }))
    }
    return false
  })
  return DecorationSet.create(doc, decos)
}

export const CodeHighlightKey = new PluginKey<DecorationSet>('codeHighlight')

/**
 * The decoration plugin. The initial document and a loaded body are highlighted
 * at once; after an edit the old decorations are mapped and a fresh pass runs after the debounce,
 * delivered as a meta-only transaction (no document change, nothing saved). A grammar that
 * arrives later brings a fresh pass too.
 */
export function codeHighlightPlugin(typeName = 'codeBlock', debounceMs = HIGHLIGHT_DEBOUNCE_MS): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: CodeHighlightKey,
    state: {
      init: (_config, state: EditorState) => highlightDecorations(state.doc, typeName),
      apply(tr, old) {
        const fresh = tr.getMeta(CodeHighlightKey) as DecorationSet | undefined
        if (fresh) return fresh
        if (!tr.docChanged) return old
        // A load or other non-user replacement (`addToHistory: false`, as `loadBody` sends) is
        // highlighted at once; typing maps the old runs until the debounced pass.
        if (tr.getMeta('addToHistory') === false) return highlightDecorations(tr.doc, typeName)
        return old.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations: (state) => CodeHighlightKey.getState(state),
    },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | null = null
      let destroyed = false
      const refresh = () => {
        if (destroyed) return
        const tr = view.state.tr.setMeta(CodeHighlightKey, highlightDecorations(view.state.doc, typeName))
        tr.setMeta('addToHistory', false)
        view.dispatch(tr)
      }
      const unsubscribe = onGrammarLoaded(refresh)
      return {
        update(v, prev) {
          if (v.state.doc.eq(prev.doc)) return
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            timer = null
            refresh()
          }, debounceMs)
        },
        destroy() {
          destroyed = true
          unsubscribe()
          if (timer) clearTimeout(timer)
        },
      }
    },
  })
}
