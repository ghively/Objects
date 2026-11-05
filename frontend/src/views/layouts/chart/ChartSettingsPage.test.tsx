import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { ChartViewConfig, ViewState } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'
import { emptyFilterGroup } from '../../model'
import { ChartSettings } from '../ChartLayout'
import { DEFAULT_CHART_CONFIG } from './chartData'

const task = typeDef({
  id: 'task',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({ id: 'status', type: 'label', name: 'Status', options: { set: [] } }),
    propertyDef({ id: 'points', type: 'number', name: 'Points' }),
    propertyDef({ id: 'due', type: 'datetime', name: 'Due' }),
    propertyDef({ id: 'done', type: 'boolean', name: 'Done' }),
  ],
})

const base: ViewState = { viewDefinition: { dataViewLayout: 'chart' }, filterGroup: emptyFilterGroup(), sorts: [], groupBy: null }

function Harness({ onChange }: { onChange(c: ChartViewConfig | undefined): void }) {
  const [state, setState] = useState(base)
  return (
    <ChartSettings
      types={[task]}
      state={state}
      onState={(s) => {
        onChange(s.viewDefinition.chartConfig)
        setState(s)
      }}
    />
  )
}

/** Opens the picker named `label` and picks `option`. */
function pick(label: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: option }))
}

describe('chart settings page', () => {
  test('shows the defaults: bar, first label on X, count, no split', () => {
    render(<Harness onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Chart type' }).textContent).toContain('Bar')
    expect(screen.getByRole('button', { name: 'X axis' }).textContent).toContain('Status')
    expect(screen.getByRole('button', { name: 'Y axis' }).textContent).toContain('Count of objects')
    expect(screen.getByRole('button', { name: 'Split by' }).textContent).toContain('None')
    expect(screen.queryByRole('button', { name: 'Calculation' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Cumulative' })).toBeNull()
    expect((screen.getByRole('switch', { name: 'Hide empty groups' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('switch', { name: 'Show legend' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('switch', { name: 'Show values' }) as HTMLInputElement).checked).toBe(false)
  })

  test('each control writes the whole chart config', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const last = () => onChange.mock.calls.at(-1)?.[0] as ChartViewConfig

    pick('Chart type', 'Line')
    expect(last()).toEqual({ ...DEFAULT_CHART_CONFIG, kind: 'line' })
    fireEvent.click(screen.getByRole('switch', { name: 'Cumulative' }))
    expect(last().cumulative).toBe(true)

    pick('X axis', 'Due')
    expect(last().xProperty).toBe('due')
    pick('Group dates by', 'Week')
    expect(last().xDateBucket).toBe('week')

    pick('Y axis', 'Points')
    expect(last()).toMatchObject({ yProperty: 'points', yCalc: 'sum' })
    pick('Calculation', 'Average')
    expect(last().yCalc).toBe('average')
    pick('Y axis', 'Count of objects')
    expect(last()).toMatchObject({ yProperty: null, yCalc: 'countAll' })

    pick('Split by', 'Status')
    expect(last().splitBy).toBe('status')
    pick('Sort', 'Y axis, descending')
    expect(last().sort).toBe('yDescending')

    fireEvent.click(screen.getByRole('switch', { name: 'Hide empty groups' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show legend' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show values' }))
    expect(last()).toMatchObject({ hideEmptyGroups: false, showLegend: false, showValues: true })
  })

  test('picking the split property as X clears the split', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    pick('Split by', 'Done')
    pick('X axis', 'Done')
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ xProperty: 'done', splitBy: null })
  })

  test('donut has no split; number has only its value', () => {
    render(<Harness onChange={() => {}} />)
    pick('Chart type', 'Donut')
    expect(screen.queryByRole('button', { name: 'Split by' })).toBeNull()
    pick('Chart type', 'Number')
    expect(screen.queryByRole('button', { name: 'X axis' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sort' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Value' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export PNG' })).toBeTruthy()
  })
})
