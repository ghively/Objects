// M29 Task 12: a type's name patterns in type settings.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TypeDef } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useTypeEditor } from '@/object/useTypeEditor'
import { NAME_PATTERNS_TEXT as T, NamePatternsSection } from './NamePatternsSection'

function hostType(namePatterns?: string[]): TypeDef {
  return typeDef({
    id: 'host',
    name: 'Host',
    pluralName: 'Hosts',
    revision: 'r1',
    propertyDefinitions: [propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })],
    ...(namePatterns ? { namePatterns } : {}),
  })
}

function Harness() {
  const editor = useTypeEditor('host')
  return editor.type ? <NamePatternsSection type={editor.type} editor={editor} /> : null
}

function open(namePatterns?: string[]) {
  useLinkIndex.setState({ types: [hostType(namePatterns)], objects: [], loaded: true })
  render(<Harness />)
}

const box = () => screen.getByRole('textbox', { name: T.title }) as HTMLTextAreaElement
const saved = (call = 0): TypeDef => vi.mocked(api.saveType).mock.calls[call][0]

beforeEach(() => {
  vi.mocked(api.saveType).mockClear()
  resetLinkIndex()
})

describe('NamePatternsSection', () => {
  test('shows the saved patterns one per line', () => {
    open(['{ip}', 'SRV-*'])
    expect(box().value).toBe('{ip}\nSRV-*')
    expect(screen.getByText(T.description)).toBeInTheDocument()
  })

  test('one pattern per line saves namePatterns', async () => {
    const user = userEvent.setup()
    open()
    await user.type(box(), '{{ip}{Enter}  SRV-*  {Enter}{Enter}@@##')
    expect(api.saveType).not.toHaveBeenCalled()
    await user.tab()
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(saved().namePatterns).toEqual(['{ip}', 'SRV-*', '@@##'])
    // Blurring again with nothing changed saves nothing more.
    await user.click(box())
    await user.tab()
    expect(api.saveType).toHaveBeenCalledTimes(1)
  })

  test('a bad line is flagged and not saved', async () => {
    const user = userEvent.setup()
    open(['{ip}'])
    await user.type(box(), '{Enter}{{foo}{Enter}SRV-\\')
    await user.tab()
    expect(api.saveType).not.toHaveBeenCalled()
    expect(box()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(T.invalid('{foo}'))).toBeInTheDocument()
    expect(screen.getByText(T.invalid('SRV-\\'))).toBeInTheDocument()
    expect(screen.queryByText(T.invalid('{ip}'))).toBeNull()
  })

  test('an empty box saves []', async () => {
    const user = userEvent.setup()
    open(['{ip}', 'SRV-*'])
    await user.clear(box())
    await user.tab()
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(saved().namePatterns).toEqual([])
  })

  test('a 422 from the server shows its detail', async () => {
    const user = userEvent.setup()
    const detail = 'A type can have at most 20 name patterns.'
    vi.mocked(api.saveType).mockRejectedValueOnce(new ApiError(422, detail))
    open()
    await user.type(box(), 'SRV-*')
    await user.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent(detail)
  })
})
