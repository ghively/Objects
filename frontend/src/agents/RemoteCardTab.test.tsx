import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { remoteAgent, remotePreview } from '@/test/mockApi'
import { REMOTE_TEXT } from './agentText'
import { httpUrl, RemoteCardTab } from './RemoteCardTab'

const PLANNER = '01JREMOTE00000000000000001'

function withCard(partial: Partial<ReturnType<typeof remotePreview>['card']>) {
  const base = remoteAgent({ id: PLANNER })
  return remoteAgent({ id: PLANNER, remote: { ...base.remote!, card: { ...base.remote!.card, ...partial } } })
}

describe('RemoteCardTab', () => {
  test('test the Card tab shows what the card says', () => {
    render(<RemoteCardTab agent={remoteAgent({ id: PLANNER })} />)
    expect(screen.getByText("A synthetic agent for Object's tests.")).toBeInTheDocument()
    expect(screen.getByText('Fake Org')).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://example.org/docs' })).toHaveAttribute('href', 'https://example.org/docs')
    expect(screen.getByText('text/plain, text/markdown')).toBeInTheDocument()
    expect(screen.getByText('text/plain, application/json')).toBeInTheDocument()
    const skills = screen.getByRole('list', { name: REMOTE_TEXT.skills })
    const skill = within(skills).getByRole('listitem')
    expect(skill).toHaveTextContent('Plan a trip')
    expect(skill).toHaveTextContent('Plans a short trip.')
    expect(skill).toHaveTextContent('travel')
    expect(skill).toHaveTextContent('Plan two days in Lisbon.')
    expect(screen.getByText(/^Card fetched /)).toBeInTheDocument()
  })

  test('test the Card tab renders a description with HTML as text', () => {
    const hostile = '<img src=x onerror=alert(1)> **bold**'
    const { container } = render(
      <RemoteCardTab
        agent={withCard({
          description: hostile,
          skills: [{ id: 's', name: '<b>x</b>', description: '<script>bad()</script>', tags: [], examples: [] }],
        })}
      />,
    )
    expect(screen.getByText(hostile)).toBeInTheDocument()
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('strong')).toBeNull()
  })

  test("test a documentation link that isn't http is not a link", () => {
    render(<RemoteCardTab agent={withCard({ documentationUrl: 'javascript:alert(1)' })} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument()
    expect(httpUrl('file:///C:/x')).toBeNull()
    expect(httpUrl('not a url')).toBeNull()
    expect(httpUrl('http://example.org/a')).toBe('http://example.org/a')
  })
})
