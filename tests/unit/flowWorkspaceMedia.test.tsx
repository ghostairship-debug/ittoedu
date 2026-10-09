import { StrictMode } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAssetObjectUrls } from '../../src/renderer/ui/useAssetObjectUrls'

const objectUrls = ['createObjectURL', 'revokeObjectURL'] as const
const originals = objectUrls.map(key => Object.getOwnPropertyDescriptor(URL, key))
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  objectUrls.forEach((key, index) => {
    if (originals[index]) Object.defineProperty(URL, key, originals[index]!)
    else Reflect.deleteProperty(URL, key)
  })
})

it('keeps mounted media sources usable through StrictMode replay and byte/caption replacement, then releases them on unmount', async () => {
  let sequence = 0
  const create = vi.fn(() => `blob:flow-image-${++sequence}`), revoked = new Set<string>()
  const revoke = vi.fn((url: string) => {
    expect([...document.querySelectorAll('img[src]')].some(image => image.getAttribute('src') === url)).toBe(false)
    revoked.add(url)
  })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
  function Media({ bytes, caption }: { bytes: Uint8Array; caption: string }) {
    const urls = useAssetObjectUrls({ picture: bytes }, { picture: 'image/svg+xml' })
    return <figure><img src={urls.picture} alt="示意图" /><figcaption>{caption}</figcaption></figure>
  }
  const first = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
  const ui = render(<StrictMode><Media bytes={first} caption="原图注" /></StrictMode>)
  await waitFor(() => expect(ui.getByRole('img')).toHaveAttribute('src', expect.stringMatching(/^blob:/)))
  const shown = ui.getByRole('img').getAttribute('src')!
  expect(revoked.has(shown)).toBe(false)
  ui.rerender(<StrictMode><Media bytes={first} caption="修改图注" /></StrictMode>)
  expect(ui.getByRole('img')).toHaveAttribute('src', shown)
  expect(ui.getByText('修改图注')).toBeInTheDocument(); expect(revoked.has(shown)).toBe(false)
  const replacement = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>')
  ui.rerender(<StrictMode><Media bytes={replacement} caption="替换后的图注" /></StrictMode>)
  await waitFor(() => {
    expect(ui.getByRole('img').getAttribute('src')).not.toBe(shown)
    expect(ui.getByText('替换后的图注')).toBeInTheDocument()
    expect(revoke).toHaveBeenCalledWith(shown)
  })
  expect(revoked.has(ui.getByRole('img').getAttribute('src')!)).toBe(false)
  await act(async () => ui.unmount())
  expect(new Set(revoke.mock.calls.map(([url]) => url))).toEqual(new Set(create.mock.results.map(result => result.value)))
})
