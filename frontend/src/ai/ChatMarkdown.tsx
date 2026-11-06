/**
 * A chat message rendered as Markdown (M16, spec section 10): `renderChatMarkdown`'s inert HTML,
 * with object links brought to life by `presentWikilink` (resolve, type colour, open on click).
 *
 * While `streaming`, the text shown follows `source` at most every `STREAM_RENDER_MS` (the last
 * update always lands), so a long reply arriving token by token stays responsive. The view
 * re-renders once KaTeX has loaded and when a fence's highlight.js grammar arrives.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { grammarOf, loadGrammar, registeredGrammars } from '@/editor/code/highlight'
import { useMathReady } from '@/editor/math/renderMath'
import { cn } from '@/lib/utils'
import { presentWikilink } from '@/links/wikilinkPresenter'
import { fenceLanguages, renderChatMarkdown } from './markdown'
import '@/theme/codeSyntax.css'
import './chatMarkdown.css'

/** While streaming, re-render at most this often (our number). */
export const STREAM_RENDER_MS = 100

/** `source`, but while `streaming` updated at most every `STREAM_RENDER_MS` (trailing update kept). */
function useStreamedSource(source: string, streaming: boolean): string {
  const [throttled, setThrottled] = useState(source)
  const lastAt = useRef(0)

  useEffect(() => {
    lastAt.current = Date.now()
  }, [])

  useEffect(() => {
    if (!streaming) return
    const wait = Math.max(0, lastAt.current + STREAM_RENDER_MS - Date.now())
    const timer = setTimeout(() => {
      lastAt.current = Date.now()
      setThrottled(source)
    }, wait)
    return () => clearTimeout(timer)
  }, [source, streaming])

  return streaming ? throttled : source
}

export function ChatMarkdown({ source, streaming = false, className }: { source: string; streaming?: boolean; className?: string }) {
  const shown = useStreamedSource(source, streaming)
  const mathReady = useMathReady()
  const [grammars, setGrammars] = useState(0)
  const html = useMemo(
    () => renderChatMarkdown(shown),
    // `mathReady` and `grammars` change the output of the same source (KaTeX / highlight.js loaded).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, mathReady, grammars],
  )
  const hostRef = useRef<HTMLDivElement>(null)

  // A fence whose grammar is still loading renders plain; render again once it is registered.
  useEffect(() => {
    let alive = true
    const registered = new Set(registeredGrammars())
    for (const lang of fenceLanguages(shown)) {
      const grammar = grammarOf(lang)
      if (!grammar || registered.has(grammar)) continue
      void loadGrammar(grammar).then((ok) => {
        if (alive && ok) setGrammars((n) => n + 1)
      })
    }
    return () => {
      alive = false
    }
  }, [shown])

  // Object links resolve, take their type's colour and open on click, as in the body.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const cleanups = [...host.querySelectorAll<HTMLElement>('[data-wikilink]')].map((chip) =>
      presentWikilink(chip, { target: chip.getAttribute('data-target') ?? '', label: chip.getAttribute('data-label') }),
    )
    return () => cleanups.forEach((c) => c())
  }, [html])

  return <div ref={hostRef} className={cn('chat-md', className)} dangerouslySetInnerHTML={{ __html: html }} />
}
