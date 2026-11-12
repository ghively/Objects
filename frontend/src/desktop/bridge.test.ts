import { afterEach, describe, expect, test } from 'vitest'
import { desktop } from './bridge'
import { fakeDesktop } from './testBridge'

afterEach(() => {
  delete window.objectDesktop
})

describe('desktop()', () => {
  test('test desktop is null in a browser tab and in the pywebview window', () => {
    expect(window.objectDesktop).toBeUndefined()
    expect(desktop()).toBeNull()
  })

  test('test desktop returns the bridge the shell set', () => {
    const { bridge } = fakeDesktop({ platform: 'linux', controls: 'custom' })
    window.objectDesktop = bridge
    expect(desktop()).toBe(bridge)
    expect(desktop()?.platform).toBe('linux')
    expect(desktop()?.controls).toBe('custom')
  })

  test('test desktop ignores something that is not the bridge', () => {
    ;(window as unknown as { objectDesktop: unknown }).objectDesktop = 'yes'
    expect(desktop()).toBeNull()
    ;(window as unknown as { objectDesktop: unknown }).objectDesktop = { platform: 'beos' }
    expect(desktop()).toBeNull()
  })
})
