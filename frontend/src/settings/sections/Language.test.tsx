// M8 Task 7: the Language section.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { filterSections, SETTINGS_SECTIONS } from '../SettingsModal'
import { LanguageSection } from './Language'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

describe('LanguageSection', () => {
  test('test language section lists locales and saves', async () => {
    const user = userEvent.setup()
    render(<LanguageSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Language' })).toBeInTheDocument()
    expect(
      screen.getByText("Object's interface is in English; the language sets how dates and numbers are formatted."),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Change your language' })).toBeInTheDocument()
    expect(screen.getByText('The language the app is shown in.')).toBeInTheDocument()
    const langs = screen.getByRole('radiogroup', { name: 'Change your language' })
    expect(within(langs).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'English',
      'English (UK)',
      'Deutsch',
      'Français',
      'Español',
      'Dutch',
      'Português (BR)',
      'Magyar',
      'Italian',
    ])
    expect(within(langs).getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(langs).getByRole('radio', { name: 'Deutsch' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ language: 'de' }, expect.anything())
    expect(within(langs).getByRole('radio', { name: 'Deutsch' })).toHaveAttribute('aria-checked', 'true')

    const sep = screen.getByRole('radiogroup', { name: 'Decimal separator' })
    expect(within(sep).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Automatic', 'Dot', 'Comma'])
    expect(within(sep).getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(sep).getByRole('radio', { name: 'Comma' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ decimalSeparator: 'comma' }, expect.anything())
  })

  test('test language is a General section that search finds', () => {
    const lang = SETTINGS_SECTIONS.find((s) => s.id === 'language')
    expect(lang).toMatchObject({ group: 'general', label: 'Language' })
    expect(filterSections('decimal').map((s) => s.id)).toContain('language')
    expect(filterSections('time zone').map((s) => s.id)).toContain('dateTime')
    expect(filterSections('nested backlinks').map((s) => s.id)).toContain('editor')
  })
})
