/**
 * M10: what lets any part of the app show the AI chat. Mounted once by `App.tsx`: it registers
 * `setAiReveal(revealAiChat)` (open the active tab's AI chat side-panel entry, or reveal the one
 * already there, and move focus into it) and binds the "Open AI chat" shortcut (ours: Ctrl+Alt+J)
 * while AI features aren't hidden.
 */
import { useEffect } from 'react'
import { useGlobalShortcut } from '@/lib/shortcuts'
import { revealAiChat } from './reveal'
import { setAiReveal, useAiHidden } from './store'

function OpenAiShortcut() {
  useGlobalShortcut('openAiChat', () => revealAiChat(), { allowInEditable: true })
  return null
}

export function AiHost() {
  const hidden = useAiHidden()
  useEffect(() => {
    setAiReveal(revealAiChat)
    return () => setAiReveal(null)
  }, [])
  return hidden ? null : <OpenAiShortcut />
}
