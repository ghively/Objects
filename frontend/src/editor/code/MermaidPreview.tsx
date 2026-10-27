/**
 * The Mermaid preview of a `mermaid` code block. Mermaid is imported on demand
 * (its own chunk), initialised with `securityLevel: 'strict'` and the theme
 * that matches the app (`dark` for Dark and Dark Dimmed, `default` for the
 * light themes), and re-rendered whenever the text or the theme changes.
 *
 * Empty text shows "Write a Mermaid diagram to see the preview"
 * (`blocks.CodeBlock.mermaidEmpty`); a failure shows "Diagram rendering error"
 * (`blocks.CodeBlock.mermaidError`) with Mermaid's message.
 */
import { useEffect, useId, useState } from 'react'
import { useThemeName } from '@/theme/applyTheme'

type State = { status: 'empty' } | { status: 'pending' } | { status: 'ok'; svg: string } | { status: 'error'; message: string }

let renderSeq = 0

export function MermaidPreview({ text }: { text: string }) {
  const theme = useThemeName()
  const dark = theme.startsWith('dark')
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [state, setState] = useState<State>(() => (text.trim() ? { status: 'pending' } : { status: 'empty' }))

  useEffect(() => {
    if (!text.trim()) {
      setState({ status: 'empty' })
      return
    }
    let cancelled = false
    const id = `mermaid-${baseId}-${++renderSeq}`
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })
        const { svg } = await mermaid.render(id, text)
        if (!cancelled) setState({ status: 'ok', svg })
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        // Mermaid leaves its measuring element behind when a render fails.
        document.getElementById(`d${id}`)?.remove()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [text, dark, baseId])

  if (state.status === 'empty') {
    return <div className="code-preview-message">Write a Mermaid diagram to see the preview</div>
  }
  if (state.status === 'error') {
    return (
      <div className="code-preview-message code-preview-error" role="alert">
        <div className="code-preview-error-title">Diagram rendering error</div>
        <div className="code-preview-error-detail">{state.message}</div>
      </div>
    )
  }
  if (state.status === 'pending') return <div className="mermaid-preview" aria-busy="true" />
  // Mermaid's own output under `securityLevel: 'strict'` (sanitised by Mermaid).
  return <div className="mermaid-preview" data-testid="mermaid-svg" dangerouslySetInnerHTML={{ __html: state.svg }} />
}
