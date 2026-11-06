// M16 T6: a tool step row, collapsed to one line, expandable to the call's input and result.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { ToolStep } from './ToolStep'
import { TOOL_STEP_TEXT, type ToolStepState } from './toolSteps'

function step(over: Partial<ToolStepState> = {}): ToolStepState {
  return { id: 't1', name: 'search', input: { query: 'rack' }, result: '[]', isError: false, done: true, ...over }
}

describe('ToolStep', () => {
  test('test collapsed to one line, expands to input and result', async () => {
    const user = userEvent.setup()
    const { container } = render(<ToolStep step={step()} />)
    const row = screen.getByRole('button', { name: "Searched notes for 'rack'" })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(row.querySelector('[title]')).toHaveAttribute('title', "Searched notes for 'rack'")
    expect(screen.queryByText(TOOL_STEP_TEXT.input)).toBeNull()
    expect(container.querySelector('[data-icon="ph-check"]')).not.toBeNull()

    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(TOOL_STEP_TEXT.input)).toBeInTheDocument()
    expect(screen.getByText(TOOL_STEP_TEXT.result)).toBeInTheDocument()
    const pres = container.querySelectorAll('pre')
    expect(pres).toHaveLength(2)
    expect(pres[0].textContent).toBe(JSON.stringify({ query: 'rack' }, null, 2))
    expect(pres[1].textContent).toBe('[]')

    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(TOOL_STEP_TEXT.input)).toBeNull()
  })

  test("test a result's HTML shows as text", async () => {
    const user = userEvent.setup()
    const hostile = '<img src=x onerror=alert(1)>'
    const { container } = render(<ToolStep step={step({ result: hostile })} />)
    await user.click(screen.getByRole('button'))
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(hostile)).toBeInTheDocument()
  })

  test('test a missing result shows No result, a failed one its suffix and icon', async () => {
    const user = userEvent.setup()
    const { container } = render(<ToolStep step={step({ result: null, isError: true })} />)
    const row = screen.getByRole('button', { name: "Searched notes for 'rack' (failed)" })
    expect(container.querySelector('[data-icon="ph-warning-circle"]')).not.toBeNull()
    await user.click(row)
    expect(screen.getByText(TOOL_STEP_TEXT.noResult)).toBeInTheDocument()
  })

  test('test a pending step shows a spinner', () => {
    const { container } = render(<ToolStep step={step({ result: null, done: false })} />)
    expect(screen.getByRole('button', { name: "Searched notes for 'rack'" })).toBeInTheDocument()
    const spinner = container.querySelector('[data-icon="ph-spinner-gap"]')
    expect(spinner).not.toBeNull()
    expect(spinner).toHaveClass('animate-spin')
    expect(container.querySelector('[data-icon="ph-check"]')).toBeNull()
  })

  test('test a stopped step shows no spinner', () => {
    const { container } = render(<ToolStep step={step({ result: null, done: false, stopped: true })} />)
    expect(screen.getByRole('button', { name: "Searched notes for 'rack' (stopped)" })).toBeInTheDocument()
    expect(container.querySelector('[data-icon="ph-spinner-gap"]')).toBeNull()
  })
})
