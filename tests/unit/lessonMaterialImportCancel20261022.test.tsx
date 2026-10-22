import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LessonMaterialBrowser, type LessonMaterialBrowserProps } from '../../src/renderer/lessonMaterials/LessonMaterialBrowser'
import { extractMaterial } from '../../src/renderer/project/materialExtraction'
vi.mock('../../src/renderer/project/materialExtraction', () => ({ extractMaterial: vi.fn() }))
afterEach(cleanup)
const props = () => ({ targetKey: 'one', selectSource: vi.fn(async () => ({ sources: [{ title: '教材.pdf', bytes: Uint8Array.of(1) }], failures: [] })),
  list: vi.fn(async () => ({ records: [], diagnostics: [] })), importMaterial: vi.fn(), read: vi.fn() })
it('routes PDFs with the selected range through the cancellable port and really aborts on target switch', async () => {
  let signal!: AbortSignal
  const importPdf = vi.fn<NonNullable<LessonMaterialBrowserProps['importPdf']>>((_input, options) => { signal = options.signal; options.onProgress(4, 12); return new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('取消')), { once: true })) })
  const initial = props(), view = render(<LessonMaterialBrowser {...initial} importPdf={importPdf} />)
  fireEvent.change(screen.getByLabelText('PDF 起始页'), { target: { value: '4' } }); fireEvent.change(screen.getByLabelText('PDF 结束页'), { target: { value: '6' } })
  fireEvent.click(screen.getByRole('button', { name: /添加材料/ }))
  await screen.findByText('教材.pdf：第 4 / 12 页')
  expect(importPdf.mock.calls[0]![0]).toMatchObject({ pages: { from: 4, to: 6 } }); expect(extractMaterial).not.toHaveBeenCalled()
  view.rerender(<LessonMaterialBrowser {...props()} targetKey="two" importPdf={importPdf} />)
  expect(signal.aborted).toBe(true)
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(initial.importMaterial).not.toHaveBeenCalled()
})
it('the cancel control aborts the pending import while leaving the browser usable', async () => {
  const initial = props(), importPdf = vi.fn<NonNullable<LessonMaterialBrowserProps['importPdf']>>((_input, options) => new Promise<never>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('取消')), { once: true })))
  render(<LessonMaterialBrowser {...initial} importPdf={importPdf} />)
  fireEvent.click(screen.getByRole('button', { name: /添加材料/ }))
  await waitFor(() => expect(importPdf).toHaveBeenCalledTimes(1))
  fireEvent.click(await screen.findByRole('button', { name: '取消导入' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('材料导入已取消')
  await waitFor(() => expect(screen.getByRole('button', { name: /添加材料/ })).not.toBeDisabled())
})
