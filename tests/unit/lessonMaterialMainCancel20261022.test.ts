// @vitest-environment node
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'
import { operateLessonMaterial } from '../../src/main/lessonMaterialDesktopService'
import type { PdfPageSinkOptions } from '../../src/shared/workbench/attachments'
const extraction = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => 'user-data' } }))
vi.mock('../../src/main/lessonWorkspace', () => ({ LessonWorkspaceService: class { async read() {} } }))
vi.mock('../../src/main/workbench/attachments/attachmentsDesktopService', () => ({ attachmentsDesktopService: async () => ({ streamPdfPages: extraction.run }) }))
const windowFor = (id: number) => ({ webContents: Object.assign(new EventEmitter(), { id, isDestroyed: () => false }) }) as unknown as BrowserWindow
it('keeps Main cancellation scoped to sender/request and publishes nothing after cancelling a queued PDF page stream', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'material-main-')), target = { lessonId: randomUUID(), rootPath: root }, requestId = randomUUID(), window = windowFor(31)
  let captured!: PdfPageSinkOptions
  extraction.run.mockImplementation(async (_input, options: PdfPageSinkOptions) => {
    captured = options
    await options.onPage({ page: 1, total: 2, material: { version: 1, extractorVersion: 'material-3', format: 'pdf', fragments: [{ id: 'f1', kind: 'text', locator: { part: 'document.pdf', page: 1 }, text: 'first' }], assets: [], gaps: [] } })
    options.onProgress?.(1, 2)
    await new Promise<void>((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true }))
  })
  try {
    const progress = vi.fn(), pending = operateLessonMaterial(window, { operation: 'import-pdf', target, input: { requestId, title: '教材.pdf', original: Uint8Array.of(1), pages: { from: 1, to: 2 } } }, progress)
    const rejection = expect(pending).rejects.toThrow('取消')
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith({ requestId, page: 1, total: 2 }))
    await operateLessonMaterial(windowFor(32), { operation: 'cancel-import', requestId })
    expect(captured.signal!.aborted).toBe(false)
    await operateLessonMaterial(window, { operation: 'cancel-import', requestId })
    await rejection
    expect(captured.signal!.aborted).toBe(true)
    expect(await fs.readdir(path.join(root, 'materials'))).toEqual([])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
