// M16 T5: the model list hook and its helpers.
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import type { AiModels } from '@/api/types'
import { mockApi } from '@/test/mockApi'

const served = (): Promise<AiModels> => mockApi().aiModels()

beforeEach(() => {
  vi.resetModules()
})

describe('models', () => {
  test('test useAiModels fetches once', async () => {
    const { api } = await import('@/api/client')
    const { useAiModels } = await import('./models')
    const a = renderHook(() => useAiModels())
    const b = renderHook(() => useAiModels())
    await waitFor(() => expect(a.result.current).not.toBeNull())
    await waitFor(() => expect(b.result.current).not.toBeNull())
    expect(a.result.current?.models).toHaveLength(8)
    const c = renderHook(() => useAiModels())
    expect(c.result.current?.models).toHaveLength(8)
    expect(vi.mocked(api).aiModels).toHaveBeenCalledTimes(1)
  })

  test('test modelLabel', async () => {
    const { modelLabel } = await import('./models')
    const models = await served()
    expect(modelLabel(null, models, 'Default')).toBe('Default')
    expect(modelLabel('claude-opus-5-5', models, 'Default')).toBe('Opus 5.5')
    expect(modelLabel('my-model', models, 'Default')).toBe('my-model')
    expect(modelLabel('claude-opus-5-5', null, 'Default')).toBe('claude-opus-5-5')
  })

  test('test isModelName follows the served pattern', async () => {
    const { isModelName } = await import('./models')
    const models = await served()
    expect(isModelName('claude-opus-5-5[1m]', models)).toBe(true)
    expect(isModelName('sonnet', models)).toBe(true)
    expect(isModelName('-p', models)).toBe(false)
    expect(isModelName('a b', models)).toBe(false)
    expect(isModelName('$(x)', models)).toBe(false)
    expect(isModelName('', models)).toBe(false)
    expect(isModelName('a'.repeat(80), models)).toBe(true)
    expect(isModelName('a'.repeat(81), models)).toBe(false)
    expect(isModelName('claude-opus-5-5', null)).toBe(false)
  })
})
