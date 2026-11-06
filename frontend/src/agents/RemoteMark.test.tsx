import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { RemoteMark } from './RemoteMark'

describe('RemoteMark', () => {
  test('test the mark reads remote and is labelled Remote agent', () => {
    render(<RemoteMark className="ml-1" />)
    const mark = screen.getByLabelText('Remote agent')
    expect(mark).toHaveTextContent('remote')
    expect(mark).toHaveClass('ml-1')
  })
})
