import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef, StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LessonDocumentEditor, type LessonDocumentEditorHandle } from '../../src/renderer/documentFiles/LessonDocumentEditor'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { OpenDocumentResult } from '../../src/shared/document/ports'

afterEach(cleanup)
describe('LessonDocumentEditor mounted shared core', () => {
  it('renders retained AI conflict and applies the explicit local choice without losing other teacher edits', async () => {
    const ref = { lessonId: 'lesson', lessonDirectory: '/lesson', relativePath: 'suggestion.md' }
    let disk: OpenDocumentResult = { ref, source: 'A原稿\nB原稿', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }
    const baseline = disk
    const edit = { from: 0, to: 3, before: 'A原稿', after: 'A建议' }
    const port: RecoverableDocumentFilePort = {
      openDocument: async () => disk, watchDocument: () => () => {},
      saveDocument: async request => { disk = { ...disk, source: request.source, version: { contentVersion: request.source, attachments: [] } }; return { status: 'saved', operationId: request.operationId, version: disk.version } },
      prepareAiEdit: async (_ref, ranges, epoch) => ({ status: 'ready', document: baseline, ranges, epoch }),
      applyAiEdit: async () => ({ status: 'conflict', conflicts: [edit] }), revertAiEdit: vi.fn(),
    }
    const handle = createRef<LessonDocumentEditorHandle>()
    render(<LessonDocumentEditor ref={handle} documentRef={ref} port={port} />)
    await screen.findByRole('button', { name: '源文' })
    await act(async () => {
      await handle.current!.session.prepareAiEdit([{ from: 0, to: baseline.source.length, before: baseline.source, after: baseline.source }], 1)
      handle.current!.session.edit('A教师\nB手改'); await handle.current!.session.flush()
      await handle.current!.session.applyAiEdit({ baseVersion: baseline.version, epoch: 1, operationId: 'ai', edits: [edit] })
    })
    fireEvent.click(await screen.findByRole('button', { name: '此处采用 AI 建议' }))
    fireEvent.click(screen.getByRole('button', { name: '保存此处合并' }))
    await waitFor(() => expect(disk.source).toBe('A建议\nB手改'))
    await waitFor(() => expect(screen.queryByText('AI 冲突建议')).not.toBeInTheDocument())
  })
  it('opens once through StrictMode replay and releases its watcher on real unmount', async () => {
    const ref = { lessonId: 'lesson', lessonDirectory: '/lesson', relativePath: 'strict.md' }
    const stop = vi.fn()
    const port: RecoverableDocumentFilePort = {
      openDocument: vi.fn(async () => ({ ref, source: '严格模式真实正文', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] })),
      watchDocument: vi.fn(() => stop), saveDocument: vi.fn(), prepareAiEdit: vi.fn(), applyAiEdit: vi.fn(), revertAiEdit: vi.fn(),
    }
    const view = render(<StrictMode><LessonDocumentEditor documentRef={ref} port={port} /></StrictMode>)
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toBe('严格模式真实正文'))
    expect(port.openDocument).toHaveBeenCalledTimes(1)
    expect(stop).not.toHaveBeenCalled()
    view.unmount()
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
  })
  it('renders the real layout editor and preserves both sides of an external conflict', async () => {
    const ref = { lessonId: 'lesson', lessonDirectory: '/lesson', relativePath: 'plan.md' }
    const disk: OpenDocumentResult = { ref, source: '原稿', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }
    const port: RecoverableDocumentFilePort = {
      openDocument: async () => disk,
      readRecovery: async () => ({ source: '恢复稿', expectedVersion: { contentVersion: 'v0', attachments: [] } }),
      watchDocument: () => () => {}, saveDocument: vi.fn(), prepareAiEdit: vi.fn(), applyAiEdit: vi.fn(), revertAiEdit: vi.fn(),
    }
    render(<LessonDocumentEditor documentRef={ref} port={port} />)
    await screen.findByText('已找到未保存恢复稿，请比较后继续。')
    expect(screen.getByRole('button', { name: '源文' })).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toBe('恢复稿'))
    fireEvent.click(screen.getByRole('button', { name: '采用磁盘稿' }))
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toBe('原稿'))
    expect(port.saveDocument).not.toHaveBeenCalled()
  })
  it('presents a local conflict choice and saves both independent changes', async () => {
    const ref = { lessonId: 'lesson', lessonDirectory: '/lesson', relativePath: 'plan.md' }
    const disk: OpenDocumentResult = { ref, source: 'A磁盘\nB原始\nC外部', version: { contentVersion: 'v2', attachments: [] }, diagnostics: [] }
    const save = vi.fn<RecoverableDocumentFilePort['saveDocument']>(async request => ({ status: 'saved', operationId: request.operationId, version: { contentVersion: 'v3', attachments: [] } }))
    const port: RecoverableDocumentFilePort = {
      openDocument: async () => disk, readRecovery: async () => ({ source: 'A教师\nB本地\nC原始', baseSource: 'A原始\nB原始\nC原始', expectedVersion: { contentVersion: 'v1', attachments: [] } }), preserveDraft: async () => {},
      watchDocument: () => () => {}, saveDocument: save, prepareAiEdit: vi.fn(), applyAiEdit: vi.fn(), revertAiEdit: vi.fn(),
    }
    render(<LessonDocumentEditor documentRef={ref} port={port} />)
    fireEvent.click(await screen.findByRole('button', { name: '此处采用磁盘稿' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0]![0].source).toBe('A磁盘\nB本地\nC外部')
    expect(screen.queryByRole('button', { name: '采用磁盘稿' })).not.toBeInTheDocument()
  })
})
