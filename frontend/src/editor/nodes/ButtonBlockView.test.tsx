import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/editor/media/upload', async (orig) => ({ ...(await orig()), showToast: vi.fn() }))

import { api } from '@/api/client'
import { resetAutomations } from '@/automations/useAutomations'
import { showToast } from '@/editor/media/upload'
import { automationRule } from '@/test/mockApi'
import { editorExtensions, loadBody, serializeBody } from '../document'

const mocked = vi.mocked(api)
const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

beforeEach(() => {
  vi.clearAllMocks()
  resetAutomations()
  mocked.automations.mockResolvedValue([
    automationRule({ id: 'R1', name: 'Stamp done' }),
    automationRule({ id: 'R2', name: 'Notify me' }),
    automationRule({ id: 'OFF', name: 'Paused', enabled: false }),
  ])
})

async function mount(body: string, host: { template?: boolean; path?: string | null } = {}): Promise<TiptapEditor> {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  editors.push(editor)
  const path = host.path === undefined ? 'Pages/Home.md' : host.path
  render(
    <div {...(path ? { 'data-object-path': path } : {})} {...(host.template ? { 'data-object-template': '' } : {})}>
      <EditorContent editor={editor} />
    </div>,
  )
  await act(async () => {
    loadBody(editor, body)
  })
  await waitFor(() => expect(mocked.automations).toHaveBeenCalled())
  return editor
}

const BODY = 'Intro\n\n<!-- block: button rule="R1" -->\nStart review\n\nOutro\n'

describe('ButtonBlockView', () => {
  test("pressing runs the rule on the page's object", async () => {
    await mount(BODY)
    const button = await screen.findByRole('button', { name: 'Start review' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(mocked.runAutomation).toHaveBeenCalledWith('R1', 'Pages/Home.md'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Done'))
  })

  test('in a template the button is disabled', async () => {
    await mount(BODY, { template: true })
    const button = await screen.findByRole('button', { name: 'Start review' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Buttons run in objects made from this template.')
  })

  test('a missing or turned-off rule disables it', async () => {
    await mount('<!-- block: button rule="GONE" -->\nA\n\n<!-- block: button rule="OFF" -->\nB\n\n<!-- block: button -->\nC\n')
    await waitFor(() => expect(screen.getByText('Automation not found')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('title', 'Automation not found')
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('title', 'This automation is turned off.')
    expect(screen.getByRole('button', { name: 'C' })).toHaveAttribute('title', 'Choose an automation')
    for (const name of ['A', 'B', 'C']) expect(screen.getByRole('button', { name })).toBeDisabled()
  })

  test('choosing another automation rewrites only the annotation line', async () => {
    const user = userEvent.setup()
    const editor = await mount(BODY)
    await user.click(await screen.findByRole('button', { name: 'Button menu' }))
    await user.click(await screen.findByRole('menuitemradio', { name: /Notify me/ }))
    expect(serializeBody(editor)).toBe(BODY.replace('rule="R1"', 'rule="R2"'))
  })

  test('editing the label rewrites only the label line', async () => {
    const user = userEvent.setup()
    const editor = await mount(BODY)
    await user.click(await screen.findByRole('button', { name: 'Button menu' }))
    await user.click(await screen.findByRole('button', { name: 'Edit label' }))
    const input = await screen.findByRole('textbox', { name: 'Button label' })
    expect(input).toHaveValue('Start review')
    await user.clear(input)
    await user.type(input, 'Begin{Enter}')
    expect(serializeBody(editor)).toBe(BODY.replace('\nStart review\n', '\nBegin\n'))
    expect(await screen.findByRole('button', { name: 'Begin' })).toBeInTheDocument()
  })

  test('Escape keeps the label', async () => {
    const user = userEvent.setup()
    const editor = await mount(BODY)
    await user.click(await screen.findByRole('button', { name: 'Button menu' }))
    await user.click(await screen.findByRole('button', { name: 'Edit label' }))
    const input = await screen.findByRole('textbox', { name: 'Button label' })
    await user.type(input, ' more{Escape}')
    expect(serializeBody(editor)).toBe(BODY)
  })

  test('Remove Block deletes the button', async () => {
    const user = userEvent.setup()
    const editor = await mount(BODY)
    await user.click(await screen.findByRole('button', { name: 'Button menu' }))
    await user.click(await screen.findByRole('button', { name: 'Remove Block' }))
    expect(serializeBody(editor)).not.toContain('Start review')
    expect(serializeBody(editor)).not.toContain('block: button')
  })

  test('New automation… makes a button rule and chooses it', async () => {
    const user = userEvent.setup()
    mocked.createAutomation.mockImplementation(async (input) => automationRule({ ...input, id: 'NEW1' }))
    const editor = await mount('<!-- block: button -->\nGo\n')
    await user.click(await screen.findByRole('button', { name: 'Button menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'New automation…' }))
    await screen.findByRole('dialog', { name: 'New automation' })
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Ping')
    await user.click(screen.getByRole('button', { name: '+ Add action' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Send a notification' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(serializeBody(editor)).toBe('<!-- block: button rule="NEW1" -->\nGo\n'))
    expect(mocked.createAutomation.mock.calls[0][0].trigger).toEqual({ kind: 'button', scope: null })
  })
})
