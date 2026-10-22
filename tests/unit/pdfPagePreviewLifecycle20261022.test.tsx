import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PdfPagePreview } from '../../src/renderer/documentFiles/media/PdfPagePreview'

const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: pdf.getDocument }))

function documentFixture(renderPage = () => ({ promise: Promise.resolve(), cancel: vi.fn() })) {
  const getPage = vi.fn(async (_pageNumber: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: vi.fn(renderPage),
  }))
  const destroy = vi.fn(async () => {})
  pdf.getDocument.mockReturnValue({ promise: Promise.resolve({ getPage }), destroy })
  return { getPage, destroy }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); pdf.getDocument.mockReset() })

function viewport() {
  let width = 600
  const resize = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0, y: 0, top: 0, left: 0, right: width, bottom: 800, width, height: 800, toJSON() {},
  }))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize.mockImplementation(() => callback([], this as unknown as ResizeObserver)) }
    observe() {}
    disconnect() {}
  })
  return { resizeTo: async (next: number) => { width = next; await act(async () => { resize() }) } }
}

describe('PDF page preview document lifecycle', () => {
  it('keeps one document across page, width and callback changes, then releases it on close', async () => {
    const size = viewport(), source = new Uint8Array([1, 2, 3]), loaded = documentFixture()
    const ready = vi.fn()
    const view = render(<div><PdfPagePreview bytes={source} page={0} onReady={ready} /></div>)
    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true))
    expect(loaded.getPage).toHaveBeenLastCalledWith(1)
    const nextReady = vi.fn()
    view.rerender(<div><PdfPagePreview bytes={source} page={1} onReady={nextReady} /></div>)
    await waitFor(() => expect(nextReady).toHaveBeenLastCalledWith(true))
    await size.resizeTo(480)
    await waitFor(() => expect(loaded.getPage).toHaveBeenCalledTimes(3))
    expect(pdf.getDocument).toHaveBeenCalledTimes(1)
    expect(pdf.getDocument.mock.calls[0]![0].data).not.toBe(source)
    expect(source).toEqual(new Uint8Array([1, 2, 3]))
    expect(loaded.destroy).not.toHaveBeenCalled()
    view.unmount()
    expect(loaded.destroy).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending page render before drawing the next page on the same canvas', async () => {
    viewport()
    let reject!: (error: Error) => void
    const first = { promise: new Promise<void>((_resolve, fail) => { reject = fail }), cancel: vi.fn(() => reject(new Error('cancelled'))) }
    let count = 0
    const loaded = documentFixture(() => ++count === 1 ? first : { promise: Promise.resolve(), cancel: vi.fn() })
    const ready = vi.fn(), source = new Uint8Array([4])
    const view = render(<div><PdfPagePreview bytes={source} page={0} onReady={ready} /></div>)
    await waitFor(() => expect(loaded.getPage).toHaveBeenCalledTimes(1))
    view.rerender(<div><PdfPagePreview bytes={source} page={1} onReady={ready} /></div>)
    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true))
    expect(first.cancel).toHaveBeenCalledTimes(1)
    expect(loaded.getPage.mock.calls.map(call => call[0])).toEqual([1, 2])
    expect(pdf.getDocument).toHaveBeenCalledTimes(1)
    expect(view.queryByRole('alert')).toBeNull()
    view.unmount()
  })

  it('releases the old document and opens new bytes without reusing stale page data', async () => {
    viewport()
    const old = documentFixture(), ready = vi.fn()
    const view = render(<div><PdfPagePreview bytes={new Uint8Array([1])} page={0} onReady={ready} /></div>)
    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true))
    const next = documentFixture()
    view.rerender(<div><PdfPagePreview bytes={new Uint8Array([2])} page={0} onReady={ready} /></div>)
    await waitFor(() => expect(next.getPage).toHaveBeenCalledTimes(1))
    expect(pdf.getDocument).toHaveBeenCalledTimes(2)
    expect(old.destroy).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(next.destroy).toHaveBeenCalledTimes(1)
  })
})
