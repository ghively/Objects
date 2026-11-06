// M20: the notice before the first send of context to a remote agent.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { RemoteContextNotice } from './RemoteContextNotice'
import { REMOTE_CHAT_TEXT as R } from './aiText'

describe('RemoteContextNotice', () => {
  test('test the notice names the agent and the host; Send and Cancel answer', async () => {
    const onSend = vi.fn()
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(<RemoteContextNotice open agentName="Fake Planner" host="agents.example.com" onSend={onSend} onCancel={onCancel} />)
    const dialog = screen.getByRole('dialog', { name: 'This leaves your computer' })
    expect(dialog).toHaveTextContent(
      'Fake Planner is a remote agent. The context pages you send go to agents.example.com, outside this computer. Pages excluded from AI are never sent.',
    )
    await user.click(screen.getByRole('button', { name: R.noticeSend }))
    expect(onSend).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: R.noticeCancel }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('test closed shows nothing; Escape cancels', async () => {
    const onCancel = vi.fn()
    const { rerender } = render(<RemoteContextNotice open={false} agentName="A" host="h" onSend={vi.fn()} onCancel={onCancel} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<RemoteContextNotice open agentName="A" host="h" onSend={vi.fn()} onCancel={onCancel} />)
    await userEvent.setup().keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })

  test('test the strings', () => {
    expect(R.noticeTitle).toBe('This leaves your computer')
    expect(R.noticeSend).toBe('Send')
    expect(R.noticeCancel).toBe('Cancel')
  })
})
