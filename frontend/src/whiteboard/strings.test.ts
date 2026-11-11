import { describe, expect, test } from 'vitest'
import { TOOL_LABEL, WB, t } from './strings'
import { TOOLS } from './model'

describe('whiteboard strings', () => {
  test('test our own strings are marked ours', () => {
    const ours = Object.entries(WB).filter(([, v]) => v.ours === true)
    expect(ours.map(([k]) => k).sort()).toEqual(['changedElsewhere', 'inspector', 'newerVersion', 'nodeLock', 'nodeLocked', 'nodeUnlock', 'pickType', 'readOnly', 'saveFailed', 'searchObjects', 'statConnectors', 'statStrokes', 'statWeblinks'])
    expect(t('newerVersion')).toBe('This whiteboard was saved by a newer version of Object.')
    expect(t('changedElsewhere')).toBe('Changed elsewhere. Reloaded.')
  })

  test('test every tool has a label', () => {
    for (const tool of TOOLS) expect(TOOL_LABEL[tool].text.length).toBeGreaterThan(0)
    expect(TOOL_LABEL.select.text).toBe('Move')
    expect(TOOL_LABEL.link.text).toBe('Existing note')
    expect(TOOL_LABEL.blockArrow.text).toBe('Arrow right')
  })
})
