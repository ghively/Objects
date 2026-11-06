// M19 T7: a server's Test result under its row.
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { mcpTestResult } from '@/test/mockApi'
import { McpTestResult } from './McpTestResult'
import { MCP_TEXT as T } from './mcpText'

describe('McpTestResult', () => {
  test('test it shows Testing… while it runs', () => {
    render(<McpTestResult result={null} testing />)
    expect(screen.getByText(T.testing)).toBeInTheDocument()
  })

  test('test it lists the tools with their descriptions', () => {
    render(<McpTestResult result={mcpTestResult()} testing={false} />)
    expect(screen.getByText(T.tools(3))).toBeInTheDocument()
    const list = screen.getByRole('list', { name: T.tools(3) })
    expect(list.querySelectorAll('li')).toHaveLength(3)
    expect(screen.getByText('whoami')).toBeInTheDocument()
    expect(screen.getByText('Add two numbers.')).toBeInTheDocument()
  })

  test('test a failure shows its error', () => {
    render(<McpTestResult result={mcpTestResult({ ok: false, tools: [], error: 'The server answered 500.' })} testing={false} />)
    expect(screen.getByRole('alert')).toHaveTextContent('The server answered 500.')
  })

  test('test nothing shows before a test', () => {
    const { container } = render(<McpTestResult result={null} testing={false} />)
    expect(container).toBeEmptyDOMElement()
  })
})
