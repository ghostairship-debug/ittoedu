// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { courseDraftLifecycle, createCourseInputLifecycle, registerCourseDraftProvider, type CourseDraftProvider } from '../../src/renderer/authoring/courseDraftLifecycle'
import type { AuthoringDraftRecovery, AuthoringDraftWrite, AuthoringRecoveryRecord, AdvancedDraftRecovery, PropertyDraftRecovery } from '../../src/shared/workbench/desktop'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'

const fixtures: Awaited<ReturnType<typeof createV10StoreHost>>[] = []
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.bridge.dispose() })
async function fixture() {
  const h = await createV10StoreHost(createBlankCourseProjectV10()); fixtures.push(h)
  const snapshot = h.first.read(), lifecycle = courseDraftLifecycle(h.bridge)
  const record = (raw: string, key = 'target'): AdvancedDraftRecovery => ({ kind: 'json', projectId: h.model().project.id,
    documentId: 'previous-document', epoch: 'previous-epoch', key, payload: { raw, message: '原诊断' } })
  return { ...h, snapshot, lifecycle, record }
}
const provider = (overrides: Partial<CourseDraftProvider> = {}): CourseDraftProvider => ({
  hasDirty: () => false, prepare: async () => [], preserve: () => [], restore() {}, release() {}, ...overrides,
})

describe('advanced recovery candidates', () => {
  it('retains distinct alternatives at one logical target and never replays the last one on registration', async () => {
    const h = await fixture(), first = h.record('第一份'), second = h.record('第二份')
    expect(h.lifecycle.restore(h.snapshot.documentId, [first, second])).toMatchObject({ restored: 0, adopted: [], issues: [{ message: expect.stringContaining('多份不同输入') }] })
    const restore = vi.fn()
    registerCourseDraftProvider(h.bridge, 'json', provider({ restore }))
    expect(restore).not.toHaveBeenCalled()
    expect(h.lifecycle.preserve(h.snapshot.documentId).map(record => record.payload)).toEqual([first.payload, second.payload])
    expect(await h.lifecycle.prepare(h.snapshot.documentId)).toEqual({ ready: true, issues: [] })
    expect(h.lifecycle.preserve(h.snapshot.documentId).map(record => record.payload)).toEqual([first.payload, second.payload])
  })

  it('preserves a rejected unique input in pending storage and reports it as retained', async () => {
    const h = await fixture(), saved = h.record('目标已移除时的原文')
    registerCourseDraftProvider(h.bridge, 'json', provider({ restore() { throw new Error('原目标不存在') } }))
    expect(h.lifecycle.restore(h.snapshot.documentId, [saved])).toMatchObject({ restored: 1, adopted: [saved], issues: [{ message: '原目标不存在' }] })
    expect(h.lifecycle.preserve(h.snapshot.documentId)).toEqual([{ ...saved, documentId: h.snapshot.documentId, epoch: h.snapshot.epoch }])
  })

  it('keeps a silent provider no-op as pending raw input rather than trusting its void return', async () => {
    const h = await fixture(), saved = h.record('尚未接续')
    registerCourseDraftProvider(h.bridge, 'json', provider())
    expect(h.lifecycle.restore(h.snapshot.documentId, [saved])).toMatchObject({ adopted: [saved], issues: [{ message: expect.stringContaining('尚未接续') }] })
    expect(h.lifecycle.preserve(h.snapshot.documentId)).toEqual([{ ...saved, documentId: h.snapshot.documentId, epoch: h.snapshot.epoch }])
    expect(await h.lifecycle.prepare(h.snapshot.documentId)).toEqual({ ready: true, issues: [] })
    expect(h.lifecycle.preserve(h.snapshot.documentId)).toEqual([{ ...saved, documentId: h.snapshot.documentId, epoch: h.snapshot.epoch }])
  })

  it('does not overwrite newer provider input with an older candidate at the same target', async () => {
    const h = await fixture(), current = { ...h.record('新的人工输入'), documentId: h.snapshot.documentId, epoch: h.snapshot.epoch }
    const restore = vi.fn()
    registerCourseDraftProvider(h.bridge, 'json', provider({ restore, preserve: () => [current] }))
    expect(h.lifecycle.restore(h.snapshot.documentId, [h.record('旧恢复稿')])).toMatchObject({ adopted: [], restored: 0 })
    expect(restore).not.toHaveBeenCalled()
    expect(h.lifecycle.preserve(h.snapshot.documentId).map(record => record.payload)).toEqual([current.payload, h.record('旧恢复稿').payload])
  })

  it('recognizes provider adoption when only a recomputed diagnostic changes', async () => {
    const h = await fixture(), saved = h.record('实际恢复原文')
    let retained: AdvancedDraftRecovery[] = []
    registerCourseDraftProvider(h.bridge, 'json', provider({ preserve: () => retained,
      restore(documentId, record) { retained = [{ ...record, documentId, payload: { ...(record.payload as object), message: '已恢复，请继续编辑' } }] } }))
    expect(h.lifecycle.restore(h.snapshot.documentId, [saved])).toMatchObject({ adopted: [saved], restored: 1, issues: [] })
    expect(h.lifecycle.preserve(h.snapshot.documentId)).toHaveLength(1)
    expect(await h.lifecycle.prepare(h.snapshot.documentId)).toEqual({ ready: true, issues: [] })
  })

  it('adopts an already applied recovered input without retaining it as unfinished input', async () => {
    const h = await fixture(), saved = h.record('已经写入当前正文')
    const restore = vi.fn(() => 'consumed' as const)
    registerCourseDraftProvider(h.bridge, 'json', provider({ restore }))
    expect(h.lifecycle.restore(h.snapshot.documentId, [saved])).toEqual({ restored: 1, adopted: [saved], issues: [] })
    expect(h.lifecycle.preserve(h.snapshot.documentId)).toEqual([])
    expect(await h.lifecycle.prepare(h.snapshot.documentId)).toEqual({ ready: true, issues: [] })
    expect(restore).toHaveBeenCalledOnce()
  })

  it('consumes a pending applied input when its provider becomes available', async () => {
    const h = await fixture(), saved = h.record('已应用但入口晚挂载')
    h.lifecycle.restore(h.snapshot.documentId, [saved])
    expect(h.lifecycle.preserve(h.snapshot.documentId)).toHaveLength(1)
    registerCourseDraftProvider(h.bridge, 'json', provider({ restore: () => 'consumed' }))
    expect(h.lifecycle.preserve(h.snapshot.documentId)).toEqual([])
  })

  it('adopts planner-rebased input at the same logical target without duplicating the old baseline', async () => {
    const h = await fixture(), saved = h.record('保持原修改意图')
    let retained: AdvancedDraftRecovery[] = []
    registerCourseDraftProvider(h.bridge, 'json', provider({ preserve: () => retained,
      restore(documentId, record) {
        retained = [{ ...record, documentId, payload: { raw: '保持原修改意图', baseline: '当前颜色与字段基线' } }]
        return 'adopted'
      } }))
    expect(h.lifecycle.restore(h.snapshot.documentId, [saved])).toEqual({ adopted: [saved], restored: 1, issues: [] })
    expect(h.lifecycle.preserve(h.snapshot.documentId)).toEqual(retained)
    expect(retained[0]!.payload).toMatchObject({ raw: '保持原修改意图', baseline: '当前颜色与字段基线' })
  })

  it('retains raw input when a provider claims adoption without preserving a corresponding target', async () => {
    const h = await fixture(), saved = h.record('不能被空采用丢掉的原稿')
    registerCourseDraftProvider(h.bridge, 'json', provider({ restore: () => 'adopted' }))
    expect(h.lifecycle.restore(h.snapshot.documentId, [saved])).toMatchObject({ adopted: [saved], issues: [{ message: expect.stringContaining('尚未接续') }] })
    expect(h.lifecycle.preserve(h.snapshot.documentId)).toEqual([{ ...saved, documentId: h.snapshot.documentId, epoch: h.snapshot.epoch }])
  })
})

describe('course input durable adoption', () => {
  it('does not claim preservation when a refused editor has not captured any raw input', async () => {
    const h = await fixture(), error = vi.fn(), write = vi.fn(async () => {})
    const inputs = createCourseInputLifecycle(h.bridge, {
      capture: () => ({ snapshot: h.snapshot, records: { advanced: [], properties: [] }, flowDraft: null }),
      drain: async () => { throw new Error('当前正文输入法尚未完成') },
      restore: () => ({ advanced: [], properties: [] }), suspend() {}, resume() {}, error, status() {},
    })
    inputs.connect({ ...h.api, readAuthoringDrafts: async () => null, writeAuthoringDrafts: write })
    expect(await inputs.prepare([h.snapshot.documentId], 'preserve')).toBe(false)
    expect(error).toHaveBeenLastCalledWith('当前正文输入法尚未完成')
    expect(write).not.toHaveBeenCalled()
  })

  it('does not use an unrelated old raw draft to excuse the current unregistered input failure', async () => {
    const h = await fixture(), error = vi.fn(), write = vi.fn(async () => {})
    const unrelated = { ...h.record('无关位置的旧JSON原稿'), documentId: h.snapshot.documentId, epoch: h.snapshot.epoch }
    const inputs = createCourseInputLifecycle(h.bridge, {
      capture: () => ({ snapshot: h.snapshot, records: { advanced: [unrelated], properties: [] }, flowDraft: null }),
      drain: async () => { throw new Error('当前正文输入法尚未完成') },
      restore: () => ({ advanced: [], properties: [] }), suspend() {}, resume() {}, error, status() {},
    })
    inputs.connect({ ...h.api, readAuthoringDrafts: async () => null, writeAuthoringDrafts: write })
    expect(await inputs.prepare([h.snapshot.documentId], 'preserve')).toBe(false)
    expect(error).toHaveBeenLastCalledWith('当前正文输入法尚未完成')
    expect(write).not.toHaveBeenCalled()
  })

  it('does not sign durable Flow preservation when its raw-input adapter is missing', async () => {
    const h = await fixture(), error = vi.fn(), write = vi.fn(async () => {})
    const flowDraft = { surfaceId: 'flow', source: '只在正文原稿owner中的文字', composing: false, diagnostics: [] }
    const inputs = createCourseInputLifecycle(h.bridge, {
      capture: () => ({ snapshot: h.snapshot, records: { advanced: [], properties: [] }, flowDraft }),
      drain: async () => {}, restore: () => ({ advanced: [], properties: [] }),
      suspend() {}, resume() {}, error, status() {},
    })
    inputs.connect({ ...h.api, readAuthoringDrafts: async () => null, writeAuthoringDrafts: write })
    expect(await inputs.prepare([h.snapshot.documentId], 'preserve')).toBe(false)
    expect(error).toHaveBeenLastCalledWith('正文原稿恢复服务未连接，当前输入继续保留')
    expect(write).not.toHaveBeenCalled()
  })

  async function inputFixture(owner: 'previous' | 'current' = 'previous') {
    const h = await fixture(), saved = h.record('选入的高级原文'), rejected = h.record('未选入的高级原文', 'other')
    const property: PropertyDraftRecovery = { bindingKey: 'width', label: '宽度', kind: 'number', raw: '1e', composing: false }
    const otherProperty: PropertyDraftRecovery = { ...property, bindingKey: 'height', raw: '2e' }
    const metadata = (id: string, kind: AuthoringRecoveryRecord['kind'], value: AuthoringRecoveryRecord['value']): AuthoringRecoveryRecord => ({ id, digest: `${id}-digest`,
      ownerDocumentId: owner === 'current' ? h.snapshot.documentId : 'previous-document', kind, value })
    const sourceConflict = { documentId: 'previous-document', epoch: 'previous-epoch', source: '原 Source', diskVersion: null, hunks: [] }
    const recoveryRecords = [metadata('selected-advanced', 'advanced', saved), metadata('other-advanced', 'advanced', rejected),
      metadata('selected-property', 'properties', property), metadata('other-property', 'properties', otherProperty), metadata('source', 'sourceConflict', sourceConflict)]
    const recovered: AuthoringDraftRecovery = { advanced: [saved, rejected], properties: [property, otherProperty], sourceConflict, recoveryRecords }
    let current: AuthoringDraftRecovery = { advanced: [], properties: [] }, epoch = h.snapshot.epoch
    const order: string[] = []
    const write = vi.fn(async () => { order.push('write') }), claim = vi.fn(async () => { order.push('claim') }), clear = vi.fn()
    const read = vi.fn(async () => recovered), error = vi.fn()
    const api = { ...h.api, readAuthoringDrafts: read, writeAuthoringDrafts: write, claimAuthoringDrafts: claim, clearAuthoringDrafts: clear }
    const restore = vi.fn(() => {
      current = { advanced: [{ ...saved, documentId: h.snapshot.documentId, epoch }], properties: [property] }
      return { advanced: [saved], properties: [property] }
    })
    const inputs = createCourseInputLifecycle(h.bridge, { capture: () => ({ snapshot: { ...h.snapshot, epoch }, records: current, flowDraft: null }),
      drain: async () => {}, restore, suspend() {}, resume() {}, error, status() {} })
    inputs.connect(api)
    const retained = [{ id: 'other-advanced', digest: 'other-advanced-digest' }, { id: 'other-property', digest: 'other-property-digest' }]
    return { ...h, inputs, saved, property, write, claim, clear, read, error, order, retained,
      setEpoch(value: string) { epoch = value }, setCurrent(value: AuthoringDraftRecovery) { current = value } }
  }

  it('durably claims only selected raw identities before publishing remapped provider slices', async () => {
    const h = await inputFixture()
    await h.inputs.restore(h.snapshot.documentId)
    expect(h.write).toHaveBeenCalledExactlyOnceWith(h.snapshot.documentId, {
      advanced: [{ ...h.saved, documentId: h.snapshot.documentId, epoch: h.snapshot.epoch }], properties: [h.property],
      retainedRecords: h.retained,
    }, h.snapshot.epoch)
    expect(h.claim).toHaveBeenCalledExactlyOnceWith(h.snapshot.documentId, h.snapshot.epoch,
      [{ id: 'selected-advanced', digest: 'selected-advanced-digest' }, { id: 'selected-property', digest: 'selected-property-digest' }])
    expect(h.order).toEqual(['claim', 'write'])
    expect(h.clear).not.toHaveBeenCalled()
  })

  it('keeps provider writes behind durable claim ACK and can retry a failed claim', async () => {
    const h = await inputFixture()
    h.claim.mockRejectedValueOnce(new Error('认领保全失败'))
    await expect(h.inputs.restore(h.snapshot.documentId)).rejects.toThrow('认领保全失败')
    expect(h.write).not.toHaveBeenCalled()
    await h.inputs.restore(h.snapshot.documentId)
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.claim).toHaveBeenCalledTimes(2)
    expect(h.write).toHaveBeenCalledOnce()
  })

  it('persists newer same-epoch input captured after the durable claim finishes', async () => {
    const h = await inputFixture(), entered = deferred(), release = deferred()
    h.claim.mockImplementationOnce(async () => { entered.resolve(); await release.promise })
    const restoring = h.inputs.restore(h.snapshot.documentId)
    await entered.promise
    const newer = { advanced: [{ ...h.saved, documentId: h.snapshot.documentId, epoch: h.snapshot.epoch,
      payload: { raw: '认领期间继续输入的新原文' } }], properties: [{ ...h.property, raw: '3e' }] }
    h.setCurrent(newer)
    release.resolve()
    await restoring
    expect(h.write).toHaveBeenCalledExactlyOnceWith(h.snapshot.documentId, { ...newer, retainedRecords: h.retained }, h.snapshot.epoch)
  })

  it('retains rejected same-owner raw identities on every write while excluding adopted identities', async () => {
    const h = await inputFixture('current')
    await h.inputs.restore(h.snapshot.documentId)
    h.setCurrent({ advanced: [], properties: [] })
    await h.inputs.persist([h.snapshot.documentId])
    expect(h.write).toHaveBeenNthCalledWith(1, h.snapshot.documentId, expect.objectContaining({ retainedRecords: h.retained }), h.snapshot.epoch)
    expect(h.write).toHaveBeenNthCalledWith(2, h.snapshot.documentId, { advanced: [], properties: [], retainedRecords: h.retained }, h.snapshot.epoch)
    expect(h.claim).toHaveBeenCalledExactlyOnceWith(h.snapshot.documentId, h.snapshot.epoch,
      [{ id: 'selected-advanced', digest: 'selected-advanced-digest' }, { id: 'selected-property', digest: 'selected-property-digest' }])
  })

  it('does not publish provider slices when the destination epoch changes during claim', async () => {
    const h = await inputFixture()
    h.claim.mockImplementationOnce(async () => { h.setEpoch('reopened-epoch') })
    await expect(h.inputs.restore(h.snapshot.documentId)).rejects.toThrow('已关闭或重开')
    expect(h.write).not.toHaveBeenCalled()
  })

  it('skips unchanged drafts and clears only its own slices when real input becomes empty', async () => {
    const h = await fixture(), write = vi.fn(async () => {}), clear = vi.fn()
    let advanced: AdvancedDraftRecovery[] = [{ ...h.record('pending'), documentId: h.snapshot.documentId, epoch: h.snapshot.epoch }]
    const inputs = createCourseInputLifecycle(h.bridge, { capture: () => ({ snapshot: h.snapshot, records: { advanced, properties: [] }, flowDraft: null }),
      drain: async () => {}, restore: () => ({ advanced: [], properties: [] }), suspend() {}, resume() {}, error() {}, status() {} })
    inputs.connect({ ...h.api, writeAuthoringDrafts: write, clearAuthoringDrafts: clear })
    await inputs.persist([h.snapshot.documentId])
    await inputs.persist([h.snapshot.documentId])
    expect(write).toHaveBeenCalledOnce()
    advanced = []
    await inputs.persist([h.snapshot.documentId])
    expect(write).toHaveBeenLastCalledWith(h.snapshot.documentId, { advanced: [], properties: [] }, h.snapshot.epoch)
    expect(write).toHaveBeenCalledTimes(2)
    expect(clear).not.toHaveBeenCalled()
  })
  it('clears newer empty input after a pending background nonempty write and retries failed writes', async () => {
    const h = await fixture(), entered = deferred(), release = deferred()
    let advanced: AdvancedDraftRecovery[] = [], disk: AdvancedDraftRecovery[] = []
    const write = vi.fn(async (_id: string, value: AuthoringDraftWrite) => { const records = value.advanced ?? []; if (records.length) { entered.resolve(); await release.promise }; disk = records })
    const inputs = createCourseInputLifecycle(h.bridge, { capture: () => ({ snapshot: h.snapshot, records: { advanced, properties: [] }, flowDraft: null }),
      drain: async () => {}, restore: () => ({ advanced: [], properties: [] }), suspend() {}, resume() {}, error() {}, status() {} })
    inputs.connect({ ...h.api, writeAuthoringDrafts: write })
    await inputs.restore(h.snapshot.documentId)
    advanced = [{ ...h.record('pending'), documentId: h.snapshot.documentId, epoch: h.snapshot.epoch }]
    const background = inputs.persist([h.snapshot.documentId]); await entered.promise
    advanced = []
    const closing = inputs.prepare([h.snapshot.documentId])
    release.resolve(); await background
    expect(await closing).toBe(true)
    expect(disk).toEqual([])
    expect(write).toHaveBeenCalledTimes(2)
    advanced = [{ ...h.record('retry'), documentId: h.snapshot.documentId, epoch: h.snapshot.epoch }]
    write.mockRejectedValueOnce(new Error('disk busy'))
    expect(await inputs.prepare([h.snapshot.documentId])).toBe(false)
    expect(await inputs.prepare([h.snapshot.documentId])).toBe(true)
    expect(disk).toEqual(advanced)
  })
})
