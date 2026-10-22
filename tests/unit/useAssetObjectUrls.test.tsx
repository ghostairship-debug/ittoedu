import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { retainAssetObjectUrls, useAssetObjectUrls } from '@/renderer/ui/useAssetObjectUrls'

afterEach(() => vi.unstubAllGlobals())

it('shares unchanged asset URLs across leased generations and releases superseded assets', () => {
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
  const beforeChangeCount = createObjectURL.mock.calls.length
  mounted.rerender({ files: changedFiles, types: mimeTypes })
  expect(mounted.result.current.other).toBe(first.other)
  expect(mounted.result.current.picture).not.toBe(first.picture)
  expect(createObjectURL).toHaveBeenCalledTimes(beforeChangeCount + 1)
  expect(Object.values(first).every(url => live.has(url))).toBe(true)
  releaseReader()
  expect(live.has(first.picture!)).toBe(false)
  expect(live.has(first.other!)).toBe(true)
  expect([...live.keys()].sort()).toEqual(Object.values(mounted.result.current).sort())
  const beforeMime = mounted.result.current
  mounted.rerender({ files: changedFiles, types: { picture: 'image/webp' } })
  expect(mounted.result.current).not.toBe(beforeMime)
  expect(live.get(mounted.result.current.picture!)?.type).toBe('image/webp')
  expect(live.has(beforeMime.picture!)).toBe(false)
  expect(mounted.result.current.other).toBe(beforeMime.other)
  const current = mounted.result.current
  const releaseCurrent = retainAssetObjectUrls(current)
  mounted.unmount()
  expect(Object.values(current).every(url => live.has(url))).toBe(true)
  releaseCurrent(); releaseCurrent()
  expect(live.size).toBe(0)
  expect(revokeObjectURL).toHaveBeenCalledTimes(createObjectURL.mock.calls.length)
})

it('keeps removed assets alive only while an old generation has a reader', () => {
  const live = new Set<string>()
  let sequence = 0
  const createObjectURL = vi.fn(() => { const url = `blob:asset-${++sequence}`; live.add(url); return url })
  const revokeObjectURL = vi.fn((url: string) => live.delete(url))
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  const picture = new Uint8Array([1]), other = new Uint8Array([2])
  const mounted = renderHook(({ files }: { files: Record<string, Uint8Array> }) => useAssetObjectUrls(files, {}), {
    initialProps: { files: { picture, other } as Record<string, Uint8Array> },
  })
  const first = mounted.result.current
  const releaseReader = retainAssetObjectUrls(first)
  mounted.rerender({ files: { picture } })
  expect(mounted.result.current).toEqual({ picture: first.picture })
  expect(createObjectURL).toHaveBeenCalledTimes(2)
  expect(live.has(first.other!)).toBe(true)
  releaseReader()
  expect(live.has(first.other!)).toBe(false)
  expect(live.has(first.picture!)).toBe(true)
  mounted.unmount()
  expect(live.size).toBe(0)
  expect(revokeObjectURL).toHaveBeenCalledTimes(2)
})
