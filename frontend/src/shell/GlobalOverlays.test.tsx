import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import mainSource from '@/main.tsx?raw'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { GlobalOverlays } from './GlobalOverlays'

describe('GlobalOverlays', () => {
  test('test GlobalOverlays is mounted beside App', () => {
    const { container } = render(<GlobalOverlays />)
    expect(container).toBeEmptyDOMElement()
    // main.tsx renders it next to <App /> inside StrictMode.
    expect(mainSource).toMatch(/<App \/>\s*<GlobalOverlays \/>/)
    expect(mainSource).toContain("from './shell/GlobalOverlays.tsx'")
  })

  // M32: opening an empty folder asks nothing ("Pick a starting point" is gone).
  test('test an empty space that needs setup shows no starting point dialog', async () => {
    useSpaceInfo.setState({ space: { name: 'New', root: '/new', types: [], needsSetup: true }, loaded: true })
    try {
      render(<GlobalOverlays />)
      await new Promise((r) => setTimeout(r, 20))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.queryByText('Pick a starting point')).toBeNull()
      expect(document.querySelector('[data-starting-point]')).toBeNull()
    } finally {
      resetSpaceInfo()
    }
  })
})
