// @vitest-environment node
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'
import { operateLessonMaterial } from '../../src/main/lessonMaterialDesktopService'
const extraction = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => 'user-data' } }))
vi.mock('../../src/main/lessonWorkspace', () => ({ LessonWorkspaceService: class { async read() {} } }))
vi.mock('../../src/main/workbench/attachments/attachmentsDesktopService', () => ({ attachmentsDesktopService: async () => ({ extractOffice: extraction.run }) }))
const windowFor = (id: number) => ({ webContents: Object.assign(new EventEmitter(), { id, isDestroyed: () => false }) }) as unknown as BrowserWindow

it('passes the Office request into the existing disposable extractor and cancels only its sender/request', async () => {
  let signal!: AbortSignal
  extraction.run.mockImplementation((_input, options: { signal: AbortSignal; onProgress(page: number, total: number): void }) => {
    signal = options.signal; options.onProgress(1, 4)
    return new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const window = windowFor(231), requestId = randomUUID(), progress = vi.fn()
  const pending = operateLessonMaterial(window, { operation: 'extract-office', input: { requestId, title: '教材.docx', original: Uint8Array.of(1) } }, progress)
  const failure = expect(pending).rejects.toThrow('取消')
  await vi.waitFor(() => expect(progress).toHaveBeenCalledWith({ requestId, page: 1, total: 4 }))
  expect(extraction.run.mock.calls[0]![0]).toEqual({ filename: '教材.docx', bytes: Uint8Array.of(1) })
  await operateLessonMaterial(windowFor(232), { operation: 'cancel-import', requestId })
  expect(signal.aborted).toBe(false)
  await operateLessonMaterial(window, { operation: 'cancel-import', requestId })
  await failure
  expect(signal.aborted).toBe(true)
  expect(window.webContents.listenerCount('destroyed')).toBe(0)
})
