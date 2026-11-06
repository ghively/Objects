// M16 T5: the model picker (chat header and Settings > AI Assistant > Model).
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// The list is cached once per window, so each test loads fresh modules.
async function load() {
  const { api } = await import('@/api/client')
  const { ModelPicker } = await import('./ModelPicker')
  const { MODEL_TEXT } = await import('./models')
  return { api: vi.mocked(api), ModelPicker, MODEL_TEXT }
}

beforeEach(() => {
  vi.resetModules()
})

async function openList(user: ReturnType<typeof userEvent.setup>, name = 'Model') {
  await user.click(screen.getByRole('button', { name }))
  return screen.findByRole('listbox')
}

describe('ModelPicker', () => {
  test('test lists Default, the aliases, the versions and Custom…', async () => {
    const { api, ModelPicker } = await load()
    const user = userEvent.setup()
    render(<ModelPicker value={null} onChange={() => {}} defaultLabel="Default" ariaLabel="Model" />)
    await waitFor(() => expect(api.aiModels).toHaveBeenCalled())
    const list = await openList(user)
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(10))
    const names = within(list).getAllByRole('option').map((o) => o.textContent)
    expect(names).toEqual([
      'Default',
      'Fable (latest)',
      'Opus (latest)',
      'Sonnet (latest)',
      'Haiku (latest)',
      'Fable 5.1',
      'Opus 5.5',
      'Sonnet 5.5',
      'Haiku 5.5',
      'Custom…',
    ])
    expect(within(list).getByText('Latest')).toBeInTheDocument()
    expect(within(list).getByText('Versions')).toBeInTheDocument()
    expect(within(list).getByRole('option', { name: 'Default' })).toHaveAttribute('aria-selected', 'true')
  })

  test('test picking a version and Default', async () => {
    const { ModelPicker } = await load()
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<ModelPicker value={null} onChange={onChange} defaultLabel="Default" ariaLabel="Model" />)
    let list = await openList(user)
    await user.click(await within(list).findByRole('option', { name: 'Opus 5.5' }))
    expect(onChange).toHaveBeenLastCalledWith('claude-opus-5-5')
    rerender(<ModelPicker value="claude-opus-5-5" onChange={onChange} defaultLabel="Default" ariaLabel="Model" />)
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Opus 5.5')
    list = await openList(user)
    expect(within(list).getByRole('option', { name: 'Opus 5.5' })).toHaveAttribute('aria-selected', 'true')
    await user.click(within(list).getByRole('option', { name: 'Default' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  test('test keyboard: arrows move, Enter picks', async () => {
    const { ModelPicker } = await load()
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ModelPicker value={null} onChange={onChange} defaultLabel="Default" ariaLabel="Model" />)
    const list = await openList(user)
    await within(list).findByRole('option', { name: 'Fable (latest)' })
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('opus')
  })

  test('test Custom… saves a name', async () => {
    const { ModelPicker } = await load()
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ModelPicker value={null} onChange={onChange} defaultLabel="Default" ariaLabel="Model" />)
    const list = await openList(user)
    await user.click(await within(list).findByRole('option', { name: 'Custom…' }))
    const input = screen.getByRole('textbox', { name: 'Model id' })
    expect(input).toHaveAttribute('placeholder', 'Model id, e.g. claude-fable-5-1')
    await user.type(input, 'claude-opus-5-5[[1m]{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('claude-opus-5-5[1m]')
  })

  test('test Custom… refuses a name the server would refuse', async () => {
    const { ModelPicker, MODEL_TEXT } = await load()
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ModelPicker value={null} onChange={onChange} defaultLabel="Default" ariaLabel="Model" />)
    const list = await openList(user)
    await user.click(await within(list).findByRole('option', { name: 'Custom…' }))
    await user.type(screen.getByRole('textbox', { name: 'Model id' }), 'a b{Enter}')
    expect(screen.getByText("That isn't a model name.")).toBeInTheDocument()
    expect(MODEL_TEXT.badName).toBe("That isn't a model name.")
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChange).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Model id' })).toBeNull()
  })

  test('test a custom current value shows as its id, selected', async () => {
    const { ModelPicker } = await load()
    const user = userEvent.setup()
    render(<ModelPicker value="my-model" onChange={() => {}} defaultLabel="Default" ariaLabel="Model" />)
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('my-model')
    const list = await openList(user)
    const row = await within(list).findByRole('option', { name: 'my-model' })
    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(within(list).getByRole('option', { name: 'Default' })).toHaveAttribute('aria-selected', 'false')
    expect(within(list).getAllByRole('option')).toHaveLength(11)
  })

  test('test without the list only Default and Custom… show', async () => {
    const { api, ModelPicker } = await load()
    api.aiModels.mockRejectedValue(new Error('offline'))
    const user = userEvent.setup()
    render(<ModelPicker value={null} onChange={() => {}} defaultLabel="Default (Sonnet 5.5)" ariaLabel="Model" compact />)
    await waitFor(() => expect(api.aiModels).toHaveBeenCalled())
    const list = await openList(user)
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Default (Sonnet 5.5)', 'Custom…'])
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent(/^Default$/)
    expect(options[1]).toHaveAttribute('aria-disabled', 'true')
    expect(within(list).queryByText('Latest')).toBeNull()
  })
})
