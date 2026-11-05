import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { ComputedValue, PropertyDef, PropertyType } from '@/api/types'
import { isValidEmail, isValidPhone, mailtoHref, telHref } from '../contact'
import { EmailCell } from './EmailCell'
import { FilesCell } from './FilesCell'
import { FormulaCell } from './FormulaCell'
import { IdCell } from './IdCell'
import { PhoneCell } from './PhoneCell'
import { RollupCell } from './RollupCell'

const mocked = vi.mocked(api)

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

const cv = (type: ComputedValue['type'], value: ComputedValue['value'], error?: string): ComputedValue =>
  error === undefined ? { type, value } : { type, value, error }

describe('FormulaCell and RollupCell', () => {
  it('renders text, a formatted number, a date and an empty placeholder', () => {
    const d = def('formula', { options: { expression: '1', numberFormat: { type: 'currency', options: { currency: 'USD', decimals: { min: 2, max: 2 } } } } })
    const { rerender } = render(<FormulaCell def={d} value={cv('text', 'Hello')} onChange={() => {}} />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
    rerender(<FormulaCell def={d} value={cv('number', 1234.5)} onChange={() => {}} />)
    expect(screen.getByText('$1,234.50')).toBeInTheDocument()
    rerender(<FormulaCell def={d} value={cv('date', '2026-10-30')} onChange={() => {}} />)
    expect(screen.getByText('Oct 30, 2026')).toBeInTheDocument()
    rerender(<FormulaCell def={d} value={cv('empty', null)} onChange={() => {}} />)
    expect(screen.getByText('Empty')).toBeInTheDocument()
    rerender(<FormulaCell def={d} value={null} onChange={() => {}} />)
    expect(screen.getByText('Empty')).toBeInTheDocument()
  })

  it('an empty value in a table shows no placeholder', () => {
    const { container } = render(<FormulaCell def={def('formula')} value={cv('empty', null)} inTable density="table" onChange={() => {}} />)
    expect(container.textContent).toBe('')
  })

  it('shows "Formula error" with the message on hover', () => {
    render(<FormulaCell def={def('formula')} value={cv('error', null, 'Unknown property "Cost"')} onChange={() => {}} />)
    const el = screen.getByText('Formula error')
    expect(el).toHaveAttribute('title', 'Unknown property "Cost"')
  })

  it('a boolean is a read-only checkbox that never writes', async () => {
    const onChange = vi.fn()
    render(<FormulaCell def={def('formula', { name: 'Late' })} value={cv('boolean', true)} onChange={onChange} />)
    const box = screen.getByRole('checkbox', { name: 'Late' })
    expect(box).toBeChecked()
    expect(box).toBeDisabled()
    await userEvent.click(box)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a list shows chips in the panel and comma text in a table', () => {
    const { rerender, container } = render(<RollupCell def={def('rollup')} value={cv('list', ['Alpha', 'Beta'])} onChange={() => {}} />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    rerender(<RollupCell def={def('rollup')} value={cv('list', ['Alpha', 'Beta'])} density="table" inTable onChange={() => {}} />)
    expect(container.textContent).toBe('Alpha, Beta')
  })

  it("a rollup's percent calculation without a number format shows a percentage", () => {
    render(<RollupCell def={def('rollup', { options: { calc: 'percentNotEmpty' } })} value={cv('number', 0.25)} onChange={() => {}} />)
    expect(screen.getByText('25%')).toBeInTheDocument()
  })
})

describe('IdCell', () => {
  it('shows the ID read-only and a muted placeholder when empty', () => {
    const { rerender } = render(<IdCell def={def('uniqueId')} value="TASK-12" onChange={() => {}} />)
    expect(screen.getByText('TASK-12')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    rerender(<IdCell def={def('uniqueId')} value={null} onChange={() => {}} />)
    expect(screen.getByText('Empty')).toHaveClass('text-fg-muted')
  })
})

describe('EmailCell and PhoneCell', () => {
  it('format checks follow the contract', () => {
    expect(isValidEmail('a@b')).toBe(true)
    expect(isValidEmail('name@example.com')).toBe(true)
    expect(isValidEmail('a@@b')).toBe(false)
    expect(isValidEmail('a@b@c')).toBe(false)
    expect(isValidEmail('@b')).toBe(false)
    expect(isValidEmail('a@')).toBe(false)
    expect(isValidEmail('a b@c')).toBe(false)
    expect(isValidPhone('+1 (555) 010-0.1')).toBe(true)
    expect(isValidPhone('12')).toBe(false)
    expect(isValidPhone('555-CALL')).toBe(false)
    expect(telHref('+1 (555) 010-0100')).toBe('tel:+15550100100')
    expect(mailtoHref('a?b@c.com')).toBe('mailto:a%3Fb@c.com')
  })

  it('an email is a mailto link opened outside the app', () => {
    render(<EmailCell def={def('email')} value="ann@example.com" onChange={() => {}} />)
    const link = screen.getByRole('link', { name: 'ann@example.com' })
    expect(link).toHaveAttribute('href', 'mailto:ann@example.com')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('"Edit email" refuses an invalid address with an inline error and saves a valid one', async () => {
    const onChange = vi.fn()
    render(<EmailCell def={def('email')} value="ann@example.com" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit email' }))
    const input = screen.getByRole('textbox', { name: 'Email address' })
    await userEvent.clear(input)
    await userEvent.type(input, 'not an email{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an email address like name@example.com.')
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.clear(input)
    await userEvent.type(input, ' bob@example.com {Enter}')
    expect(onChange).toHaveBeenCalledWith('bob@example.com')
  })

  it('"Remove email" clears; an empty cell offers "Add email"', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<EmailCell def={def('email')} value="ann@example.com" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove email' }))
    expect(onChange).toHaveBeenCalledWith(null)
    rerender(<EmailCell def={def('email')} value={null} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Add email' })).toBeInTheDocument()
    expect(screen.getByText('Empty')).toBeInTheDocument()
  })

  it('a phone is a tel link; an invalid number is not saved', async () => {
    const onChange = vi.fn()
    render(<PhoneCell def={def('phone')} value={null} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add phone' }))
    const input = screen.getByRole('textbox', { name: 'Phone number' })
    await userEvent.type(input, '12{Enter}')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.type(input, '3 45{Enter}')
    expect(onChange).toHaveBeenCalledWith('123 45')
  })

  it('read-only shows the link without edit buttons', () => {
    render(<PhoneCell def={def('phone')} value="+1 555 0100" readOnly onChange={() => {}} />)
    expect(screen.getByRole('link', { name: '+1 555 0100' })).toHaveAttribute('href', 'tel:+15550100')
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('FilesCell', () => {
  beforeEach(() => {
    mocked.uploadAttachment.mockReset()
    mocked.uploadAttachment.mockImplementation(async (_b, name: string) => ({ path: `Attachments/${name}`, kind: 'file' as const }))
    mocked.openAttachment.mockClear()
  })

  const files = ['Attachments/a.pdf', 'Attachments/b.docx', 'Attachments/c.txt']

  it('lists file names and opens a file with the OS', async () => {
    render(<FilesCell def={def('files')} value={files} onChange={() => {}} />)
    expect(screen.getByText('a.pdf')).toBeInTheDocument()
    expect(screen.getByText('b.docx')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open file a.pdf' }))
    expect(mocked.openAttachment).toHaveBeenCalledWith('Attachments/a.pdf')
  })

  it('removes and reorders, saving the whole list', async () => {
    const onChange = vi.fn()
    render(<FilesCell def={def('files')} value={files} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove file b.docx' }))
    expect(onChange).toHaveBeenLastCalledWith(['Attachments/a.pdf', 'Attachments/c.txt'])
    await userEvent.click(screen.getByRole('button', { name: 'Move down a.pdf' }))
    expect(onChange).toHaveBeenLastCalledWith(['Attachments/b.docx', 'Attachments/a.pdf', 'Attachments/c.txt'])
    await userEvent.click(screen.getByRole('button', { name: 'Move up c.txt' }))
    expect(onChange).toHaveBeenLastCalledWith(['Attachments/a.pdf', 'Attachments/c.txt', 'Attachments/b.docx'])
    expect(screen.getByRole('button', { name: 'Move up a.pdf' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move down c.txt' })).toBeDisabled()
  })

  it('"Add file" uploads the chosen files and appends their paths', async () => {
    const onChange = vi.fn()
    render(<FilesCell def={def('files')} value={['Attachments/a.pdf']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add file' }))
    const input = document.querySelector<HTMLInputElement>('input[data-media-picker="file"]')!
    const picked = [new File(['x'], 'new.pdf'), new File(['y'], 'two.png')]
    Object.defineProperty(input, 'files', { value: picked })
    await act(async () => {
      input.dispatchEvent(new Event('change'))
    })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['Attachments/a.pdf', 'Attachments/new.pdf', 'Attachments/two.png']))
    expect(mocked.uploadAttachment).toHaveBeenCalledTimes(2)
  })

  it('a drop of files uploads them; a file over 100 MiB is refused before sending', async () => {
    const onChange = vi.fn()
    render(<FilesCell def={def('files')} value={null} onChange={onChange} />)
    const big = new File(['x'], 'huge.bin')
    Object.defineProperty(big, 'size', { value: 101 * 1024 * 1024 })
    const dropped = [new File(['x'], 'drop.pdf'), big]
    const cell = screen.getByTestId('files-cell')
    const dataTransfer = { types: ['Files'], files: dropped, dropEffect: 'none' }
    fireEvent.dragOver(cell, { dataTransfer })
    expect(cell).toHaveAttribute('data-drop-over')
    await act(async () => {
      fireEvent.drop(cell, { dataTransfer })
    })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['Attachments/drop.pdf']))
    expect(mocked.uploadAttachment).toHaveBeenCalledTimes(1)
  })

  it('read-only lists files without edit controls and ignores drops', () => {
    const onChange = vi.fn()
    render(<FilesCell def={def('files')} value={files} readOnly onChange={onChange} />)
    expect(screen.queryByRole('button', { name: /Remove file/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add file' })).toBeNull()
    fireEvent.drop(screen.getByTestId('files-cell'), { dataTransfer: { types: ['Files'], files: [new File(['x'], 'x.pdf')] } })
    expect(mocked.uploadAttachment).not.toHaveBeenCalled()
  })

  it('a one-line table cell shows the file names', () => {
    const { container } = render(<FilesCell def={def('files')} value={files.slice(0, 2)} density="table" inTable onChange={() => {}} />)
    expect(container.textContent).toContain('a.pdf')
    expect(container.textContent).toContain('b.docx')
  })
})
