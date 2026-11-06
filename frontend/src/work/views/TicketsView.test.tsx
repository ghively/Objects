// M23 Task 11: the Tickets view embeds M22's Tickets query page (`work-tickets`).
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/queries/QueryPage', () => ({
  QueryPage: ({ id }: { id: string }) => <div data-testid="query-page" data-query-id={id} />,
}))

import { workBoard } from '@/test/mockApi'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { TicketsView } from './TicketsView'

describe('TicketsView', () => {
  test('test renders the work-tickets query page', () => {
    resetWorkData()
    useWorkData.setState({ board: workBoard([]) })
    render(<TicketsView data={useWorkData.getState()} now={new Date('2026-11-05T10:00:00.000Z')} />)
    expect(screen.getByTestId('query-page')).toHaveAttribute('data-query-id', 'work-tickets')
  })
})
