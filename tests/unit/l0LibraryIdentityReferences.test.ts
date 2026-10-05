import { expect, it } from 'vitest'
import { extractComponentLibraryEntry, prepareComponentLibraryInsertion } from '../../src/core/components/library'
import { applyComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { isComponentVisibleAtSurface, type CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { ComponentRuntimeContext } from '../../src/shared/contracts/component-platform/runtime'
import type { InteractionRule, InteractionTrigger } from '../../src/shared/interactionTypes'
import { createComponentInteractionRuntime } from '../../src/renderer/interactions/componentInteractionRuntime'
import { flowParagraphAnchoredFrame } from '../../src/shared/flowParagraphAnchors'

const blank = (id: string, surfaceId: string): CourseProjectV10 => ({ schemaVersion: 10, id, revision: 0, title: id,
  definitions: {}, instances: {}, assets: {}, surfaces: [{ id: surfaceId, kind: 'flow', title: surfaceId, childIds: [] }],
  global: { underlay: [], overlay: [] } })
function copied() {
  const source = blank('source', 'source-page')
  source.definitions.content = { id: 'content', role: 'content', implementation: { kind: 'builtin', key: 'fixture' } }
  source.definitions.interactions = { id: 'interactions', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  source.instances = {
    button: { id: 'button', definitionId: 'content', data: { title: 'button', text: 'source-page' }, visibility: { mode: 'include', surfaceIds: ['source-page'] } },
    body: { id: 'body', definitionId: 'content', data: { text: 'body' } },
    overlay: { id: 'overlay', definitionId: 'content', data: { title: 'body' }, frame: { width: 80, height: 30, transform: [1, 0, 0, 1, 20, 40] },
      flowPlacement: { space: 'paper', plane: 'overlay', paragraphAnchor: { blockId: 'body', xRatio: .25, offsetY: 10 } } },
    behavior: { id: 'behavior', definitionId: 'interactions', data: { rules: [{ id: 'rule', name: 'button', enabled: true,
      trigger: { type: 'node.click', nodeId: 'button' }, conditions: [], actions: [{ id: 'action', start: 'after-previous', delayMs: 0,
        action: { type: 'course-state.set', key: 'answer', value: 'button' } }] }] } },
  }
  source.surfaces[0].childIds = Object.keys(source.instances)
  const extracted = extractComponentLibraryEntry(source, { assets: {}, components: {} },
    { id: 'entry', title: 'button', rootIds: [...source.surfaces[0].childIds] })
  const destination = blank('destination', 'target-page')
  const insertion = prepareComponentLibraryInsertion(destination, extracted.entry,
    { container: { kind: 'surface', surfaceId: 'target-page' }, index: 0, surfaceBindings: { 'source-page': 'target-page' } })
  return { source, entry: extracted.entry, destination, insertion, project: applyComponentOperation(destination, insertion.command) }
}

it('executes the copied button event once and ignores the old button identity while keeping prose unchanged', async () => {
  const { project, insertion, entry, destination } = copied(), behavior = project.instances[insertion.identities.instances.get('behavior')!]
  const listeners = new Map<string, () => void>(), observed: unknown[] = [], controller = new AbortController()
  const implementation = createComponentInteractionRuntime(() => ({ currentSurfaceId: () => 'target-page', currentStateId: () => null,
    courseState: { get: () => undefined, set() {} }, subscribeTrigger(trigger, listener) { const key = JSON.stringify(trigger); listeners.set(key, listener); return () => { listeners.delete(key) } },
    executeAction(action) { observed.push(action); return true }, report(message) { throw new Error(message) } }))
  const mounted = await implementation.mount({ instance: behavior, scope: { signal: controller.signal, isActive: () => true, cleanup() {} } } as unknown as ComponentRuntimeContext)
  const emit = (trigger: InteractionTrigger) => listeners.get(JSON.stringify(trigger))?.()
  try {
    emit({ type: 'node.click', nodeId: insertion.identities.instances.get('button')! })
    await Promise.resolve()
    expect(observed).toEqual([{ type: 'course-state.set', key: 'answer', value: 'button' }])
    emit({ type: 'node.click', nodeId: 'button' })
    await Promise.resolve()
    expect(observed).toHaveLength(1)
    expect(project.instances[insertion.identities.instances.get('button')!].data).toEqual({ title: 'button', text: 'source-page' })
    expect((behavior.data as { rules: { name: string }[] }).rules[0].name).toBe('button')
  } finally { await mounted.dispose() }
  const missingEntry = structuredClone(entry), missingRules = (missingEntry.example.instances.behavior.data as unknown as { rules: InteractionRule[] }).rules
  missingRules[0].trigger = { type: 'node.click', nodeId: 'external-button' }
  missingRules[0].actions[0].action = { type: 'location.go', locationId: 'external-page' }
  const missing = prepareComponentLibraryInsertion(destination, missingEntry, { container: { kind: 'surface', surfaceId: 'target-page' }, index: 0 })
  expect(missing.diagnostics.map(item => item.message)).toEqual(expect.arrayContaining(['互动尚未绑定目标对象：external-button', '互动尚未绑定目标页面：external-page']))
  const inserted = applyComponentOperation(destination, missing.command), retained = inserted.instances[missing.identities.instances.get('behavior')!].data as unknown as { rules: InteractionRule[] }
  expect(retained.rules[0].trigger).toEqual(missingRules[0].trigger)
  expect(retained.rules[0].actions[0].action).toEqual(missingRules[0].actions[0].action)
})

it('retains the visible scope after explicit source-to-target surface binding', () => {
  const { source, project, insertion, entry, destination } = copied(), original = source.instances.button
  const button = project.instances[insertion.identities.instances.get('button')!]
  expect(isComponentVisibleAtSurface(original, 'source-page')).toBe(true)
  expect(isComponentVisibleAtSurface(button, 'target-page')).toBe(true)
  expect(isComponentVisibleAtSurface(button, 'source-page')).toBe(false)
  expect(insertion.diagnostics).toEqual([])
  const unresolved = prepareComponentLibraryInsertion(destination, entry, { container: { kind: 'surface', surfaceId: 'target-page' }, index: 0 })
  expect(unresolved.diagnostics).toContainEqual(expect.objectContaining({ code: 'surface-binding-required', message: '可见范围尚未绑定目标页面：source-page' }))
  expect(applyComponentOperation(destination, unresolved.command).instances[unresolved.identities.instances.get('button')!].visibility).toEqual(original.visibility)
})

it('projects the copied Flow overlay through the new body anchor and follows the actual paragraph layout movement', () => {
  const { project, insertion, entry, destination } = copied(), overlay = project.instances[insertion.identities.instances.get('overlay')!]
  const anchor = overlay.flowPlacement!.paragraphAnchor!, frame = { x: 20, y: 40, width: 80, height: 30 }
  const bodyId = insertion.identities.instances.get('body')!
  const blocks = [{ blockId: bodyId, depth: 0, x: 0, y: 100, width: 400, height: 40 }]
  expect(flowParagraphAnchoredFrame(anchor, frame, 400, blocks)).toEqual({ ...frame, x: 100, y: 110 })
  expect(flowParagraphAnchoredFrame(anchor, frame, 400, [{ ...blocks[0], y: 180 }])).toEqual({ ...frame, x: 100, y: 190 })
  expect(overlay.data).toEqual({ title: 'body' })
  const unresolvedEntry = structuredClone(entry)
  delete unresolvedEntry.example.instances.body
  unresolvedEntry.example.rootIds = unresolvedEntry.example.rootIds.filter(id => id !== 'body')
  const unresolved = prepareComponentLibraryInsertion(destination, unresolvedEntry, { container: { kind: 'surface', surfaceId: 'target-page' }, index: 0 })
  expect(unresolved.diagnostics).toContainEqual(expect.objectContaining({ code: 'anchor-binding-required', message: '随段落对象尚未绑定目标段落：body' }))
  expect(applyComponentOperation(destination, unresolved.command).instances[unresolved.identities.instances.get('overlay')!].flowPlacement?.paragraphAnchor?.blockId).toBe('body')
})
