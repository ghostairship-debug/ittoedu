import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAssetObjectUrls } from '@/renderer/ui/useAssetObjectUrls'

afterEach(() => vi.unstubAllGlobals())

it('releases superseded byte generations while keeping current URLs valid until unmount', () => {
  const live = new Map<string, Blob>()
  let sequence = 0
  const createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:asset-${++sequence}`
    live.set(url, blob)
    return url
  })
  const revokeObjectURL = vi.fn((url: string) => live.delete(url))
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  const mimeTypes = { picture: 'image/png' }
  const files = { picture: new Uint8Array([1, 2]), other: new Uint8Array([3]) }
  const mounted = renderHook(({ files }) => useAssetObjectUrls(files, mimeTypes), {
    initialProps: { files }, wrapper: StrictMode,
  })
  const first = mounted.result.current
  expect([...live.keys()].sort()).toEqual(Object.values(first).sort())
  expect(live.get(first.picture!)?.type).toBe('image/png')
  expect(live.get(first.other!)?.type).toBe('application/octet-stream')
  mounted.rerender({ files })
  expect(mounted.result.current).toBe(first)
  mounted.rerender({ files: { picture: new Uint8Array([4, 5]), other: files.other } })
  expect(Object.values(first).every(url => !live.has(url))).toBe(true)
  expect([...live.keys()].sort()).toEqual(Object.values(mounted.result.current).sort())
  mounted.unmount()
  expect(live.size).toBe(0)
  expect(revokeObjectURL).toHaveBeenCalledTimes(createObjectURL.mock.calls.length)
})
