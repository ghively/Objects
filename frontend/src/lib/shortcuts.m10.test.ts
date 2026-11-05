// M10: the AI Assistant shortcut group.
import { describe, expect, test } from 'vitest'
import { AI_SHORTCUTS, allShortcuts, CATEGORY_LABELS, formatKeys, keysFor, parseKeys, shortcutsByCategory } from './shortcuts'

describe('AI Assistant shortcuts', () => {
  test('test the group has the catalog keys and order', () => {
    expect(CATEGORY_LABELS.ai).toBe('AI Assistant')
    expect(shortcutsByCategory().get('ai')?.map((d) => d.id)).toEqual([
      'openAiChat',
      'aiCopyMessage',
      'aiReplaceContext',
      'aiAppendMessage',
      'aiAppendToDailyNote',
      'aiRetry',
      'aiCloseChat',
      'aiRephrase',
    ])
    expect(formatKeys(keysFor('aiCopyMessage')[0], false)).toBe('Ctrl+Alt+C')
    expect(formatKeys(keysFor('aiAppendMessage')[0], false)).toBe('Ctrl+Alt+A')
    expect(formatKeys(keysFor('aiRetry')[0], false)).toBe('Ctrl+Alt+R')
    expect(formatKeys(keysFor('aiCloseChat')[0], false)).toBe('Ctrl+Alt+X')
    expect(formatKeys(keysFor('aiRephrase')[0], false)).toBe('Ctrl+Alt+U')
    expect(keysFor('aiReplaceContext')).toEqual([])
    expect(keysFor('aiAppendToDailyNote')).toEqual([])
    // Only the open key is ours.
    for (const d of AI_SHORTCUTS) expect(d.provisional, d.id).toBe(d.id === 'openAiChat')
  })

  test('test AI keys collide with no other registered key where both can fire', () => {
    for (const mac of [false, true]) {
      const sig = (k: string) => {
        const c = parseKeys(k, mac)
        return `${c.ctrl}|${c.meta}|${c.alt}|${c.shift}|${c.key.toLowerCase()}`
      }
      const others = allShortcuts().filter((d) => d.category !== 'ai')
      for (const d of AI_SHORTCUTS) {
        for (const k of d.keys) {
          // The open key fires anywhere (in editors too); the chat keys while the chat has focus,
          // where the window-wide (global) keys also fire.
          const clash = others.find((o) => (d.scope === 'global' || o.scope === 'global') && o.keys.some((ok) => sig(ok) === sig(k)))
          expect(clash?.id, `${d.id} (${k}) collides with ${clash?.id}`).toBeUndefined()
        }
      }
      const own = AI_SHORTCUTS.flatMap((d) => d.keys.map(sig))
      expect(new Set(own).size).toBe(own.length)
    }
  })
})
