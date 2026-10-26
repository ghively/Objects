import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PropertyDef, PropertyType } from '@/api/types'
import { CheckboxCell } from './CheckboxCell'
import { NumberCell } from './NumberCell'
import { parseGfmTable, serializeGfmTable, SimpleTableCell } from './SimpleTableCell'
import { TextCell } from './TextCell'
import { UrlCell } from './UrlCell'
import { DateCell } from './DateCell'
import { ReadOnlyDateCell } from './ReadOnlyDateCell'
import { renderInline, TextBlockCell } from './TextBlockCell'

function def(type: PropertyType, extra: Partial<PropertyDef> = {}): PropertyDef {
  return {
    id: 'p1',
    key: 'p1',
    name: 'Prop',
    type,
    description: '',
    icon: null,
    visibility: 'alwaysShow',
    options: {},
    ...extra,
  }
}

describe('NumberCell', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('test NumberCell saves on 250ms debounce and on blur; empty → null; "abc" ignored', () => {
    const onChange = vi.fn()
    render(<NumberCell def={def('number')} value={null} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '42' } })
    act(() => vi.advanceTimersByTime(249))
    expect(onChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onChange).toHaveBeenLastCalledWith(42)

    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(7)
    expect(onChange).toHaveBeenCalledTimes(2)

    onChange.mockClear()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(null)

    onChange.mockClear()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'abc' } })
    act(() => vi.advanceTimersByTime(500))
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('test NumberCell renders progress bar width 40% for value 4 with 10 steps', () => {
    const d = def('number', {
      options: { numberFormat: { type: 'progress', options: { progress: { steps: 10, color: 'blue' } } } },
    })
    render(<NumberCell def={d} value={4} onChange={() => {}} />)
    expect(screen.getByTestId('progress-bar')).toHaveStyle({ width: '40%' })
  })

  it('a progress format without a colour renders blue, as in Object's, () => {
    const d = def('number', { options: { numberFormat: { type: 'progress', options: {} } } })
    render(<NumberCell def={d} value={4} onChange={() => {}} />)
    expect(screen.getByTestId('progress-bar').getAttribute('style')).toContain('var(--line-blue)')
  })

  it('shows the formatted number when not focused', () => {
    const d = def('number', {
      options: { numberFormat: { type: 'currency', options: { currency: 'EUR', decimals: { min: 2, max: 2 } } } },
    })
    render(<NumberCell def={d} value={1234.5} onChange={() => {}} />)
    expect(screen.getByRole('textbox')).toHaveValue('€1,234.50')
  })
})

describe('CheckboxCell', () => {
  it('test CheckboxCell toggles and shows description', async () => {
    const onChange = vi.fn()
    render(<CheckboxCell def={def('boolean', { description: 'Done yet?' })} value={false} onChange={onChange} />)
    expect(screen.getByText('Done yet?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('does not toggle when read-only', async () => {
    const onChange = vi.fn()
    render(<CheckboxCell def={def('boolean')} value={true} readOnly onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('UrlCell', () => {
  it('test UrlCell renders external link; "Edit link" modal saves; "Remove link" clears', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<UrlCell def={def('url')} value="https://example.com/a" onChange={onChange} />)
    const link = screen.getByRole('link', { name: /example\.com/ })
    expect(link).toHaveAttribute('href', 'https://example.com/a')
    expect(link).toHaveAttribute('target', '_blank')

    await userEvent.click(screen.getByRole('button', { name: 'Edit link' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Edit link')
    const input = screen.getByRole('textbox')
    await userEvent.clear(input)
    await userEvent.type(input, 'https://example.org/b')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChange).toHaveBeenLastCalledWith('https://example.org/b')

    rerender(<UrlCell def={def('url')} value="https://example.org/b" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove link' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('empty url offers "Add link"', async () => {
    render(<UrlCell def={def('url')} value={null} onChange={() => {}} />)
    expect(screen.getByText('Empty')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Add link')
  })
})

describe('TextCell', () => {
  it('test TextCell Esc blurs and commits', async () => {
    const onChange = vi.fn()
    render(<TextCell def={def('text')} value="old" onChange={onChange} />)
    const input = screen.getByRole('textbox')
    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, 'new value')
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(onChange).toHaveBeenCalledWith('new value')
    expect(input).not.toHaveFocus()
  })

  it('an unchanged blur writes nothing and empty commits null', async () => {
    const onChange = vi.fn()
    render(<TextCell def={def('text')} value="same" onChange={onChange} />)
    const input = screen.getByRole('textbox')
    await userEvent.click(input)
    await userEvent.tab()
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.tab()
    expect(onChange).toHaveBeenCalledWith(null)
  })
})

describe('TextBlockCell', () => {
  it('renders inline markdown', () => {
    render(<TextBlockCell def={def('textBlock')} value="some **bold** text" onChange={() => {}} />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })

  it('drops javascript: link hrefs', () => {
    const html = renderInline('[x](javascript:alert(1)) [y](JaVaScRiPt&#58;alert(1)) [z](data:text/html,hi)')
    expect(html).not.toMatch(/href/i)
    expect(html).toContain('x')
  })

  it('keeps safe links and opens them in a new tab', () => {
    const html = renderInline('[a](https://example.com) [b](mailto:a@b.c) [c](/notes/1)')
    const host = document.createElement('div')
    host.innerHTML = html
    const links = [...host.querySelectorAll('a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com', 'mailto:a@b.c', '/notes/1'])
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    }
  })

  it('shows code spans with <, > and & exactly once escaped', () => {
    render(<TextBlockCell def={def('textBlock')} value={'`a<b` and `a && b`'} onChange={() => {}} />)
    expect(screen.getByText('a<b').tagName).toBe('CODE')
    expect(screen.getByText('a && b').tagName).toBe('CODE')
  })

  it('shows raw HTML as text', () => {
    const { container } = render(
      <TextBlockCell def={def('textBlock')} value="x <b>hi</b> <img src=x onerror=alert(1)>" onChange={() => {}} />,
    )
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container).toHaveTextContent('x <b>hi</b> <img src=x onerror=alert(1)>')
  })

  it('clicking a link does not open the editor', () => {
    render(<TextBlockCell def={def('textBlock')} value="see [a](https://example.com)" onChange={() => {}} />)
    const link = screen.getByRole('link', { name: 'a' })
    link.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(link)
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('SimpleTableCell', () => {
  it('test SimpleTableCell edits a cell and serialises a GFM table', async () => {
    const onChange = vi.fn()
    const md = '| Name | Qty |\n| --- | --- |\n| Apple | 3 |'
    render(<SimpleTableCell def={def('simpleTableBlock')} value={md} onChange={onChange} />)
    const cell = screen.getByDisplayValue('3')
    await userEvent.clear(cell)
    await userEvent.type(cell, '5|6')
    await userEvent.tab()
    expect(onChange).toHaveBeenCalledWith('| Name | Qty |\n| --- | --- |\n| Apple | 5\\|6 |')
  })

  it('round-trips parse and serialise', () => {
    const rows = parseGfmTable('| a | b \\| c |\n|:--|--:|\n| 1 | 2 |')
    expect(rows).toEqual([
      ['a', 'b | c'],
      ['1', '2'],
    ])
    expect(serializeGfmTable(rows)).toBe('| a | b \\| c |\n| --- | --- |\n| 1 | 2 |')
  })
})

describe('placeholders', () => {
  it('test placeholder is description else "Empty"', () => {
    const { unmount } = render(<TextCell def={def('text', { description: 'Who owns it' })} value={null} onChange={() => {}} />)
    expect(screen.getByPlaceholderText('Who owns it')).toBeInTheDocument()
    unmount()
    render(<TextCell def={def('text')} value={null} onChange={() => {}} />)
    expect(screen.getByPlaceholderText('Empty')).toBeInTheDocument()
  })

  it('DateCell shows its placeholder and value', () => {
    const { unmount } = render(<DateCell def={def('datetime')} value={null} onChange={() => {}} />)
    expect(screen.getByText('Empty')).toBeInTheDocument()
    unmount()
    render(<DateCell def={def('datetime')} value={{ start: '2026-10-30', resolution: 'day' }} onChange={() => {}} />)
    expect(screen.getByText('Oct 30, 2026')).toBeInTheDocument()
  })

  it('ReadOnlyDateCell formats an ISO timestamp', () => {
    render(<ReadOnlyDateCell def={def('entity_createdAt')} value="2026-10-30T00:00:00.000Z" onChange={() => {}} />)
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })
})
