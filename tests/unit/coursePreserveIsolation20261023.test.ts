import { expect, it } from 'vitest'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { nestedFlowSizingFixture } from '../helpers/nestedFlowSizingFixture'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { registerFlowWorkspaceDrain } from '../../src/renderer/document/flowWorkspaceRegistry'
import { registerCourseDraftProvider } from '../../src/renderer/authoring/courseDraftLifecycle'

it('does not use an unrelated retained JSON raw as proof that an unregistered active Flow input was preserved', async () => {
  const h = await createV10StoreHost(nestedFlowSizingFixture(), undefined, false)
  const store = () => useEditorStore.getState()
  await store().connectCourseDocuments(h.api)
  const snapshot = h.first.read(), bridge = store().courseBridge
  registerCourseDraftProvider(bridge, 'json', { hasDirty: () => true, prepare: async () => [],
    preserve: () => [{ kind: 'json', documentId: snapshot.documentId, projectId: h.model().project.id, epoch: snapshot.epoch,
      key: 'other-object-json', payload: { raw: '{unclosed', label: 'unrelated input' } }],
    restore() {}, release() {} })
  const release = registerFlowWorkspaceDrain(snapshot.documentId, async () => ({ ok: false, reason: '活动中文输入尚未确认' }))
  try {
    expect(await store().courseInputs.prepare([snapshot.documentId], 'preserve')).toBe(false)
    expect(store().errorMessage).toContain('活动中文输入尚未确认')
    expect(store().courseView.surfaceId).toBe('root')
    expect(h.first.read()).toEqual(snapshot)
  } finally { release(); bridge.dispose(); h.bridge.dispose() }
})

it('parks the exact local Flow raw only after its recovery ACK, then permits navigation without applying bad source', async () => {
  const h = await createV10StoreHost(nestedFlowSizingFixture(), undefined, false), entered = deferred(), ack = deferred()
  const store = () => useEditorStore.getState(), retained: string[] = []
  await store().connectCourseDocuments(h.api, { preserveFlow: async (ids, retain) => {
    expect(retain).toBe(true); retained.push(...ids); entered.resolve(); await ack.promise; return true
  }, suspendFlow() {}, resumeFlow() {} })
  const snapshot = h.first.read(), documentId = snapshot.documentId
  store().setFlowDocumentDraft({ surfaceId: 'root', revision: snapshot.revision, source: '$unfinished local source', composing: false,
    diagnostics: [{ message: '待修源文', offset: 0, endOffset: 1, line: 1, column: 1 }] }, documentId)
  const release = registerFlowWorkspaceDrain(documentId, async () => ({ ok: false, reason: '待修源文', preservable: true, surfaceId: 'root' }))
  try {
    const navigation = store().navigateCourseView(id => store().courseBridge.enterContainer(id, 'child'))
    await entered.promise
    expect(store().courseView.surfaceId).toBe('root')
    expect(store().flowDocumentDrafts?.[documentId]?.source).toBe('$unfinished local source')
    ack.resolve(); expect(await navigation).toBe(true)
    expect(retained).toEqual([documentId])
    expect(store().courseView.surfaceId).toBe('child')
    expect(store().flowDocumentDrafts?.[documentId]).toBeUndefined()
    expect(h.first.read()).toEqual(snapshot)
  } finally { ack.resolve(); release(); store().courseBridge.dispose(); h.bridge.dispose() }
})
