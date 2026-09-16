import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { retainAssetObjectUrls, useAssetObjectUrls } from '@/renderer/ui/useAssetObjectUrls'

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
  const mounted = renderHook(({ files, types }) => useAssetObjectUrls(files, types), {
    initialProps: { files, types: mimeTypes }, wrapper: StrictMode,
  })
  const first = mounted.result.current
  expect([...live.keys()].sort()).toEqual(Object.values(first).sort())
  expect(live.get(first.picture!)?.type).toBe('image/png')
  expect(live.get(first.other!)?.type).toBe('application/octet-stream')
  mounted.rerender({ files, types: mimeTypes })
  expect(mounted.result.current).toBe(first)
  mounted.rerender({ files: { ...files }, types: { ...mimeTypes } })
  expect(mounted.result.current).toBe(first)
  expect(Object.values(first).every(url => live.has(url))).toBe(true)
  const releaseReader = retainAssetObjectUrls(first)
  const changedFiles = { picture: new Uint8Array([4, 5]), other: files.other }
  mounted.rerender({ files: changedFiles, types: mimeTypes })
  expect(Object.values(first).every(url => live.has(url))).toBe(true)
  releaseReader()
  expect(Object.values(first).every(url => !live.has(url))).toBe(true)
  expect([...live.keys()].sort()).toEqual(Object.values(mounted.result.current).sort())
  const beforeMime = mounted.result.current
  mounted.rerender({ files: changedFiles, types: { picture: 'image/webp' } })
  expect(mounted.result.current).not.toBe(beforeMime)
  expect(live.get(mounted.result.current.picture!)?.type).toBe('image/webp')
  expect(Object.values(beforeMime).every(url => !live.has(url))).toBe(true)
  const current = mounted.result.current
  const releaseCurrent = retainAssetObjectUrls(current)
  mounted.unmount()
  expect(Object.values(current).every(url => live.has(url))).toBe(true)
  releaseCurrent(); releaseCurrent()
  expect(live.size).toBe(0)
  expect(revokeObjectURL).toHaveBeenCalledTimes(createObjectURL.mock.calls.length)
})
