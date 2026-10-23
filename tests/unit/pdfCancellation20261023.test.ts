import { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const carrier = vi.hoisted(() => ({
  stage: 'ready' as 'load' | 'ready' | 'print' | 'complete',
  waiting: false,
  windows: [] as Array<{ filename?: string; destroyed: boolean; prints: number }>,
  order: [] as string[],
}))
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  BrowserWindow: class {
    state = { filename: undefined as string | undefined, destroyed: false, prints: 0 }
    constructor() { carrier.windows.push(this.state) }
    webContents = {
      executeJavaScript: async () => {
        if (carrier.stage === 'ready') { carrier.waiting = true; return new Promise(() => {}) }
        return { imageCount: 0, loadedImageCount: 0, pageCount: 1 }
      },
      printToPDF: async () => {
        this.state.prints++
        if (carrier.stage === 'print') { carrier.waiting = true; return new Promise<Buffer>(() => {}) }
        return Buffer.from('pdf-carrier-bytes')
      },
    }
    async loadFile(filename: string) {
      this.state.filename = filename
      if (carrier.stage === 'load') { carrier.waiting = true; return new Promise<void>(() => {}) }
    }
    isDestroyed() { return this.state.destroyed }
    destroy() { this.state.destroyed = true }
  },
}))
vi.mock('../../src/main/fileDialogs', () => ({ writeBinaryExportFile: vi.fn(async () => { carrier.order.push('write'); return { path: 'saved.pdf' } }) }))
import { exportPdfFromHtml, renderPdfFromHtml } from '../../src/main/pdfExport'
import { writeBinaryExportFile } from '../../src/main/fileDialogs'
import { exportPdfWithSignal } from '../../src/renderer/export/pdfExportClient'

beforeEach(() => { carrier.waiting = false; carrier.windows.length = 0; carrier.order.length = 0; vi.clearAllMocks() })

describe('PDF cancellation follows the actual hidden print window', () => {
  it.each(['load', 'ready', 'print'] as const)('ends %s waiting and removes its own temporary document without starting save', async stage => {
    carrier.stage = stage
    const controller = new AbortController()
    const pending = exportPdfFromHtml({} as never, 'sample', '<main class="page">sample</main>', undefined, { signal: controller.signal })
    const outcome = expect(pending).resolves.toBeNull()
    await vi.waitFor(() => expect(carrier.waiting).toBe(true))
    controller.abort(new Error('cancel this print'))
    await outcome
    expect(carrier.windows).toHaveLength(1)
    expect(carrier.windows[0]!.destroyed).toBe(true)
    await expect(access(carrier.windows[0]!.filename!)).rejects.toThrow()
    expect(writeBinaryExportFile).not.toHaveBeenCalled()
  })

  it('does no work for an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort(new Error('cancelled before print'))
    await expect(renderPdfFromHtml('unused', undefined, controller.signal)).rejects.toThrow('cancelled before print')
    expect(carrier.windows).toHaveLength(0)
  })

  it('preserves the real atomic writer failure when cancellation arrives after writing starts', async () => {
    carrier.stage = 'complete'
    const controller = new AbortController()
    const writeError = Object.assign(new Error('真正的写盘失败'), { code: 'BINARY_EXPORT_FAILED' })
    vi.mocked(writeBinaryExportFile).mockImplementationOnce(async () => {
      controller.abort(new Error('late cancel'))
      throw writeError
    })
    await expect(exportPdfFromHtml({} as never, 'sample', '<main class="page">sample</main>', undefined,
      { signal: controller.signal })).rejects.toBe(writeError)
    expect(writeBinaryExportFile).toHaveBeenCalledOnce()
  })

  it('preserves an actual published path when cancellation arrives during the atomic writer', async () => {
    carrier.stage = 'complete'
    const controller = new AbortController()
    vi.mocked(writeBinaryExportFile).mockImplementationOnce(async () => {
      controller.abort(new Error('late cancel'))
      return { path: 'actual.pdf' }
    })
    await expect(exportPdfFromHtml({} as never, 'sample', '<main class="page">sample</main>', undefined,
      { signal: controller.signal })).resolves.toEqual({ path: 'actual.pdf' })
  })
})

describe('renderer PDF request keeps cancellation local and reports real publication', () => {
  it('uses its request identity for cancel and only reports saving when Main is prepared', async () => {
    const controller = new AbortController()
    let prepared: ((event: { requestId: string }) => void) | undefined
    let input: { requestId?: string } | undefined
    let finish!: (value: { path: string } | null) => void
    const cancel = vi.fn(async () => true), saving = vi.fn(), stop = vi.fn()
    const result = exportPdfWithSignal({
      onPdfExportPrepared: listener => { prepared = listener; return stop }, cancelPdfExport: cancel,
      exportPdf: async value => { input = value; return new Promise(resolve => { finish = resolve }) },
    }, { suggestedName: 'sample', html: '<p>sample</p>' }, { signal: controller.signal, onSaving: saving })
    expect(saving).not.toHaveBeenCalled()
    prepared?.({ requestId: 'another-job' }); expect(saving).not.toHaveBeenCalled()
    prepared?.({ requestId: input!.requestId! }); expect(saving).toHaveBeenCalledOnce()
    controller.abort()
    expect(cancel).toHaveBeenCalledWith({ requestId: input!.requestId })
    // Main may already have entered atomic publication. Its successful result is authoritative.
    finish({ path: 'saved.pdf' })
    await expect(result).resolves.toEqual({ path: 'saved.pdf' })
    expect(stop).toHaveBeenCalledOnce()
  })
})
