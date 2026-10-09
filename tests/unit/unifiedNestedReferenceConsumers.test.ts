// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createCurrentSelectionFixture } from '../helpers/g20CurrentSelectionFixture'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentRuleEdits, interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import type { InteractionRule } from '../../src/shared/interactionTypes'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { findCompositionNode } from '../../src/shared/composition/content'
import { collectCourseProjectControllerMediaHealth, collectCourseProjectRuntimeHealth } from '../../src/shared/courseProjectHealth'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'
import { compositionFragmentFixture } from '../helpers/compositionFragmentFixture'

function counter(item: CompositionLayerItem) {
  const value = findCompositionNode(item.content.root, 'counter')
  if (value?.kind !== 'runtime') throw new Error('Expected nested Runtime')
  return value
}

function operation(snapshot: DocumentSnapshot, mutation: { type: 'undo' | 'redo' }) {
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
    operationId: randomUUID(), actor: 'human' as const, mutation }
}

it('deletes a nested current instance through Gateway, repairs declared behavior references and completion followers, and preserves Undo, Redo and saved bytes', async () => {
  const fixture = createCurrentSelectionFixture()
  let project = fixture.project
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.instances.parent = { id: 'parent', definitionId: 'group', data: {}, childIds: ['scene-text', 'scene-other'] }
  project.surfaces[0].childIds = ['parent']
  const owner = { kind: 'instance' as const, instanceId: 'parent' }
  const step = (id: string, nodeId: string) => ({ id, start: 'after-previous' as const, delayMs: 0,
    action: { type: 'node.exit' as const, nodeId, durationMs: 0, easing: 'linear' as const, effect: 'none' as const } })
  const originalRules: InteractionRule[] = [
    { id: 'retained-rule', enabled: true, trigger: { type: 'node.click', nodeId: 'scene-text' }, conditions: [],
      actions: [step('removed-action', 'scene-other'), { ...step('retained-action', 'scene-text'), start: 'with-previous' }] },
    { id: 'removed-trigger', enabled: true, trigger: { type: 'node.click', nodeId: 'scene-other' }, conditions: [], actions: [step('trigger-action', 'scene-text')] },
    { id: 'removed-follower', enabled: true, trigger: { type: 'animation.completed', actionId: 'removed-action' }, conditions: [], actions: [step('follower-action', 'scene-text')] },
  ]
  project = applyComponentOperation(project, captureComponentOperation(project, componentRuleEdits(project, owner, originalRules)))
  const model = { kind: 'course-v10' as const, project, resources: fixture.model.resources }
  let saved: Uint8Array | undefined
  const persistence: DocumentPersistence = { async append() {}, async save(input) {
    saved = input.bytes; if (input.binding.kind !== 'file') throw new Error('Expected file binding')
    return { ...input.binding, version: 'saved' }
  } }
  const driver = new CourseV10Driver()
  const registry = new DocumentRegistry({ drivers: [driver], persistence, createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create(model, 'nested-references.glx'), gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const target = { kind: 'course-instance' as const, surfaceId: fixture.surfaceId, instanceId: 'scene-other', stateId: null }
  await gateway.beginRun({ runId: 'delete', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const handle = await gateway.issueTarget('delete', session.documentId, target)
  expect(await gateway.execute('delete', 'remove-bound-target', { name: 'object.structure', input: { target: handle, action: 'remove' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const current = () => { const value = session.read().model; if (value.kind !== 'course-v10') throw new Error('Expected current course'); return value }
  const rules = () => interactionRules(interactionBehavior(current().project, owner))
  expect(session.read().undoDepth).toBe(1)
  expect(current().project.instances.parent.childIds).toEqual(['scene-text'])
  expect(rules()).toEqual([{ ...originalRules[0], actions: [step('retained-action', 'scene-text')] }])
  expect(current().project.instances['scene-text']).toEqual(model.project.instances['scene-text'])
  expect(current().project.instances['flow-paragraph']).toEqual(model.project.instances['flow-paragraph'])
  expect(await session.execute(operation(session.read(), { type: 'undo' }))).toMatchObject({ status: 'applied' })
  expect(rules()).toEqual(originalRules)
  expect(current().project.instances.parent.childIds).toEqual(['scene-text', 'scene-other'])
  expect(await session.execute(operation(session.read(), { type: 'redo' }))).toMatchObject({ status: 'applied' })
  await registry.save(session.documentId, { kind: 'file', path: 'nested-references.glx', version: null, bindingVersion: 0 })
  const reopened = driver.load(saved!)
  if (reopened.kind !== 'course-v10') throw new Error('Expected current course')
  expect(interactionRules(interactionBehavior(reopened.project, owner))).toEqual(rules())
  expect(reopened.resources).toEqual(model.resources)
})

it('reports missing bindings and fallbacks at the nested Runtime source with the existing diagnostic levels', () => {
  const source = compositionFragmentFixture()
  counter(source.item).runtime.nodeBindings = { missing: 'missing-layer', valid: source.item.layerItemId }
  const findings = collectCourseProjectRuntimeHealth(source.project, { assetFiles: source.assetFiles, componentFiles: {} })
  expect(findings.map(finding => ({ code: finding.code, severity: finding.severity }))).toEqual([
    { code: 'runtime-node-reference-missing', severity: 'error' },
    { code: 'runtime-static-fallback-missing', severity: 'warning' },
  ])
  expect(findings.every(finding => finding.layerItemId === source.item.layerItemId)).toBe(true)
  expect(findings[0]!.path.slice(-3)).toEqual(['runtime', 'nodeBindings', 'missing'])
  expect(findings[1]!.path.slice(-2)).toEqual(['runtime', 'staticFallback'])
})

it('keeps unused assets informational and accounts only for mounted enabled nested Runtime consumers', () => {
  const source = compositionFragmentFixture()
  source.project.assets['unlisted-asset'] = { ...source.project.assets['source-photo']!, id: 'unlisted-asset', path: 'assets/unlisted.png' }
  const assetFiles = { ...source.assetFiles, 'unlisted-asset': source.assetFiles['source-photo'] }
  const unused = (project = source.project) => collectCourseProjectControllerMediaHealth(project, { assetFiles, componentFiles: {} })
    .filter(finding => finding.code === 'asset-unused' && finding.path.at(-1) === 'unlisted-asset')
  expect(unused()).toEqual([])
  for (const mode of ['disabled', 'state-hidden', 'out-of-scope']) {
    const project = structuredClone(source.project), slide = project.surfaces.find(surface => surface.type === 'slide')!
    const item = slide.scenes[0]!.layerItems[0] as CompositionLayerItem
    if (mode === 'disabled') counter(item).runtime.enabled = false
    else if (mode === 'state-hidden') slide.scenes[0]!.presentation!.states.forEach(state => {
      state.layerItemOverrides[item.layerItemId] = { visible: false }
    })
    else {
      slide.scenes[0]!.layerItems = []
      project.globalLayerItems.push({ item, visibility: { mode: 'exclude', locationIds: [project.startLocationId] } })
    }
    expect(unused(project), mode).toEqual([expect.objectContaining({ severity: 'info', code: 'asset-unused' })])
  }
})
