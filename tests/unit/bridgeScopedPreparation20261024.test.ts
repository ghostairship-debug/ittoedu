// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import * as contexts from '../../src/renderer/documents/containerEditingContext'
import { jsonValueSchema } from '../../src/shared/contracts/component-platform/schema'

afterEach(() => vi.restoreAllMocks())
function project(title: string) {
  const value = createBlankCourseProjectV10(title)
  value.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  value.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: jsonValueSchema.parse(createTextComponentData('base')) }
  const root = value.instances[value.rootIds[0]]
  root.childIds = ['body']
  root.container!.presentation = { states: [
    { id: 'base', title: 'Base', order: ['body'], overrides: {} },
    { id: 'detail', title: 'Detail', order: ['body'], overrides: { body: { data: jsonValueSchema.parse(createTextComponentData('detail')) } } },
  ] }
  return value
}

it('prepares only the changed document while retaining unrelated document and view projections', async () => {
  const a = project('A'), b = project('B'), h = await createV10StoreHost(a)
  try {
    const second = await h.api.create({ kind: 'course-v10', project: b, resources: { assets: {}, components: {} } }, 'B.glx')
    await h.bridge.activate(second.documentId)
    await h.bridge.activate(h.first.documentId)
    const before = h.bridge.read(), normalized = vi.spyOn(contexts, 'normalizeEditingContext')
    await h.bridge.edit([{ type: 'data.set', instanceId: 'body', path: ['content'], value: { inlines: [{ type: 'text', text: 'A changed' }] } }])
    const unrelatedPreparations = normalized.mock.calls.filter(([value]) => value.rootIds[0] === b.rootIds[0]).length
    console.info('BRIDGE_PREPARATION', JSON.stringify({ normalizedCalls: normalized.mock.calls.length, unrelatedPreparations }))
    expect(unrelatedPreparations).toBe(0)
    expect(h.bridge.read().views.find(view => view.documentId === second.documentId)).toBe(before.views.find(view => view.documentId === second.documentId))
    expect(h.bridge.read().documents.find(doc => doc.documentId === second.documentId)).toBe(before.documents.find(doc => doc.documentId === second.documentId))
    expect(h.bridge.read().pending).toBe(0)
    expect(JSON.stringify(h.bridge.read().project)).toContain('A changed')
    normalized.mockClear()
    await h.bridge.save()
    expect(normalized.mock.calls.some(([value]) => value.rootIds[0] === b.rootIds[0])).toBe(false)
  } finally { h.bridge.dispose() }
})

it('reuses named-state editing content for pure selection but refreshes it for an actual state change', async () => {
  const h = await createV10StoreHost(project('State'))
  try {
    h.bridge.selectPresentationState(h.first.documentId, 'detail')
    const editing = h.bridge.read().editingProject
    h.bridge.select('body')
    expect(h.bridge.read().editingProject).toBe(editing)
    h.bridge.select(null)
    expect(h.bridge.read().editingProject).toBe(editing)
    h.bridge.selectPresentationState(h.first.documentId, 'base')
    expect(h.bridge.read().editingProject).not.toBe(editing)
    expect(JSON.stringify(h.bridge.read().editingProject!.instances.body.data)).toContain('base')
    expect(JSON.stringify(h.bridge.read().project!.instances.body.data)).toContain('base')
  } finally { h.bridge.dispose() }
})

it('propagates composition, pending, save metadata and late ACK without changing the active document', async () => {
  const h = await createV10StoreHost(project('Input'))
  try {
    const a = h.first.documentId, second = await h.api.create({ kind: 'course-v10', project: project('Other'), resources: { assets: {}, components: {} } }, 'other.glx')
    await h.bridge.activate(second.documentId); await h.bridge.activate(a)
    h.bridge.beginComposition('body', ['content'], a)
    expect(h.bridge.read().pending).toBe(1)
    const before = deferred(), entered = deferred()
    h.controls.before = async () => { entered.resolve(); await before.promise }
    await h.bridge.updateComposition({ inlines: [{ type: 'text', text: 'kept input' }] }, a)
    const finish = h.bridge.endComposition(a)
    await entered.promise
    expect(h.bridge.read().pending).toBeGreaterThan(0)
    await h.bridge.activate(second.documentId)
    const foreground = h.bridge.read().project
    before.resolve(); await finish
    expect(h.bridge.read().activeDocumentId).toBe(second.documentId)
    expect(h.bridge.read().project).toBe(foreground)
    expect(h.bridge.read().pending).toBe(0)
    expect(JSON.stringify(h.bridge.read().views.find(view => view.documentId === a)!.model)).toContain('kept input')
    await h.bridge.activate(a)
    await h.api.save(a, 'input.glx')
    expect(h.bridge.read().snapshot!.binding).toMatchObject({ kind: 'file', path: 'input.glx' })
    expect(h.bridge.read().snapshot!.dirty).toBe(false)
    await h.bridge.undo(a)
    expect(JSON.stringify(h.bridge.read().project!.instances.body.data)).toContain('base')
    await h.bridge.redo(a)
    expect(JSON.stringify(h.bridge.read().project!.instances.body.data)).toContain('kept input')
  } finally { h.bridge.dispose() }
})
