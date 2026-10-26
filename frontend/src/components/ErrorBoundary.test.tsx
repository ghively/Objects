import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error("Cannot read properties of undefined (reading 'removedSections')")
  return <p>fine</p>
}

describe('ErrorBoundary', () => {
  test('test a throwing view shows a message instead of blanking, and a new key retries', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { rerender } = render(
      <div>
        <p>sidebar</p>
        <ErrorBoundary what="This page" resetKey="a">
          <Boom fail />
        </ErrorBoundary>
      </div>,
    )
    expect(screen.getByText('sidebar')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('This page could not be shown')
    rerender(
      <div>
        <p>sidebar</p>
        <ErrorBoundary what="This page" resetKey="b">
          <Boom fail={false} />
        </ErrorBoundary>
      </div>,
    )
    expect(screen.getByText('fine')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    spy.mockRestore()
  })
})
