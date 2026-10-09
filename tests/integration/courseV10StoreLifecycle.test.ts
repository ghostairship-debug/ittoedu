// @vitest-environment node
import { expect, it } from 'vitest'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import { CHART_DEFINITION, createChartData } from '../../src/components/chart'
import { TABLE_DEFINITION, createTableData } from '../../src/components/table'
import { INTERACTIONS_DEFINITION, interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import { prepareCourseObjectPaste } from '../../src/core/course/courseObjectEdits'
import { createInteractionAuthoringActions } from '../../src/renderer/interactions/commitInteractionAuthoring'
import { createSlideAuthoringSlice, createInitialSlideOwnedState } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { courseDraftLifecycle } from '../../src/renderer/authoring/courseDraftLifecycle'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { InteractionRule } from '../../src/shared/interactionTypes'

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
function fixture(): CourseProjectV10 {
  return { schemaVersion: 10, id: 'store-project', revision: 0, title: '三表面', definitions: { [WEB_DEFINITION.id]: WEB_DEFINITION },
    instances: Object.fromEntries(['slide-text', 'flow-text', 'trigger', 'peer', 'outside', 'global'].map((id, index) => [id, {
      id, definitionId: WEB_DEFINITION.id, data: { html: id }, frame: { width: 160, height: 80, transform: [1, 0, 0, 1, 20 + index * 180, 40] },
    }])),
    surfaces: [{ id: 'slide', kind: 'slide', title: '演示', childIds: ['slide-text'] }, { id: 'flow', kind: 'flow', title: '正文', childIds: ['flow-text'] },
      { id: 'spatial', kind: 'spatial', title: '空间', childIds: ['trigger', 'peer', 'outside'], spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [],
        relations: [{ id: 'inside', sourceInstanceId: 'trigger', targetInstanceId: 'peer', kind: 'line' }, { id: 'external', sourceInstanceId: 'trigger', targetInstanceId: 'outside', kind: 'arrow' }],
        paths: [{ id: 'path', frameIds: [], instanceIds: ['trigger', 'outside'] }], semanticZoom: [{ id: 'zoom', instanceIds: ['peer', 'outside'], minZoom: .5, maxZoom: 2, visible: true }] } }],
    global: { underlay: [], overlay: ['global'] }, assets: {} }
}
const rule = (id: string, trigger: InteractionRule['trigger'], action: InteractionRule['actions'][number]['action']): InteractionRule => ({
  id, name: id, enabled: true, trigger, conditions: [], actions: [{ id: `${id}-action`, start: 'after-previous', delayMs: 0, action }],
})
function attachRules(project: CourseProjectV10, surfaceId: string, rules: InteractionRule[]) {
  project.definitions[INTERACTIONS_DEFINITION.id] = INTERACTIONS_DEFINITION
  project.instances.behavior = { id: 'behavior', definitionId: INTERACTIONS_DEFINITION.id, data: json({ rules }),
    attachments: [{ instanceId: 'behavior', target: { kind: 'surface', surfaceId } }] }
  project.surfaces.find(surface => surface.id === surfaceId)!.childIds.push('behavior')
}

it('pastes the same Spatial graph twice with independent completion followers and relations, preserving external paths and zoom', async () => {
  const project = fixture(), motion = { type: 'node.enter' as const, nodeId: 'peer', effect: 'fade' as const, durationMs: 240, easing: 'ease-out' as const }
  attachRules(project, 'spatial', [rule('root', { type: 'node.click', nodeId: 'trigger' }, motion),
    rule('follow', { type: 'animation.completed', actionId: 'root-action' }, { ...motion, type: 'node.exit', nodeId: 'trigger' })])
  const h = await createV10StoreHost(project)
  try {
    h.kernel.selectSurface('spatial'); h.kernel.selectInstances(['trigger', 'peer'])
    const clipboard = { documentId: h.first.documentId, project: structuredClone(project), roots: ['trigger', 'peer'], resources: h.kernel.readResources() }
    const copies: string[][] = []
    for (let index = 0; index < 2; index++) {
      const target = h.kernel.captureTarget(), plan = prepareCourseObjectPaste(clipboard, { capturedTarget: target,
        container: { kind: 'surface', surfaceId: 'spatial' }, index: target.project.surfaces[2].childIds.length, offset: { x: 20, y: 20 } })
      expect(await h.kernel.editCaptured(h.kernel.capture(plan.edits, target))).toMatchObject({ status: 'applied' })
      copies.push(plan.rootIds)
      const [trigger, peer] = plan.rootIds, current = h.model().project
      const rules = interactionRules(interactionBehavior(current, { kind: 'surface', surfaceId: 'spatial' }))
      const root = rules.find(value => value.trigger.type === 'node.click' && value.trigger.nodeId === trigger)!
      expect(root.actions[0].action).toMatchObject({ nodeId: peer })
      const follower = rules.find(value => value.trigger.type === 'animation.completed' && value.trigger.actionId === root.actions[0].id)!
      expect(follower.actions[0].action).toMatchObject({ nodeId: trigger })
      expect(root.id).not.toBe('root'); expect(root.actions[0].id).not.toBe('root-action')
      expect(current.surfaces[2].spatial!.relations).toContainEqual(expect.objectContaining({ sourceInstanceId: trigger, targetInstanceId: peer }))
      expect(current.surfaces[2].spatial!.relations).not.toContainEqual(expect.objectContaining({ sourceInstanceId: trigger, targetInstanceId: 'outside' }))
      expect(current.surfaces[2].spatial!.paths).toEqual(project.surfaces[2].spatial!.paths)
      expect(current.surfaces[2].spatial!.semanticZoom).toEqual(project.surfaces[2].spatial!.semanticZoom)
      if (!index) await h.kernel.edit([{ type: 'data.set', instanceId: 'outside', path: ['html'], value: '后续人工修改' }])
    }
    expect(new Set(copies.flat()).size).toBe(4)
    const copiedRules = interactionRules(interactionBehavior(h.model().project, { kind: 'surface', surfaceId: 'spatial' }))
    expect(new Set(copiedRules.flatMap(value => value.actions.map(action => action.id))).size).toBe(6)
    expect(h.model().project.surfaces[2].spatial!.relations).toHaveLength(4)
    expect(h.first.read().undoDepth).toBe(3)
    await h.bridge.undo()
    expect(copies[1].every(id => !h.model().project.instances[id])).toBe(true)
    expect(copies[0].every(id => Boolean(h.model().project.instances[id]))).toBe(true)
    expect(h.driver.load(h.driver.serialize(h.model()))).toEqual(h.model())
    const target = h.kernel.captureTarget(), spatialBefore = structuredClone(target.project.surfaces[2].spatial)
    const globalCopy = prepareCourseObjectPaste(clipboard, { capturedTarget: target, container: { kind: 'global', plane: 'overlay' }, index: target.project.global.overlay.length })
    await h.kernel.editCaptured(h.kernel.capture(globalCopy.edits, target))
    expect(h.model().project.surfaces[2].spatial).toEqual(spatialBefore)
    expect(h.model().project.global.overlay).toEqual(['global', ...globalCopy.rootIds])
  } finally { h.bridge.dispose() }
})

it('duplicates fresh rule identities, moves only within the visible rule kind, and cascades completion deletion through both authoring entries', async () => {
  const project = fixture(), surfaceId = 'slide'
  const initial = [rule('first', { type: 'scene.enter' }, { type: 'scene.next' }), rule('click', { type: 'node.click', nodeId: 'slide-text' }, { type: 'scene.next' }),
    rule('second', { type: 'scene.enter' }, { type: 'scene.next' })]
  attachRules(project, surfaceId, initial)
  const h = await createV10StoreHost(project), actions = createInteractionAuthoringActions({ kernel: h.kernel, capture: () => h.kernel.captureTarget() })
  const rules = () => interactionRules(interactionBehavior(h.model().project, { kind: 'surface', surfaceId }))
  try {
    expect(await actions.duplicateInteractionRule(surfaceId, 'first')).toEqual({ ok: true, status: 'committed' })
    const copy = rules()[1]
    expect(copy.id).not.toBe('first'); expect(copy.actions[0].id).not.toBe('first-action')
    expect(await actions.moveInteractionRule(surfaceId, 'second', -1)).toEqual({ ok: true, status: 'committed' })
    expect(rules().map(value => value.id)).toEqual(['first', 'second', copy.id, 'click'])
    await h.bridge.undo(); expect(rules().map(value => value.id)).toEqual(['first', copy.id, 'click', 'second'])
    await h.bridge.undo(); expect(rules()).toEqual(initial)
    const motion = { type: 'node.enter' as const, nodeId: 'slide-text', effect: 'fade' as const, durationMs: 240, easing: 'ease-out' as const }
    for (const added of [rule('source', { type: 'scene.enter' }, motion), rule('dependent', { type: 'animation.completed', actionId: 'source-action' }, { ...motion, type: 'node.exit' }),
      rule('second-order', { type: 'animation.completed', actionId: 'dependent-action' }, { type: 'scene.next' })])
      expect(await actions.addInteractionRule(surfaceId, added)).toEqual({ ok: true, status: 'committed' })
    const beforeDelete = h.first.read().undoDepth, whole = rules()
    expect(await actions.deleteInteractionRule(surfaceId, 'source')).toEqual({ ok: true, status: 'committed' })
    expect(rules()).toEqual(initial); expect(h.first.read().undoDepth).toBe(beforeDelete + 1)
    await h.bridge.undo(); expect(rules()).toEqual(whole)
    const gateway = new DocumentToolGateway(h.registry, [h.driver], () => crypto.randomUUID())
    await gateway.beginRun({ runId: 'remove-rule', actor: 'agent', documents: [{ documentId: h.first.documentId, writable: [{ kind: 'document' }] }] })
    const target = await gateway.issueTarget('remove-rule', h.first.documentId, { kind: 'course-surface', surfaceId })
    // Read the current behavior before the public mutation; the same Session owns both paths.
    expect(await gateway.execute('remove-rule', 'read', { name: 'read', input: { target } })).toMatchObject({ kind: 'read' })
    expect(await gateway.execute('remove-rule', 'remove', { name: 'interaction.update', input: { target, change: { kind: 'remove', ruleId: 'source' } } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(rules()).toEqual(initial)
    await h.bridge.undo(); expect(rules()).toEqual(whole)
  } finally { h.bridge.dispose() }
})

it('shares one resource-bearing History across Slide, Flow and Spatial, including archive reopen and reverse-order undo/redo', async () => {
  const project = fixture(), source = fixture()
  source.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
  source.definitions.program = { id: 'program', role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'code', entry: 'main.js' } } }
  source.instances.image = { id: 'image', definitionId: IMAGE_DEFINITION.id, data: json(createImageData('logo')) }
  source.instances.program = { id: 'program', definitionId: 'program', data: { title: '程序' } }
  source.surfaces[0].childIds.push('image', 'program')
  source.assets.logo = { id: 'logo', path: 'assets/logo.svg', filename: 'logo.svg', mimeType: 'image/svg+xml' }
  const sourceResources = { assets: { logo: new TextEncoder().encode('<svg/>') }, components: { code: { 'main.js': new TextEncoder().encode('export const answer = 42') } } }
  const h = await createV10StoreHost(project), snapshots = [structuredClone(h.model())]
  try {
    for (const surfaceId of ['slide', 'flow', 'spatial']) {
      h.kernel.selectSurface(surfaceId)
      const target = h.kernel.captureTarget(), surface = target.project.surfaces.find(value => value.id === surfaceId)!
      const plan = prepareCourseObjectPaste({ documentId: 'other-document', project: source, roots: ['image', 'program'], resources: sourceResources },
        { capturedTarget: target, container: { kind: 'surface', surfaceId }, index: surface.childIds.length })
      expect(await h.kernel.editCaptured(h.kernel.capture(plan.edits, target))).toMatchObject({ status: 'applied' })
      expect(h.bridge.read().surfaceId).toBe(surfaceId)
      expect(h.bridge.read().snapshot!.documentId).toBe(h.first.documentId)
      const [imageId, programId] = plan.rootIds, current = h.model()
      expect(current.resources.assets[(current.project.instances[imageId].data as { assetId: string }).assetId]).toEqual(sourceResources.assets.logo)
      const implementation = current.project.definitions[current.project.instances[programId].definitionId].implementation
      if (implementation.kind !== 'source' || !implementation.workspace) throw new Error('Expected private program files')
      expect(current.resources.components[implementation.workspace.ownerId]).toEqual(sourceResources.components.code)
      snapshots.push(structuredClone(current))
      expect(h.first.read().undoDepth).toBe(snapshots.length - 1)
    }
    expect(await h.bridge.save()).toBe(true)
    expect(h.driver.load(h.disk.get('saved.glx')!)).toEqual(h.model())
    const sameContent = (index: number) => {
      const current = h.model(), previous = snapshots[index]
      expect(current.project.instances).toEqual(previous.project.instances)
      expect(current.project.surfaces).toEqual(previous.project.surfaces)
      expect(current.resources).toEqual(previous.resources)
      expect(current.project.global).toEqual(project.global)
    }
    for (let index = 2; index >= 0; index--) { await h.bridge.undo(); sameContent(index) }
    expect(h.first.read().undoDepth).toBe(0)
    for (let index = 1; index <= 3; index++) { await h.bridge.redo(); sameContent(index) }
    expect(h.first.read().undoDepth).toBe(3)
    expect(h.bridge.read().surfaceId).toBe('spatial')
  } finally { h.bridge.dispose() }
})

it('rejects late captured edits after the target changes or closes without mutating either document or its History', async () => {
  const h = await createV10StoreHost(fixture())
  try {
    const old = h.kernel.capture([{ type: 'data.set', instanceId: 'slide-text', path: ['html'], value: '迟到结果' }])
    await h.kernel.edit([{ type: 'data.set', instanceId: 'slide-text', path: ['html'], value: '新的人工值' }])
    const before = structuredClone(h.first.read())
    await expect(h.kernel.editCaptured(old)).rejects.toThrow()
    expect(h.first.read()).toEqual(before)
    const next = await h.api.create({ kind: 'course-v10', project: fixture(), resources: { assets: {}, components: {} } }, 'second.glx')
    await h.bridge.activate(next.documentId)
    const untouched = structuredClone(h.registry.get(next.documentId).read())
    expect(await h.bridge.close(h.first.documentId)).toBe(true)
    await expect(h.kernel.editCaptured(old)).rejects.toThrow()
    expect(h.registry.get(next.documentId).read()).toEqual(untouched)
    expect(h.bridge.read().activeDocumentId).toBe(next.documentId)
  } finally { h.bridge.dispose() }
})

it('keeps a restored foreground through delayed bootstrap and gives same-project tabs independent History and cancellable close', async () => {
  const h = await createV10StoreHost(fixture(), undefined, false), held = deferred()
  h.controls.bootstrap = held.promise
  try {
    const connecting = h.bridge.connect(h.api), second = await h.api.create(h.model(), 'restored.glx')
    await h.bridge.activate(second.documentId)
    held.resolve(); await connecting
    expect(h.bridge.read().activeDocumentId).toBe(second.documentId)
    await h.kernel.edit([{ type: 'project.title.set', title: '只改恢复页' }])
    expect(h.first.read().undoDepth).toBe(0)
    expect(h.registry.get(second.documentId).read().undoDepth).toBe(1)
    h.controls.cancelClose = true
    expect(await h.bridge.close(second.documentId)).toBe(false)
    expect(h.bridge.read().project!.title).toBe('只改恢复页')
    h.controls.cancelClose = false
    expect(await h.bridge.close(second.documentId)).toBe(true)
    expect(h.bridge.read().activeDocumentId).toBeNull()
    await h.bridge.activate(h.first.documentId)
    expect(h.bridge.read().project!.title).toBe('三表面')
    expect(await h.bridge.close(h.first.documentId)).toBe(true)
    expect(h.bridge.read()).toMatchObject({ activeDocumentId: null, project: null, snapshot: null, pending: 0 })
  } finally { held.resolve(); h.bridge.dispose() }
})

it('serializes rapid edits through the captured surface despite delayed ACK and saves a fixed version while later input stays dirty', async () => {
  const h = await createV10StoreHost(fixture()), held = deferred(), dispatched = deferred()
  h.controls.after = async () => { dispatched.resolve(); await held.promise }
  try {
    const first = h.kernel.edit([{ type: 'data.set', instanceId: 'slide-text', path: ['html'], value: '演示改稿' }])
    await dispatched.promise
    h.kernel.selectSurface('flow')
    const second = h.kernel.edit([{ type: 'data.set', instanceId: 'flow-text', path: ['html'], value: '正文改稿' }])
    h.kernel.selectSurface('spatial')
    const third = h.kernel.edit([{ type: 'data.set', instanceId: 'outside', path: ['html'], value: '空间改稿' }])
    expect(h.bridge.read().project!.instances['flow-text'].data).toEqual({ html: '正文改稿' })
    expect(h.operations).toHaveLength(1)
    held.resolve(); await Promise.all([first, second, third])
    expect(h.operations.map(operation => operation.baseRevision)).toEqual([0, 1, 2])
    expect(h.bridge.read().surfaceId).toBe('spatial'); expect(h.first.read().undoDepth).toBe(3)
    h.controls.after = undefined
    const saving = deferred(), writing = deferred(), fixed = structuredClone(h.model())
    h.controls.save = async () => { writing.resolve(); await saving.promise }
    const saved = h.bridge.save(); await writing.promise
    await h.kernel.edit([{ type: 'data.set', instanceId: 'outside', path: ['html'], value: '落盘期间继续编辑' }])
    saving.resolve(); expect(await saved).toBe(true)
    expect(h.driver.load(h.disk.get('saved.glx')!)).toEqual(fixed)
    expect(h.first.read().dirty).toBe(true); expect(h.first.read().undoDepth).toBe(4)
    expect(h.model().project.instances.outside.data).toEqual({ html: '落盘期间继续编辑' })
  } finally { held.resolve(); h.bridge.dispose() }
})

it('preserves composing professional drafts outside canonical data and commits each resumed field once before archive persistence', async () => {
  const project = fixture()
  for (const definition of [TEXT_DEFINITION, CHART_DEFINITION, TABLE_DEFINITION]) project.definitions[definition.id] = definition
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: json(createTextData('原文字')) }
  const chart = createChartData(), table = createTableData()
  project.instances.chart = { id: 'chart', definitionId: CHART_DEFINITION.id, data: json(chart) }
  project.instances.table = { id: 'table', definitionId: TABLE_DEFINITION.id, data: json(table) }
  project.surfaces[0].childIds.push('text', 'chart', 'table')
  const h = await createV10StoreHost(project)
  let owned = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(h.kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch } } })
  const changedChart = { ...chart, title: '修改后的图表' }, changedTable = { ...table, caption: { inlines: [{ type: 'text' as const, text: '修改后的表格' }] } }
  try {
    for (const [instanceId, data] of [['text', createTextData('输入中的文字')], ['chart', changedChart], ['table', changedTable]] as const) {
      const depth = h.first.read().undoDepth, before = structuredClone(h.model())
      expect(slice.beginSlideDataEdit(instanceId, 'properties')).not.toBeNull()
      slice.updateSlideDataDraft(data, true)
      expect(h.model()).toEqual(before); expect(h.first.read().undoDepth).toBe(depth)
      expect(courseDraftLifecycle(h.bridge).preserve(h.first.documentId)).toHaveLength(1)
      expect(await courseDraftLifecycle(h.bridge).prepare(h.first.documentId)).toMatchObject({ ready: false })
      expect(owned.slideContentEdit?.data).toEqual(json(data))
      slice.updateSlideDataDraft(data, false)
      expect(await courseDraftLifecycle(h.bridge).prepare(h.first.documentId)).toEqual({ ready: true, issues: [] })
      expect(await slice.commitDraftForPersistence(h.first.documentId)).toEqual({ ok: true })
      expect(h.first.read().undoDepth).toBe(depth + 1); expect(owned.slideContentEdit).toBeNull()
      expect(h.model().project.instances[instanceId].data).toEqual(json(data))
      await h.bridge.undo(); expect(h.model().project.instances[instanceId]).toEqual(before.project.instances[instanceId])
      await h.bridge.redo(); expect(h.model().project.instances[instanceId].data).toEqual(json(data))
    }
    expect(await h.bridge.save()).toBe(true)
    expect(h.driver.load(h.disk.get('saved.glx')!)).toEqual(h.model())
    expect(h.first.read().undoDepth).toBe(3)
  } finally { h.bridge.dispose() }
})
