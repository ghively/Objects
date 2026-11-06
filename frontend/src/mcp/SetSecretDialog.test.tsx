import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError } from '@/api/client'
import { MCP_TEXT } from './mcpText'
import { SetSecretDialog } from './SetSecretDialog'

const mocked = vi.mocked(api)
const SECRET = 's3cret-set-dialog'

function Harness({ onSaved }: { onSaved?(): void }) {
  const [name, setName] = useState<string | null>(null)
  return (
    <>
      <button type="button" onClick={() => setName('GH_TOKEN')}>
        open
      </button>
      <SetSecretDialog name={name} onOpenChange={(o) => !o && setName(null)} onSaved={onSaved} />
    </>
  )
}

describe('SetSecretDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  test('test the secret value is cleared when the dialog closes', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    expect(await screen.findByRole('heading', { name: MCP_TEXT.setTitle('GH_TOKEN') })).toBeInTheDocument()
    const field = screen.getByLabelText(MCP_TEXT.value)
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'off')
    await user.type(field, SECRET)
    await user.click(screen.getByRole('button', { name: MCP_TEXT.cancel }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocked.setMcpSecret).not.toHaveBeenCalled()
    expect(document.body.innerHTML).not.toContain(SECRET)

    // Reopened, the field is empty.
    await user.click(screen.getByRole('button', { name: 'open' }))
    expect(await screen.findByLabelText(MCP_TEXT.value)).toHaveValue('')
  })

  test('test Save calls setMcpSecret, closes and never shows the value again', async () => {
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSaved={onSaved} />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    const save = await screen.findByRole('button', { name: MCP_TEXT.save })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText(MCP_TEXT.value), SECRET)
    await user.click(save)
    await waitFor(() => expect(mocked.setMcpSecret).toHaveBeenCalledWith('GH_TOKEN', SECRET))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(document.body.innerHTML).not.toContain(SECRET)
  })

  test('test a 422 shows its message and keeps the dialog', async () => {
    mocked.setMcpSecret.mockRejectedValueOnce(new ApiError(422, "Object can't set this variable."))
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    await user.type(await screen.findByLabelText(MCP_TEXT.value), 'x')
    await user.click(screen.getByRole('button', { name: MCP_TEXT.save }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Object can't set this variable.")
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
