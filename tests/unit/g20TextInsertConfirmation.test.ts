// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createCourseDocumentHost, deferred } from '../helpers/courseDocumentHost'
const store = () => useEditorStore.getState()
afterEach(() => store().courseBridge.dispose())
it('retains each newly inserted Slide and Flow text identity after its authoritative ACK and reopen', async () => {
  const host = await createCourseDocumentHost(); await store().connectCourseDocuments(host.api)
  for (const kind of ['slide', 'flow'] as const) {
    await store().createCourseDocument(kind)
    const documentId = store().courseView.activeDocumentId!, session = host.registry.get(documentId), before = session.read(), previous = store().courseView.selectedInstanceId
    const entered = deferred(), release = deferred(); host.controls.beforeAppend = async () => { entered.resolve(); await release.promise }
    const write = store().addTextNode(); await entered.promise
    expect(session.read().revision).toBe(before.revision)
    release.resolve(); await write; await store().drainCourseDocument()
    host.controls.beforeAppend = undefined
    const after = session.read(), id = store().courseView.selectedInstanceId!
    expect(id).toBeTruthy(); expect(id).not.toBe(previous)
    expect(store().courseView.selectedInstanceIds).toEqual([id])
    expect(after.revision).toBe(before.revision + 1); expect(after.undoDepth).toBe(before.undoDepth + 1)
    if (after.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(after.model.project.surfaces[0].childIds).toContain(id)
    const instance = after.model.project.instances[id], definition = after.model.project.definitions[instance.definitionId]
    expect(definition.implementation).toMatchObject({ kind: 'builtin', key: 'guoling.text' })
    if (kind === 'flow') expect(instance.flowPlacement).toBeUndefined()
    expect(host.driver.load(host.driver.serialize(after.model))).toEqual(after.model)
    await store().courseBridge.undo(documentId); expect(store().courseView.project!.instances[id]).toBeUndefined()
  }
})
