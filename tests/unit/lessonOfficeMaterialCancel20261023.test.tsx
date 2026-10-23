import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LessonMaterialBrowser } from '../../src/renderer/lessonMaterials/LessonMaterialBrowser'
import { extractMaterial } from '../../src/renderer/project/materialExtraction'
import { extractLessonMaterialOffice } from '../../src/renderer/lessonMaterials/lessonMaterialPdfImport'
import type { LessonMaterialDesktopAPI } from '../../src/shared/lessonMaterialDesktop'

vi.mock('../../src/renderer/project/materialExtraction', () => ({ extractMaterial: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const material = { version: 1 as const, extractorVersion: 'material-3', format: 'docx' as const, fragments: [], assets: [], gaps: [] }
const browserProps = () => ({ targetKey: 'lesson-one', selectSource: vi.fn(async () => ({ sources: [{ title: '教材.docx', bytes: Uint8Array.of(1) }], failures: [] })),
  list: vi.fn(async () => ({ records: [], diagnostics: [] })), importMaterial: vi.fn(), read: vi.fn() })

it('runs Office parsing outside the UI and aborts that job without publishing a cancelled result', async () => {
  let signal!: AbortSignal
  const extractOffice = vi.fn((_input, options: { signal: AbortSignal; onProgress(page: number, total: number): void }) => {
    signal = options.signal; options.onProgress(1, 4)
    return new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const initial = browserProps()
  render(<LessonMaterialBrowser {...initial} extractOffice={extractOffice} />)
  fireEvent.click(screen.getByRole('button', { name: /添加材料/ }))
  await screen.findByText('教材.docx：第 1 / 4 页')
  expect(extractMaterial).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '取消导入' }))
  expect(signal.aborted).toBe(true)
  expect(await screen.findByRole('alert')).toHaveTextContent('材料导入已取消')
  expect(initial.importMaterial).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole('button', { name: /添加材料/ })).not.toBeDisabled())
})

it('does not import Office output into either lesson when the original lesson changes during extraction', async () => {
  let finish!: () => void, signal!: AbortSignal
  const extractOffice = vi.fn((_input, options: { signal: AbortSignal }) => {
    signal = options.signal
    return new Promise<typeof material>(resolve => { finish = () => resolve(material) })
  })
  const initial = browserProps(), view = render(<LessonMaterialBrowser {...initial} extractOffice={extractOffice} />)
  fireEvent.click(screen.getByRole('button', { name: /添加材料/ }))
  await waitFor(() => expect(extractOffice).toHaveBeenCalledOnce())
  const next = browserProps()
  view.rerender(<LessonMaterialBrowser {...next} targetKey="lesson-two" extractOffice={extractOffice} />)
  expect(signal.aborted).toBe(true)
  finish()
  await waitFor(() => expect(screen.getByRole('button', { name: /添加材料/ })).not.toBeDisabled())
  expect(initial.importMaterial).not.toHaveBeenCalled()
  expect(next.importMaterial).not.toHaveBeenCalled()
})

it('cancels only the original desktop request and rejects its late successful extraction', async () => {
  let finish!: () => void
  const stop = vi.fn(), api = { subscribeImportProgress: vi.fn(() => stop), cancelImport: vi.fn(async () => {}),
    extractOffice: vi.fn(() => new Promise<typeof material>(resolve => { finish = () => resolve(material) })) } as unknown as LessonMaterialDesktopAPI
  const controller = new AbortController()
  const pending = extractLessonMaterialOffice(api, { title: '教材.docx', original: Uint8Array.of(1) }, { signal: controller.signal, onProgress: vi.fn() })
  const failure = expect(pending).rejects.toThrow('已取消')
  const request = vi.mocked(api.extractOffice).mock.calls[0]![0]
  controller.abort(new Error('已取消'))
  expect(api.cancelImport).toHaveBeenCalledWith(request.requestId)
  finish(); await failure
  expect(stop).toHaveBeenCalledOnce()
})
