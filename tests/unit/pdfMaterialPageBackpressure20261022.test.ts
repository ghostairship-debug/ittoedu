import { afterEach, expect, it, vi } from 'vitest'
import { extractPdfMaterial, extractPdfMaterialPages } from '../../src/renderer/project/materialExtraction'
const fake = vi.hoisted(() => ({ opened: vi.fn(), getPage: vi.fn(), destroy: vi.fn(async () => {}), cleanup: vi.fn() }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.mjs' }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, OPS: {}, getDocument: fake.opened }))
afterEach(() => vi.restoreAllMocks())
it('uses one PDF document and awaits page consumption before rasterizing the next page; the full API remains complete', async () => {
  fake.getPage.mockImplementation(async (page: number) => ({ getTextContent: async () => ({ items: [{ str: `Page ${page}`, hasEOL: false }] }),
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 50 * scale, scale }),
    render: ({ canvas }: { canvas: HTMLCanvasElement & { renderedPage: number } }) => { canvas.renderedPage = page; return { promise: Promise.resolve() } }, cleanup: fake.cleanup }))
  fake.opened.mockImplementation(() => ({ promise: Promise.resolve({ numPages: 3, getPage: fake.getPage }), destroy: fake.destroy }))
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function(this: HTMLCanvasElement & { renderedPage?: number }, callback) { callback({ arrayBuffer: async () => Uint8Array.of(this.renderedPage!).buffer } as Blob) })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), chunks: number[][] = []
  const pending = extractPdfMaterialPages(Uint8Array.of(9), { pages: { from: 1, to: 2 } }, async page => {
    chunks.push(page.material.assets.map(asset => asset.bytes[0]!))
    if (page.page === 1) await gate
  })
  await vi.waitFor(() => expect(chunks).toEqual([[1]]))
  expect(fake.getPage).toHaveBeenCalledTimes(1); expect(fake.opened).toHaveBeenCalledTimes(1)
  release(); await expect(pending).resolves.toEqual({ streamed: true, totalPages: 3, selectedPages: { from: 1, to: 2 } })
  expect(chunks).toEqual([[1], [2]]); expect(fake.destroy).toHaveBeenCalledTimes(1)
  const full = await extractPdfMaterial(Uint8Array.of(9), { pages: { from: 2, to: 3 } })
  expect(full.assets.map(asset => asset.id)).toEqual(['page-2.png', 'page-3.png'])
  expect(full.fragments.map(fragment => fragment.id)).toEqual(['fragment-1', 'fragment-2', 'fragment-3', 'fragment-4'])
})
