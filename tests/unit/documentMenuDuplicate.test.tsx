import type { DocumentContent } from '../../src/shared/document/content'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { SharedDocumentEditor } from '../../src/renderer/document/SharedDocumentEditor'
import { DOCUMENT_BLOCK_DEFINITION } from '../../src/components/document-block'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { createFlowDocumentResourcePort, prepareFlowDocumentResourceTransaction, releaseFlowPreparedResources } from '../../src/renderer/document/flowDocumentResources'
import { createCourseDocumentClipboardContext, readCourseDocumentClipboardContext } from '../../src/renderer/document/documentClipboardContext'
import { CourseV10DocumentBridge, type CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

it('duplicates a real chapter menu through the clipboard owner with a new formal component and private files in one History', async () => {
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'menu-copy', revision: 0, title: '菜单复制',
    definitions: { [DOCUMENT_BLOCK_DEFINITION.id]: DOCUMENT_BLOCK_DEFINITION,
      custom: { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'files', entry: 'main.js' } } } },
    instances: { chapter: { id: 'chapter', definitionId: DOCUMENT_BLOCK_DEFINITION.id, data: { type: 'section', title: { inlines: [{ type: 'text', text: '章节' }] }, collapsedByDefault: false }, childIds: ['custom'] },
      custom: { id: 'custom', definitionId: 'custom', data: { message: '原互动' } } },
    surfaces: [{ id: 'flow', kind: 'flow', title: '正文', childIds: ['chapter'] }], global: { underlay: [], overlay: [] }, assets: {} }
  const resources = { assets: {}, components: { files: { 'main.js': new TextEncoder().encode("import './part.js'"), 'part.js': new TextEncoder().encode('export default 1') } } }
  const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, editingProject: project, resources, surfaceId: 'flow', activeStateId: null, instanceId: null, instanceIds: [] }
  const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: { kind: 'course-v10', project, resources }, binding: { kind: 'untitled', suggestedName: 'copy.h5lesson' } }, driver, { async append() {}, async save() { throw new Error('uses real Driver below') } })
  const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 600, 400))
  const commit = vi.fn(async (next: ReturnType<typeof projectFlowDocument>, operation: { preparedResourceBatches?: readonly unknown[]; preparedResources?: unknown }) => {
    const planned = prepareFlowDocumentResourceTransaction(target, 'flow', next.content.blocks, operation.preparedResourceBatches ?? [operation.preparedResources])
    const { documentId: _documentId, epoch: _epoch, ...command } = new CourseV10DocumentBridge().capture(planned.edits, planned.target)
    const result = await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'menu-duplicate', baseRevision: 0, actor: 'human', mutation: { type: 'command', command } })
    if (result.status !== 'applied') throw new Error('menu copy rejected')
    releaseFlowPreparedResources(planned.prepared)
    return true
  })
  const ui = render(<SharedDocumentEditor document={projectFlowDocument(project, 'flow')} revision="0" target="flow"
    clipboardContext={(_references: unknown, content: DocumentContent) => createCourseDocumentClipboardContext({ documentId: 'doc', project, resources, roots: content.blocks.map(block => block.id) })}
    clipboardResourcePort={context => createFlowDocumentResourcePort({ target, source: readCourseDocumentClipboardContext(context) })}
    renderObject={(_block, host) => { host.textContent = '互动对象' }} onChange={commit} onDraft={() => {}} onUndo={() => {}} onRedo={() => {}} />)
  try {
    fireEvent.contextMenu(ui.container.querySelector('summary')!, { clientX: 100, clientY: 100 })
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '复制段落' })))
    await vi.waitFor(() => expect(session.read().undoDepth).toBe(1))
    expect(commit).toHaveBeenCalledOnce()
    const model = session.read().model
    if (model.kind !== 'course-v10') throw new Error('expected V10')
    const duplicateId = model.project.surfaces[0].childIds[1], copied = model.project.instances[duplicateId]
    expect(duplicateId).not.toBe('chapter')
    expect(copied.childIds).toHaveLength(1)
    const custom = model.project.instances[copied.childIds![0]]
    expect(custom.id).not.toBe('custom')
    expect(custom.data).toEqual(project.instances.custom.data)
    const implementation = model.project.definitions[custom.definitionId].implementation
    if (implementation.kind !== 'source' || !implementation.workspace) throw new Error('missing private copy source')
    expect(implementation.workspace.ownerId).not.toBe('files')
    expect(model.resources.components[implementation.workspace.ownerId]).toEqual(resources.components.files)
    expect(model.project.instances.chapter).toEqual(project.instances.chapter)
    expect(model.project.instances.custom).toEqual(project.instances.custom)
    const reopened = driver.load(driver.serialize(model))
    if (reopened.kind !== 'course-v10') throw new Error('expected reopened V10')
    expect(reopened.project).toEqual(model.project)
    expect(Object.keys(reopened.resources.components).sort()).toEqual(Object.keys(model.resources.components).sort())
    for (const [owner, files] of Object.entries(model.resources.components)) {
      expect(Object.keys(reopened.resources.components[owner]).sort()).toEqual(Object.keys(files).sort())
      for (const [path, bytes] of Object.entries(files)) expect(Array.from(reopened.resources.components[owner][path])).toEqual(Array.from(bytes))
    }
  } finally { cleanup(); geometry.mockRestore() }
})
