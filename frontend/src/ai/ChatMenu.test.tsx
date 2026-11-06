// M18: the chat's `…` menu with "Learn from this chat".
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError } from '@/api/client'
import { CHAT_MENU_TEXT, ChatMenu } from './ChatMenu'

const mocked = vi.mocked(api)
const CHAT = '01JCHAT0000000000000000000'

describe('ChatMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.learnFromChat.mockReset()
  })

  async function openItem() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: CHAT_MENU_TEXT.more }))
    return { user, item: await screen.findByRole('menuitem', { name: CHAT_MENU_TEXT.learn }) }
  }

  test('test Learn from this chat starts a review of the chat', async () => {
    render(<ChatMenu agentId="assistant" chatId={CHAT} />)
    const { user, item } = await openItem()
    await user.click(item)
    expect(mocked.learnFromChat).toHaveBeenCalledWith('assistant', CHAT)
  })

  test('test a refusal goes to the notice', async () => {
    const onNotice = vi.fn()
    mocked.learnFromChat.mockRejectedValueOnce(new ApiError(422, 'Learning tools are switched off for this agent.'))
    render(<ChatMenu agentId="assistant" chatId={CHAT} onNotice={onNotice} />)
    const { user, item } = await openItem()
    await user.click(item)
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Learning tools are switched off for this agent.'))
  })

  test('test disabled with no chat and while a review runs', async () => {
    const { unmount } = render(<ChatMenu agentId="assistant" chatId={null} />)
    expect((await openItem()).item).toHaveAttribute('aria-disabled', 'true')
    unmount()
    render(<ChatMenu agentId="assistant" chatId={CHAT} disabled />)
    expect((await openItem()).item).toHaveAttribute('aria-disabled', 'true')
  })
})
