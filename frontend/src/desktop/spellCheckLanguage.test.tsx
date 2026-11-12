import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { SPELLCHECK_DOWNLOAD_TEXT, SpellCheckDownloadNote, tellSpellCheckLanguage } from './spellCheckLanguage'
import { fakeDesktop } from './testBridge'

afterEach(() => {
  delete window.objectDesktop
})

describe('tellSpellCheckLanguage', () => {
  test('test inside the shell the setting\'s tag reaches it, normalised, and no tag is null', () => {
    const fake = fakeDesktop({ platform: 'linux' })
    window.objectDesktop = fake.bridge
    tellSpellCheckLanguage('de_ch')
    tellSpellCheckLanguage(null)
    tellSpellCheckLanguage('')
    tellSpellCheckLanguage('not a tag')
    expect(fake.bridge.setSpellCheckLanguage).toHaveBeenNthCalledWith(1, 'de-CH')
    expect(fake.bridge.setSpellCheckLanguage).toHaveBeenNthCalledWith(2, null)
    expect(fake.bridge.setSpellCheckLanguage).toHaveBeenNthCalledWith(3, null)
    expect(fake.bridge.setSpellCheckLanguage).toHaveBeenNthCalledWith(4, null)
  })

  test('test in a browser tab and in the pywebview window nothing is called', () => {
    expect(() => tellSpellCheckLanguage('fr')).not.toThrow()
  })

  test('test a shell without the call (an older one) or one that throws is left alone', () => {
    const fake = fakeDesktop({ platform: 'win32' })
    const bridge = { ...fake.bridge } as Partial<typeof fake.bridge>
    delete bridge.setSpellCheckLanguage
    window.objectDesktop = bridge as typeof fake.bridge
    expect(() => tellSpellCheckLanguage('fr')).not.toThrow()
    window.objectDesktop = { ...fake.bridge, setSpellCheckLanguage: () => { throw new Error('boom') } }
    expect(() => tellSpellCheckLanguage('fr')).not.toThrow()
  })
})

describe('SpellCheckDownloadNote', () => {
  test.each(['win32', 'linux'] as const)('test inside the shell on %s it says the dictionary is downloaded once', (platform) => {
    window.objectDesktop = fakeDesktop({ platform }).bridge
    render(<SpellCheckDownloadNote />)
    expect(screen.getByText(SPELLCHECK_DOWNLOAD_TEXT)).toBeInTheDocument()
    expect(SPELLCHECK_DOWNLOAD_TEXT).toBe("The dictionary for this language is downloaded once from the browser engine's server.")
  })

  test('test on macOS (the system\'s own spellchecker) and outside the shell it says nothing', () => {
    window.objectDesktop = fakeDesktop({ platform: 'darwin' }).bridge
    const { container, unmount } = render(<SpellCheckDownloadNote />)
    expect(container).toBeEmptyDOMElement()
    unmount()
    delete window.objectDesktop
    expect(render(<SpellCheckDownloadNote />).container).toBeEmptyDOMElement()
  })
})
