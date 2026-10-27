import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import mainSource from '@/main.tsx?raw'
import { GlobalOverlays } from './GlobalOverlays'

describe('GlobalOverlays', () => {
  test('test GlobalOverlays is mounted beside App', () => {
    const { container } = render(<GlobalOverlays />)
    expect(container).toBeEmptyDOMElement()
    // main.tsx renders it next to <App /> inside StrictMode.
    expect(mainSource).toMatch(/<App \/>\s*<GlobalOverlays \/>/)
    expect(mainSource).toContain("from './shell/GlobalOverlays.tsx'")
  })
})
