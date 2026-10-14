import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LessonDocumentEditor } from '../../src/renderer/documentFiles/LessonDocumentEditor'
import { WorkspaceDocumentTabs } from '../../src/renderer/lessonWorkspace/view/WorkspaceDocumentTabs'
import { WorkspaceRecoveryPanel } from '../../src/renderer/workbench/WorkspaceRecoveryPanel'
import { attachMarkdownRendererHost } from '../helpers/markdownRendererHost'
import { serializeDocumentMarkdown } from '../../src/shared/document/markdown'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { createChartNode, createChartLayerItem } from '../../src/core/tools/nativeNodeFactories'
afterEach(cleanup)

describe('Audit save view consumers', () => {
  it.each([['content-width', '640px'], ['wide', '960px'], ['full-width', 'none']] as const)('CA309 renders the stored %s media width', async (layout, width) => {
    const ref = { kind: 'file' as const, path: '/lesson/image.md' }
    const port: RecoverableDocumentFilePort = { openDocument: vi.fn(), watchDocument: () => () => {}, saveDocument: vi.fn() }
    const host = attachMarkdownRendererHost(port, ref)
    const source = serializeDocumentMarkdown({ content: { blocks: [{ id: 'picture', type: 'media', assetId: 'hero', mediaKind: 'image', altText: 'width picture', layout }] }, resources: { assets: [{ assetId: 'hero', source: { kind: 'relative', path: 'image.png' } }], components: [] } }, 'file')
    const snapshot = await host.documents.create({ kind: 'markdown', source, resources: { assets: { 'image.png': new Uint8Array([1]) }, components: {} } }, 'image.md')
    render(<LessonDocumentEditor documentRef={ref} documentId={snapshot.documentId} port={port} />)
    const image = await screen.findByRole('img', { name: 'width picture' })
    expect(image.parentElement).toHaveAttribute('data-media-layout', layout)
    expect(image.parentElement?.style.width).toBe('100%')
    expect(image.parentElement?.style.maxWidth).toBe(width)
  })

  it('CA361 paints the formal file chart with real category and value marks', async () => {
    const ref = { kind: 'file' as const, path: '/lesson/chart.md' }
    const port: RecoverableDocumentFilePort = { openDocument: vi.fn(), watchDocument: () => () => {}, saveDocument: vi.fn() }, host = attachMarkdownRendererHost(port, ref)
    const chart = (createChartLayerItem(createChartNode({ title: '成绩', chartType: 'bar' })).content as any).data
    const source = serializeDocumentMarkdown({ content: { blocks: [{ id: 'chart', type: 'chart', chart, height: 320 }] }, resources: { assets: [], components: [] } }, 'file')
    const snapshot = await host.documents.create({ kind: 'markdown', source, resources: { assets: {}, components: {} } }, 'chart.md')
    const view = render(<LessonDocumentEditor documentRef={ref} documentId={snapshot.documentId} port={port} />)
    await waitFor(() => expect(view.container.querySelector('svg[data-native-chart-id="chart"]')).not.toBeNull())
    const painted = view.container.querySelector('svg[data-native-chart-id="chart"]')!
    expect(painted.querySelectorAll('rect').length).toBeGreaterThanOrEqual(3)
    expect(painted.textContent).toContain('类别 1')
  })

  it('CA358/377 refreshes a changed image while retaining the audio DOM and position across unrelated text ACKs', async () => {
    const ref = { kind: 'file' as const, path: '/lesson/media.md' }
    const port: RecoverableDocumentFilePort = { openDocument: vi.fn(), watchDocument: () => () => {}, saveDocument: vi.fn() }, host = attachMarkdownRendererHost(port, ref)
    const source = serializeDocumentMarkdown({ content: { blocks: [
      { id: 'sound', type: 'media', assetId: 'sound', mediaKind: 'audio', layout: 'content-width' },
      { id: 'picture', type: 'media', assetId: 'picture', mediaKind: 'image', altText: 'replace picture', layout: 'content-width' },
    ] }, resources: { assets: [{ assetId: 'sound', source: { kind: 'relative', path: 'sound.ogg' } }, { assetId: 'picture', source: { kind: 'relative', path: 'image.png' } }], components: [] } }, 'file')
    const snapshot = await host.documents.create({ kind: 'markdown', source, resources: { assets: { 'sound.ogg': new Uint8Array([1]), 'image.png': new Uint8Array([2]) }, components: {} } }, 'media.md')
    const view = render(<LessonDocumentEditor documentRef={ref} documentId={snapshot.documentId} port={port} />)
    await screen.findByRole('img', { name: 'replace picture' })
    const audio = view.container.querySelector('audio')!; expect(audio).not.toBeNull(); audio.currentTime = 7
    const image = view.container.querySelector('img')!, originalUrl = image.src
    const change = async (nextSource: string, resources: DocumentSnapshot['model']['resources']) => {
      const current = await host.documents.read(snapshot.documentId)
      await act(async () => { await host.documents.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
        operationId: crypto.randomUUID(), requestDigest: crypto.randomUUID(), actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: nextSource, resources } } }) })
    }
    await change(`${source}\n\n文字补充`, snapshot.model.resources)
    await waitFor(() => expect(view.container.textContent).toContain('文字补充'))
    expect(view.container.querySelector('audio')).toBe(audio); expect(audio.currentTime).toBe(7); expect(view.container.querySelector('img')).toBe(image)
    await change(`${source}\n\n文字补充`, { assets: { 'sound.ogg': new Uint8Array([1]), 'image.png': new Uint8Array([3]) }, components: {} })
    await waitFor(() => expect(view.container.querySelector('img')?.src).not.toBe(originalUrl))
    expect(view.container.querySelector('audio')).toBe(audio); expect(audio.currentTime).toBe(7)
  })

  it('CA048 media tab reveal uses its authorized workspace file entry', async () => {
    const calls: unknown[] = []
    const workspaceFiles = vi.fn(async (input: any) => {
      calls.push(input)
      if (input.type === 'root') return { workspaceId: 'w', rootEntryId: 'root', resolvedPath: 'C:/workspace' }
      if (input.type === 'list') return { entries: [{ status: 'accessible', name: 'picture.png', kind: 'file', entryId: 'picture' }] }
      return { status: 'success', items: [] }
    })
    const run = vi.fn(async (work: () => Promise<void>) => work())
    const props = { workspaceFiles, state: { workspace: 'C:/workspace', lesson: null, standalone: true }, documentPort: {},
      actions: { run, setMobilePane: vi.fn(), refreshTree: vi.fn() }, tabs: { tabs: [{ id: 'media', path: 'C:/workspace/picture.png', name: 'picture.png', kind: 'media', dirty: false, lesson: null }], activeTab: 'media', setActiveTab: vi.fn(), closeTab: vi.fn() }, operation: vi.fn() }
    render(<WorkspaceDocumentTabs props={props as any} layout={{ setContentClosed: vi.fn() } as any} />)
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'picture.png' }), { clientX: 12, clientY: 12 })
    fireEvent.click(await screen.findByRole('menuitem', { name: '在资源管理器中显示' }))
    await waitFor(() => expect(calls).toContainEqual({ type: 'reveal', workspaceId: 'w', entryId: 'picture', operationId: expect.any(String) }))
  })

  it('CA372 the unavailable row offers explicit saved opening and keeps the damaged record out of discard-all', async () => {
    const snapshot: DocumentSnapshot = { documentId: 'broken', epoch: 'epoch', revision: 0, binding: { kind: 'file', path: '/lesson/healthy.txt', version: 'disk', bindingVersion: 1 },
      model: { kind: 'text', source: 'healthy', resources: { assets: {}, components: {} } }, dirty: false, saving: false, recoverable: false, recoveryUnavailable: '恢复记录损坏，已保存原文件可用', undoDepth: 0, redoDepth: 0 }
    const restored = { ...snapshot, documentId: 'new-live', recoveryUnavailable: undefined }
    const api = { recoverable: vi.fn(async () => [snapshot]), restore: vi.fn(async () => restored), discardRecovery: vi.fn(async () => {}), subscribe: vi.fn(() => () => {}) }, onRestored = vi.fn(async () => {})
    render(<WorkspaceRecoveryPanel api={api} onRestored={onRestored} />)
    fireEvent.click(await screen.findByRole('button', { name: '恢复稿（1）' }))
    expect(screen.getByRole('button', { name: '丢弃全部恢复稿' })).toBeDisabled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保留损坏记录后打开已保存稿' })) })
    expect(api.restore).toHaveBeenCalledWith('broken', 'saved')
    expect(onRestored).toHaveBeenCalledWith('new-live')
    expect(api.discardRecovery).not.toHaveBeenCalled()
  })
})
