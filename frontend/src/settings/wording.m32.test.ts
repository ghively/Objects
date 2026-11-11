// M32 (glossary): what Settings and the type pages say on screen. Their strings live in the
// `*_TEXT` constants, so the check reads those: no default text says "object" (the app's own name,
// "Object", aside) and none says "query" / "queries" (a saved search now). The Version control
// section's strings are `vcs/vcsText.ts`'s and are checked there.
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { DEV_INFO_TEXT } from './DevInfo'
import { SETTINGS_SECTIONS, SETTINGS_TEXT } from './SettingsModal'
import { SHORTCUTS_TEXT } from './ShortcutsSheet'
import { MEDIA_TEXT } from './mediaLoading'
import { AI_ASSISTANT_TEXT } from './sections/AiAssistant'
import { APPEARANCE_TEXT } from './sections/Appearance'
import { AUTOMATIONS_TEXT } from './sections/Automations'
import { DATE_TIME_TEXT } from './sections/DateTime'
import { EDITOR_TEXT } from './sections/Editor'
import { FULL_EXPORT_TEXT } from './sections/FullExport'
import { IMPORT_CONTENT_TEXT } from './sections/ImportContent'
import { INTEGRATIONS_TEXT } from './sections/Integrations'
import { LANGUAGE_TEXT } from './sections/Language'
import { NOTIFICATIONS_TEXT } from './sections/Notifications'
import { OBJECT_TYPES_SEARCH, OBJECT_TYPES_TEXT } from './sections/ObjectTypes'
import { OFFLINE_SYNC_TEXT } from './sections/OfflineSync'
import { SPACE_SETTINGS_TEXT } from './sections/SpaceSettings'
import { TASK_MANAGEMENT_TEXT } from './sections/TaskManagement'
import { WORK_TEXT } from './sections/Work'
import { CARD_VIEW_TEXT } from '@/types/CardViewSettings'
import { CREATE_TYPE_TEXT } from '@/types/CreateTypeDialog'
import { DELETE_TYPE_TEXT } from '@/types/DeleteTypeDialog'
import { IMPORT_CSV_TEXT } from '@/types/ImportCsvDialog'
import { NAME_PATTERNS_TEXT } from '@/types/NamePatternsSection'
import { TEMPLATE_TEXT } from '@/types/TemplateManager'
import { TYPE_PAGE_TEXT } from '@/types/TypePage'
import { TYPE_SETTINGS_TEXT } from '@/types/TypeSettings'
import { WORK_FIELDS_TEXT } from '@/types/WorkFieldsSection'
import { SECTION_TEXT } from '@/types/dashboardSections'

const TEXTS: Record<string, unknown> = {
  DEV_INFO_TEXT,
  SETTINGS_TEXT,
  SHORTCUTS_TEXT,
  MEDIA_TEXT,
  AI_ASSISTANT_TEXT,
  APPEARANCE_TEXT,
  AUTOMATIONS_TEXT,
  DATE_TIME_TEXT,
  EDITOR_TEXT,
  FULL_EXPORT_TEXT,
  IMPORT_CONTENT_TEXT,
  INTEGRATIONS_TEXT,
  LANGUAGE_TEXT,
  NOTIFICATIONS_TEXT,
  OBJECT_TYPES_TEXT,
  OFFLINE_SYNC_TEXT,
  SPACE_SETTINGS_TEXT,
  TASK_MANAGEMENT_TEXT,
  WORK_TEXT,
  CARD_VIEW_TEXT,
  CREATE_TYPE_TEXT,
  DELETE_TYPE_TEXT,
  IMPORT_CSV_TEXT,
  NAME_PATTERNS_TEXT,
  TEMPLATE_TEXT,
  TYPE_PAGE_TEXT,
  TYPE_SETTINGS_TEXT,
  WORK_FIELDS_TEXT,
  SECTION_TEXT,
}

/** Every string a text constant can show: its values, and what its functions answer. */
function strings(value: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === 'string') out.push([path, value])
  else if (typeof value === 'function') {
    // A text function takes counts and names: try a singular and a plural.
    for (const n of [1, 2]) {
      try {
        const s: unknown = (value as (...args: unknown[]) => unknown)(n, n, 'x')
        if (typeof s === 'string') out.push([`${path}(${n})`, s])
      } catch {
        /* takes other arguments; its parts are plain strings elsewhere */
      }
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out)
  }
  return out
}

/** The text without the app's name ("Object", "Object's"; not "Object Types"). */
const withoutAppName = (s: string) => s.replace(/\bObject\b(?! types?\b)/gi, (m) => (m === 'Object' ? '' : m))

describe('Settings and type pages wording (M32 glossary)', () => {
  const all = Object.entries(TEXTS).flatMap(([name, t]) => strings(t, name))

  test('test no settings or type text says "object"', () => {
    expect(all.length).toBeGreaterThan(300)
    const bad = all.filter(([, s]) => /object/i.test(withoutAppName(s)))
    expect(bad).toEqual([])
  })

  test('test no settings or type text says "query" or "queries"', () => {
    const bad = all.filter(([, s]) => /\bquer(y|ies)\b/i.test(s))
    expect(bad).toEqual([])
  })

  test('test the Settings section is "Types", with "Your types", "Basic types" and "Custom types"', () => {
    expect(OBJECT_TYPES_TEXT).toMatchObject({
      heading: 'Types',
      description: 'Edit the types in this space.',
      yourTypes: 'Your types',
      basic: 'Basic types',
      custom: 'Custom types',
    })
    expect(OBJECT_TYPES_SEARCH).toEqual(['Your types', 'Basic types', 'Custom types'])
    expect(SETTINGS_SECTIONS.find((s) => s.id === 'objectTypes')?.label).toBe('Types')
    // Decision 1: the AI Assistant section stays where it is, second in General.
    expect(SETTINGS_SECTIONS.map((s) => s.id).slice(0, 3)).toEqual(['appearance', 'aiAssistant', 'editor'])
  })

  test('test the counts read as notes', () => {
    expect(FULL_EXPORT_TEXT.exported(1, 0)).toBe('Exported 1 note to')
    expect(FULL_EXPORT_TEXT.exported(4, 1)).toBe('Exported 4 notes and 1 media file to')
    expect(IMPORT_CONTENT_TEXT.historyObjects(1)).toBe('1 note')
    expect(IMPORT_CONTENT_TEXT.historyObjects(12)).toBe('12 notes')
  })
})
