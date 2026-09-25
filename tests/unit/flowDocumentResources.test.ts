import { describe, expect, it } from 'vitest'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { createFlowDocumentResourcePort, prepareFlowDocumentResourceTransaction } from '@/renderer/document/flowDocumentResources'
import { createFileDocumentResourcePort } from '@/renderer/document/fileDocumentResources'
import { prepareDocumentClipboard } from '@/renderer/document/documentClipboard'
import { applyEditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { emptyDocumentResources } from '@/shared/document/resources'
import { parseDocumentMarkdown, serializeDocumentMarkdown } from '@/shared/document/markdown'
import type { DocumentContent } from '@/shared/document/content'

const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='), c => c.charCodeAt(0))
const meta = { id: 'image', filename: 'figure.png', mimeType: 'image/png', kind: 'image' as const, path: 'assets/image.png', byteLength: bytes.length }
const content: DocumentContent = { blocks: [{ id: 'heading', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: '图示' }] } }, { id: 'media', type: 'media', mediaKind: 'image', assetId: 'image', layout: 'content-width' }] }
const resources = { assets: [{ assetId: 'image', source: { kind: 'project' as const } }], components: [] }
const noComponent = async (): Promise<never> => { throw new Error('Unexpected component') }

describe('document resource owner preparation', () => {
  it('roundtrips Flow image through file Markdown and into one archive/body/resource transaction', async () => {
    const file = await prepareDocumentClipboard({ content, resources }, emptyDocumentResources(), createFileDocumentResourcePort({ resolveAsset: async () => ({ meta, bytes }), resolveComponent: noComponent }))
    const markdown = serializeDocumentMarkdown(file.document, 'file')
    const parsed = parseDocumentMarkdown(markdown, { target: 'file', createId: () => crypto.randomUUID() })
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') throw new Error(parsed.diagnostics[0]?.message)
    const target = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
    const port = createFlowDocumentResourcePort({ target, resolveAsset: async ref => {
      if (ref.source.kind !== 'relative') throw new Error('Expected relative resource')
      const path = ref.source.path
      const attachment = file.prepared.attachments.find(item => item.relativePath === path)
      if (!attachment) throw new Error('Missing prepared attachment')
      return { meta, bytes: attachment.bytes }
    }, prepareComponent: noComponent })
    const flow = await prepareDocumentClipboard(parsed.document, emptyDocumentResources(), port)
    expect(target.assets).toEqual({})
    const planned = prepareFlowDocumentResourceTransaction(target, target.surfaces[0]!.id, flow.document.content.blocks, flow.prepared)
    expect(planned.result.ok).toBe(true)
    expect(planned.step).not.toBeNull()
    const initial = { document: target, resources: { assetFiles: {}, componentPackages: {} } }
    const applied = applyEditorTransactionStep(initial, planned.step!, 'forward')
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: applied.document, assetFiles: { ...applied.resources.assetFiles }, componentFiles: {} }))
    const assetId = flow.document.resources.assets[0]!.assetId
    expect(reopened.assetFiles[assetId]).toEqual(bytes)
    expect(reopened.project.surfaces[0]).toMatchObject({ blocks: [{ type: 'heading' }, { type: 'media', assetId }] })
    const undone = applyEditorTransactionStep(applied, planned.step!, 'inverse')
    expect(undone.document).toEqual(target)
    expect(undone.resources.assetFiles).toEqual({})
    expect(applyEditorTransactionStep(undone, planned.step!, 'forward').resources.assetFiles[assetId]).toEqual(bytes)
  })
  it('rejects a discarded handle and a changed target without resource writes', async () => {
    const target = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
    const port = createFlowDocumentResourcePort({ target, resolveAsset: async () => ({ meta, bytes }), prepareComponent: noComponent })
    const flow = await prepareDocumentClipboard({ content, resources }, emptyDocumentResources(), port)
    expect(prepareFlowDocumentResourceTransaction({ ...target, revision: target.revision + 1 }, target.surfaces[0]!.id, flow.document.content.blocks, flow.prepared).result.ok).toBe(false)
    await port.discard(flow.prepared)
    expect(prepareFlowDocumentResourceTransaction(target, target.surfaces[0]!.id, flow.document.content.blocks, flow.prepared).result.ok).toBe(false)
    expect(target.assets).toEqual({})
  })
})
