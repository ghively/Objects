// M16's header row, with M18's menu slot.
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { AiChatHeader } from './AiChatHeader'
import { AI_CHAT_TEXT as T } from './aiText'

describe('AiChatHeader', () => {
  test('test the header renders the menu slot after New chat', () => {
    render(
      <AiChatHeader
        leading={<span>Agent</span>}
        model={null}
        defaultModel={null}
        onModelChange={() => {}}
        onNewChat={() => {}}
        menu={<button type="button">More</button>}
      />,
    )
    const newChat = screen.getByRole('button', { name: T.newChat })
    const menu = screen.getByRole('button', { name: 'More' })
    expect(newChat.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(newChat.parentElement).toBe(menu.parentElement)
  })

  test('test without a menu the row ends at New chat', () => {
    render(<AiChatHeader model={null} defaultModel={null} onModelChange={() => {}} onNewChat={() => {}} />)
    const newChat = screen.getByRole('button', { name: T.newChat })
    expect(newChat.nextElementSibling).toBeNull()
  })
})
