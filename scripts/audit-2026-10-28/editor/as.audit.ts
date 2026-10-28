import fs from 'node:fs'
import { act, renderHook } from '@testing-library/react'
import { test, vi } from 'vitest'
vi.mock('@/api/client', async (orig) => ({ ...(await orig()), api: (await import('@/test/mockApi')).mockApi() }))
import { api } from '@/api/client'
import { useAutosave } from './useAutosave'
const out = (s: string) => fs.appendFileSync(process.env.OUT!, s + '\n')

test('switch path while save in flight', async () => {
  const calls: [string, string][] = []
  let release: (() => void) | null = null
  vi.mocked(api.saveBody).mockImplementation((path: string, body: string) => {
    calls.push([path, body])
    return new Promise((res) => { release = () => res({ version: 'v' + calls.length } as any) })
  })
  let body = 'A1'
  const { result, rerender } = renderHook((p: { path: string }) => useAutosave({ path: p.path, version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }), { initialProps: { path: 'a.md' } })
  act(() => result.current.markLoaded('A0', 'v0'))
  let p1: Promise<void>
  await act(async () => { p1 = result.current.flush() })  // save A1 in flight
  body = 'A2' // more typing on a.md
  // switching objects: the Editor's cleanup calls flush(oldPath) before the new body loads
  await act(async () => { void result.current.flush('a.md') })
  rerender({ path: 'b.md' })
  body = 'B0'
  act(() => result.current.markLoaded('B0', 'w0'))
  await act(async () => { release!(); await p1! })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  out('switch: saves = ' + JSON.stringify(calls) + '  (A2 never saved => lost)')
})

test('unmount while save in flight', async () => {
  const calls: [string, string][] = []
  let release: (() => void) | null = null
  vi.mocked(api.saveBody).mockImplementation((path: string, body: string) => {
    calls.push([path, body])
    return new Promise((res) => { release = () => res({ version: 'v' + calls.length } as any) })
  })
  let body: string | null = 'A1'
  const { result, unmount } = renderHook(() => useAutosave({ path: 'a.md', version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }))
  act(() => result.current.markLoaded('A0', 'v0'))
  let p1: Promise<void>
  await act(async () => { p1 = result.current.flush() })
  body = 'A2'
  await act(async () => { void result.current.flush('a.md') })
  unmount()
  body = null // editor destroyed
  await act(async () => { release!(); await p1! })
  out('unmount: saves = ' + JSON.stringify(calls))
})
