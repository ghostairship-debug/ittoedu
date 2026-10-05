import { tmpdir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

const carrier = vi.hoisted(() => ({ print: vi.fn(async () => Buffer.from('pdf-carrier-bytes')), destroyed: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  BrowserWindow: class {
    dom?: Document
    webContents = {
      executeJavaScript: async (source: string) => new Function('document', `return (${source})`)(this.dom),
      printToPDF: carrier.print,
    }
    async loadFile(path: string) {
      this.dom = new DOMParser().parseFromString(await readFile(path, 'utf8'), 'text/html')
      // jsdom does not load images. Model Chromium's settled decode failure.
      for (const image of this.dom.images) Object.defineProperty(image, 'complete', { value: true })
    }
    isDestroyed() { return false }
    destroy = carrier.destroyed
  },
}))
vi.mock('../../src/main/fileDialogs', () => ({ writeBinaryExportFile: vi.fn() }))
import { renderPdfFromHtml } from '../../src/main/pdfExport'

describe('X4 Main print readiness', () => {
  it('allows semantic Flow with no captures and still rejects undecodable captured images', async () => {
    const bytes = await renderPdfFromHtml('<!doctype html><main data-component-print-surface="flow"><p>Semantic Flow</p></main>')
    expect(new TextDecoder().decode(bytes)).toBe('pdf-carrier-bytes')
    expect(carrier.print).toHaveBeenCalledWith(expect.objectContaining({ preferCSSPageSize: true, printBackground: true }))
    const prints = carrier.print.mock.calls.length
    await expect(renderPdfFromHtml('<section class="page"><img src="data:image/png;base64,invalid"></section>')).rejects.toThrow('图片解码失败')
    expect(carrier.print.mock.calls.length).toBe(prints)
    expect(carrier.destroyed).toHaveBeenCalledTimes(2)
  })
})
