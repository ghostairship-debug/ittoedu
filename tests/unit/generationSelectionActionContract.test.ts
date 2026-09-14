import { describe, expect, it } from 'vitest'
import { generationRequestSchema, generationSelectionActionSchema } from '@/shared/generationContract'
import { captureGenerationSnapshot } from '@/renderer/authoring/generation/generationSnapshot'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'

function fixture() {
  const document = createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), surface = document.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Expected Slide')
  surface.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({ id: 'selected', text: '说明' }), 0))
  const projection = projectEffectiveLayers({ project: document, locationId: document.startLocationId })
  const request = captureGenerationSnapshot({ document, projection, workspace: { version: 1, projectId: document.id, normalizedPath: '/selection.h5lesson' },
    sessionToken: { locationId: document.startLocationId, surfaceType: 'slide', revision: document.revision, generation: 1 },
    scope: 'selection', selectedIds: ['selected'], instruction: '修改说明', purpose: 'local-edit' })
  const destination = request.destinations.find(value => value.kind === 'update')!
  if (destination.kind !== 'update') throw new Error('Expected update')
  return { request, target: destination.target }
}

describe('optional strict request-bound selection actions', () => {
  it('keeps old requests readable and accepts exact selected operations without modifying the old wire', () => {
    const { request, target } = fixture()
    expect(generationRequestSchema.parse(request)).toEqual(request)
    expect(request).not.toHaveProperty('selectionActions')
    for (const operation of ['reorder', 'duplicate'] as const) {
      expect(generationRequestSchema.parse({ ...request, selectionActions: [{ operation, target }] }).selectionActions).toEqual([{ operation, target }])
    }
  })
  it('rejects unknown operations, extra grants, unselected targets and wider insert scopes', () => {
    const { request, target } = fixture()
    expect(generationSelectionActionSchema.safeParse({ operation: 'write-anywhere', target }).success).toBe(false)
    expect(generationSelectionActionSchema.safeParse({ operation: 'duplicate', target, owner: 'global' }).success).toBe(false)
    expect(generationRequestSchema.safeParse({ ...request, selectionActions: [{ operation: 'duplicate', target: { ...target, itemId: 'other' } }] }).success).toBe(false)
    const { itemId: _item, authoringAddress: _address, ...base } = target
    const destination = { kind: 'create' as const, scope: { ...base, parent: { kind: 'owner' as const }, insertion: { kind: 'after' as const, siblingId: target.itemId } } }
    const valid = { ...request, destinations: [...request.destinations, destination], selectionActions: [{ operation: 'insert-image-after', target, destination }] }
    expect(generationRequestSchema.safeParse(valid).success).toBe(true)
    expect(generationRequestSchema.safeParse({ ...valid, context: { reference: 'course' } }).success).toBe(false)
    const wider = { ...destination, scope: { ...destination.scope, insertion: { kind: 'append' } } }
    expect(generationRequestSchema.safeParse({ ...valid, destinations: [...request.destinations, wider], selectionActions: [{ operation: 'insert-image-after', target, destination: wider }] }).success).toBe(false)
  })
})
