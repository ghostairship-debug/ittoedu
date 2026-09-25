import { attachMarkdownRendererHost } from '../helpers/markdownRendererHost'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef, StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LessonDocumentEditor, type LessonDocumentEditorHandle } from '../../src/renderer/documentFiles/LessonDocumentEditor'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { OpenDocumentResult } from '../../src/shared/document/ports'

afterEach(cleanup)
describe('LessonDocumentEditor mounted shared core', () => {
  it('opens once through StrictMode replay and releases its watcher on real unmount', async () => {
    const ref = { kind: 'lesson' as const, lessonId: 'lesson', lessonDirectory: '/lesson', relativePath: 'strict.md' }
    const stop = vi.fn()
    const port: RecoverableDocumentFilePort = {
      openDocument: vi.fn(async () => ({ ref, source: '严格模式真实正文', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] })),
      watchDocument: vi.fn(() => stop), saveDocument: vi.fn(), 
    }
    const host = attachMarkdownRendererHost(port, ref)
    const open = vi.spyOn(host.documents, 'open')
    const view = render(<StrictMode><LessonDocumentEditor documentRef={ref} port={port} /></StrictMode>)
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toBe('严格模式真实正文'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(host.listeners.size).toBe(1)
    view.unmount()
    await waitFor(() => expect(host.listeners.size).toBe(0))
  })
  it('renders the real layout editor and explicitly adopts the external conflict', async () => {
    const ref = { kind: 'file' as const, path: '/lesson/plan.md' }
    let disk: OpenDocumentResult = { ref, source: '原稿', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }
    const port: RecoverableDocumentFilePort = {
      openDocument: async () => disk, watchDocument: () => () => {}, saveDocument: vi.fn(), 
    }
    attachMarkdownRendererHost(port, ref)
    const handle = createRef<LessonDocumentEditorHandle>()
    render(<LessonDocumentEditor ref={handle} documentRef={ref} port={port} />)
    await screen.findByRole('button', { name: '源文' })
    await act(async () => {
      handle.current!.session.edit('教师稿')
      await handle.current!.session.drain()
      disk = { ...disk, source: '磁盘稿', version: { contentVersion: 'v2', attachments: [] } }
      expect(await handle.current!.session.flush()).toBe(false)
    })
    fireEvent.click(await screen.findByRole('button', { name: '此处采用磁盘稿' }))
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toBe('磁盘稿'))
    expect(port.saveDocument).not.toHaveBeenCalled()
  })
  it('presents a local conflict choice and saves both independent changes', async () => {
    const ref = { kind: 'file' as const, path: '/lesson/plan.md' }
    let disk: OpenDocumentResult = { ref, source: 'A原始\nB原始\nC原始', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }
    const save = vi.fn<RecoverableDocumentFilePort['saveDocument']>(async request => {
      disk = { ...disk, source: request.source, version: { contentVersion: 'v3', attachments: [] } }
      return { status: 'saved', operationId: request.operationId, version: disk.version }
    })
    const port: RecoverableDocumentFilePort = { openDocument: async () => disk, watchDocument: () => () => {}, saveDocument: save,  }
    attachMarkdownRendererHost(port, ref)
    const handle = createRef<LessonDocumentEditorHandle>()
    render(<LessonDocumentEditor ref={handle} documentRef={ref} port={port} />)
    await screen.findByRole('button', { name: '源文' })
    await act(async () => {
      handle.current!.session.edit('A教师\nB本地\nC原始')
      await handle.current!.session.drain()
      disk = { ...disk, source: 'A磁盘\nB原始\nC外部', version: { contentVersion: 'v2', attachments: [] } }
      expect(await handle.current!.session.flush()).toBe(false)
    })
    fireEvent.click(await screen.findByRole('button', { name: '此处采用磁盘稿' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0]![0].source).toBe('A磁盘\nB本地\nC外部')
    expect(screen.queryByRole('button', { name: '采用磁盘稿' })).not.toBeInTheDocument()
  })
})
