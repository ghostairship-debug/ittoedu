import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { prepareCourseObjectPaste } from '../../src/renderer/composition/crossSurfaceCommands'
import { duplicateSurfaceEdits } from '../../src/renderer/store/slices/courseStructureSlice'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { importComponentLibraryArchive } from '../../src/core/components/library/archive'
import { createComponentInteractionRuntime } from '../../src/renderer/interactions/componentInteractionRuntime'
import { isComponentVisibleAtSurface, type ComponentInstance, type CourseProjectV10, type JsonObject } from '../../src/shared/contracts/component-platform/project'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { ComponentRuntimeContext } from '../../src/shared/contracts/component-platform/runtime'
import type { InteractionTrigger } from '../../src/shared/interactionTypes'
import type { DocumentResources } from '../../src/shared/workbench/document'

const emptyResources = (): DocumentResources => ({ assets: {}, components: {} })
const blank = (id: string, page: string): CourseProjectV10 => ({ schemaVersion: 10, id, revision: 0, title: id, definitions: {}, instances: {}, assets: {},
  surfaces: [{ id: page, kind: 'slide', title: page, childIds: [] }], global: { underlay: [], overlay: [] } })
const capture = (project: CourseProjectV10, resources = emptyResources()): CapturedCourseTarget => ({ documentId: project.id, epoch: 'epoch',
  project, editingProject: project, resources, activeStateId: null, surfaceId: project.surfaces[0].id, instanceIds: [], instanceId: null })
const rules = () => ({ rules: [{ id: 'rule', enabled: true, trigger: { type: 'node.click', nodeId: 'button' }, conditions: [],
  actions: [{ id: 'action', start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'answer', value: 'button' } }] }] })

async function proveEvents(behavior: ComponentInstance, newButton: string, surfaceId: string) {
  const listeners = new Map<string, () => void>(), actions: unknown[] = []
  const runtime = createComponentInteractionRuntime(() => ({ currentSurfaceId: () => surfaceId, currentStateId: () => null,
    courseState: { get: () => undefined, set() {} }, subscribeTrigger(trigger, listener) {
      const key = JSON.stringify(trigger); listeners.set(key, listener); return () => { listeners.delete(key) }
    }, executeAction(action) { actions.push(action); return true }, report(message) { throw new Error(message) } }))
  const mounted = await runtime.mount({ instance: behavior, scope: { signal: new AbortController().signal, isActive: () => true,
    events: { subscribe: () => () => undefined }, cleanup() {} } } as unknown as ComponentRuntimeContext)
  const emit = async (trigger: InteractionTrigger) => { listeners.get(JSON.stringify(trigger))?.(); await new Promise(resolve => setTimeout(resolve, 0)) }
  try {
    await emit({ type: 'node.click', nodeId: newButton })
    expect(actions).toEqual([{ type: 'course-state.set', key: 'answer', value: 'button' }])
    await emit({ type: 'node.click', nodeId: 'button' })
    expect(actions).toHaveLength(1)
  } finally { await mounted.dispose() }
}

it('remaps professional aliases and source metadata for clipboard and page copies through the real interaction executor', async () => {
  for (const sourceImplementation of [false, true]) {
    const source = blank('source', 'source-page'), destination = blank('target', 'target-page')
    source.definitions.content = { id: 'content', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
    source.definitions.alias = { id: 'alias', role: 'behavior', professionalBuiltinKey: 'guoling.interactions', implementation: sourceImplementation
      ? { kind: 'source', language: 'javascript', source: 'export default {}' } : { kind: 'builtin', key: 'guoling.interactions' } }
    source.instances.button = { id: 'button', definitionId: 'content', data: { title: 'button', text: 'source-page' } }
    source.instances.behavior = { id: 'behavior', definitionId: 'alias', data: rules(),
      attachments: [{ instanceId: 'behavior', target: { kind: 'surface', surfaceId: 'source-page' } }] }
    source.surfaces[0].childIds = ['button', 'behavior']
    source.instances.decoration = { id: 'decoration', definitionId: 'content', data: { title: '共享装饰' }, visibility: { mode: 'include', surfaceIds: ['source-page'] } }
    source.global.overlay = ['decoration']
    source.surfaces[0].presentation = { states: [{ id: 'answer-state', title: '答案', overrides: { behavior: { data: rules() } } }] }
    const original = structuredClone(source)
    const plan = prepareCourseObjectPaste({ documentId: source.id, project: source, roots: ['button', 'behavior'], resources: emptyResources() },
      { capturedTarget: capture(destination), container: { kind: 'surface', surfaceId: 'target-page' }, index: 0 })
    const copied = applyComponentOperation(destination, captureComponentOperation(destination, plan.edits))
    const behavior = copied.instances[plan.idMap.get('behavior')!]
    expect(behavior.attachments).toEqual([{ instanceId: behavior.id, target: { kind: 'surface', surfaceId: 'target-page' } }])
    expect(copied.instances[plan.idMap.get('button')!].data).toEqual(source.instances.button.data)
    expect((behavior.data as JsonObject).rules).not.toEqual((source.instances.behavior.data as JsonObject).rules)
    await proveEvents(behavior, plan.idMap.get('button')!, 'target-page')
    let serial = 0
    const pagePlan = duplicateSurfaceEdits(source, 'source-page', () => `copy-${++serial}`)
    const pages = applyComponentOperation(source, captureComponentOperation(source, pagePlan.edits))
    const page = pages.surfaces.find(value => value.id === pagePlan.surfaceId)!, [buttonId, behaviorId] = page.childIds
    expect(pages.surfaces.map(value => value.id)).toEqual(['source-page', page.id])
    expect(pages.global.overlay).toEqual(['decoration'])
    expect(pages.instances.decoration.visibility?.surfaceIds).toEqual(['source-page', page.id])
    expect(pages.instances[buttonId].data).toEqual(source.instances.button.data)
    await proveEvents(pages.instances[behaviorId], buttonId, page.id)
    const stateData = page.presentation!.states[0].overrides[behaviorId].data as unknown as ReturnType<typeof rules>
    expect(stateData.rules[0].trigger.nodeId).toBe(buttonId)
    expect(stateData.rules[0].actions[0].action.value).toBe('button')
    expect(source).toEqual(original)
  }
})

it('maps the actual source and target surfaces for cross-document visibility while preserving unrelated scope and Flow anchors', () => {
  const source = blank('source', 'source-page'), destination = blank('target', 'target-page')
  source.surfaces[0].kind = destination.surfaces[0].kind = 'flow'
  source.definitions.content = { id: 'content', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  source.instances.body = { id: 'body', definitionId: 'content', data: { text: 'source-page' } }
  source.instances.overlay = { id: 'overlay', definitionId: 'content', data: { title: 'body' }, frame: { width: 80, height: 30, transform: [1, 0, 0, 1, 20, 40] },
    visibility: { mode: 'include', surfaceIds: ['source-page', 'external-page'] },
    flowPlacement: { space: 'paper', plane: 'overlay', paragraphAnchor: { blockId: 'body', xRatio: .25, offsetY: 10 } } }
  source.surfaces[0].childIds = ['body', 'overlay']
  const plan = prepareCourseObjectPaste({ documentId: source.id, project: source, roots: ['body', 'overlay'], resources: emptyResources() },
    { capturedTarget: capture(destination), container: { kind: 'surface', surfaceId: 'target-page' }, index: 0 })
  const copied = applyComponentOperation(destination, captureComponentOperation(destination, plan.edits)), overlay = copied.instances[plan.idMap.get('overlay')!]
  expect(isComponentVisibleAtSurface(source.instances.overlay, 'source-page')).toBe(true)
  expect(isComponentVisibleAtSurface(overlay, 'target-page')).toBe(true)
  expect(isComponentVisibleAtSurface(overlay, 'source-page')).toBe(false)
  expect(overlay.visibility).toEqual({ mode: 'include', surfaceIds: ['target-page', 'external-page'] })
  expect(overlay.flowPlacement?.paragraphAnchor?.blockId).toBe(plan.idMap.get('body'))
  expect(overlay.frame).toEqual(source.instances.overlay.frame)
  expect(overlay.data).toEqual({ title: 'body' })
  const sameDocument = prepareCourseObjectPaste({ documentId: source.id, project: source, roots: ['overlay'], resources: emptyResources() },
    { capturedTarget: capture(source), container: { kind: 'surface', surfaceId: 'source-page' }, index: 2 })
  const inserted = sameDocument.edits.find(edit => edit.type === 'instance.insert')!
  if (inserted.type !== 'instance.insert') throw new Error('Expected insertion')
  expect(inserted.instances[0].visibility).toEqual(source.instances.overlay.visibility)
})

it('keeps cross-document missing assets unresolved instead of binding destination bytes and preserves empty fields and real copied resources', async () => {
  const source = blank('source', 'source-page'), destination = blank('target', 'target-page'), resources = emptyResources(), targetResources = emptyResources()
  const { entry } = importComponentLibraryArchive(await fs.readFile(path.join(process.cwd(), 'resources/built-in-components/packages/image-frame.h5component')))
  source.definitions.image = { ...entry.definitions['com.ittoedu.visual.image-frame'], id: 'image' }
  resources.components = structuredClone(entry.resources.components)
  destination.definitions.image = { id: 'image', role: 'content', title: '目标工程共享定义', implementation: { kind: 'builtin', key: 'guoling.text' } }
  const ids = ['missing-photo', 'declared-no-bytes', 'source-image', '']
  ids.forEach((assetId, index) => { const id = `picture-${index}`; source.instances[id] = { id, definitionId: 'image',
    data: { ...(entry.example.instances.example.data as JsonObject), assetId, originalAssetId: '', title: assetId } }; source.surfaces[0].childIds.push(id) })
  for (const id of ids.filter(Boolean)) {
    destination.assets[id] = { id, path: `assets/target-${id}.png`, mimeType: 'image/png' }
    targetResources.assets[id] = new Uint8Array([1])
  }
  for (const id of ['declared-no-bytes', 'source-image']) source.assets[id] = { id, path: `assets/${id}.png`, mimeType: 'image/png' }
  resources.assets['source-image'] = new Uint8Array([9])
  const before = structuredClone(destination), plan = prepareCourseObjectPaste({ documentId: source.id, project: source, roots: source.surfaces[0].childIds, resources },
    { capturedTarget: capture(destination, targetResources), container: { kind: 'surface', surfaceId: 'target-page' }, index: 0 })
  expect(plan.diagnostics.map(value => value.message).sort()).toEqual(['保留了待修复的素材引用：declared-no-bytes', '保留了待修复的素材引用：missing-photo'])
  expect(plan.assetIds.has('')).toBe(false)
  const driver = new CourseV10Driver(), model = driver.apply({ kind: 'course-v10', project: destination, resources: targetResources }, captureComponentOperation(destination, plan.edits))
  if (model.kind !== 'course-v10') throw new Error('Expected course')
  for (const oldId of ['missing-photo', 'declared-no-bytes']) {
    const rebound = plan.assetIds.get(oldId)!
    expect(rebound).not.toBe(oldId)
    expect(model.project.assets[rebound]).toBeUndefined()
    expect(model.resources.assets[rebound]).toBeUndefined()
  }
  expect(model.project.instances[plan.idMap.get('picture-0')!].data).toEqual({ ...(source.instances['picture-0'].data as JsonObject), assetId: plan.assetIds.get('missing-photo') })
  expect(model.project.instances[plan.idMap.get('picture-3')!].data).toEqual(source.instances['picture-3'].data)
  expect(model.resources.assets[plan.assetIds.get('source-image')!]).toEqual(new Uint8Array([9]))
  for (const oldId of ids.filter(Boolean)) {
    expect(model.project.assets[oldId]).toEqual(before.assets[oldId])
    expect(model.resources.assets[oldId]).toEqual(new Uint8Array([1]))
  }
  expect(destination).toEqual(before)
  expect(model.project.definitions.image).toEqual(before.definitions.image)
})
