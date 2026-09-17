import { describe, expect, it } from 'vitest'
import { describeGenerationChanges } from '@/renderer/authoring/generation/generationPreview'

const layer = (id: string, label: string) => ({
  layerItemId: id,
  label,
  frame: { mode: 'absolute', x: id.charCodeAt(0), y: 10, width: 100, height: 40 },
  order: id.charCodeAt(0),
})

const slideProject = <T extends object, L extends object>(scenes: T[], locations: L[]) => ({
  schemaVersion: 9,
  id: 'project-1',
  revision: 4,
  title: '课程',
  locations,
  surfaces: [{ id: 'surface-1', type: 'slide', title: '演示', scenes }],
})

describe('generation semantic changes', () => {
  it('U09-identity-diff aligns formal entities by owner and stable id while ordinary arrays stay ordered', () => {
    const before = slideProject([{
      id: 'scene-1', name: '第一页', layerItems: [layer('a', '甲'), layer('b', '乙'), layer('c', '丙')],
      presentation: { initialStateId: 'state-1', states: [{ id: 'state-1', name: '初始', layerItemOverrides: {} }] },
      interactions: [],
    }], [{ id: 'location-1', kind: 'slide-scene', surfaceId: 'surface-1', sceneId: 'scene-1', label: '第一页' }])
    const after = structuredClone(before)
    const scene = after.surfaces[0]!.scenes[0]!
    scene.layerItems = [layer('b', '乙'), layer('a', '甲改'), layer('d', '丁')]
    ;(scene.layerItems[0] as ReturnType<typeof layer> & { choices?: unknown[] }).choices = [{ id: 'choice-2', text: '二' }, { id: 'choice-1', text: '一' }]
    ;(before.surfaces[0]!.scenes[0]!.layerItems[1] as ReturnType<typeof layer> & { choices?: unknown[] }).choices = [{ id: 'choice-1', text: '一' }, { id: 'choice-2', text: '二' }]

    const result = describeGenerationChanges(before, after, {})
    expect(result.changes.filter(change => change.kind === 'created').map(change => change.target?.id)).toContain('d')
    expect(result.changes.filter(change => change.kind === 'deleted').map(change => change.target?.id)).toContain('c')
    expect(result.changes.filter(change => change.kind === 'reordered').map(change => change.target?.id)).toEqual(expect.arrayContaining(['a', 'b']))
    expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'updated', field: 'label', before: '甲', after: '甲改',
      target: expect.objectContaining({ id: 'a', owner: 'scene', ownerKey: 'scene:scene-1', locationId: 'location-1' }) }))
    expect(result.changes.some(change => change.kind !== 'reordered' && /layerItems\.\d+\.(label|frame)/.test(change.path))).toBe(false)
    expect(result.changes).toContainEqual(expect.objectContaining({ path: expect.stringMatching(/choices\.0\.id$/), before: 'choice-1', after: 'choice-2' }))
  })

  it('U09-scope-resource traces named-state and shared resource impact and marks unprovided scopes partial', () => {
    const before = slideProject([{
      id: 'scene-1', name: '第一页', layerItems: [],
      presentation: { initialStateId: 'state-1', states: [
        { id: 'state-1', name: '初始', layerItemOverrides: {} },
        { id: 'state-answer', name: '答案', layerItemOverrides: {} },
      ] },
      interactions: [],
    }], [
      { id: 'location-1', kind: 'slide-scene', surfaceId: 'surface-1', sceneId: 'scene-1', label: '第一页' },
      { id: 'location-answer', kind: 'slide-scene', surfaceId: 'surface-1', sceneId: 'scene-1', stateId: 'state-answer', label: '答案态' },
    ])
    const after = structuredClone(before)
    after.surfaces[0]!.scenes[0]!.presentation.states[1]!.name = '解析答案'

    const complete = describeGenerationChanges(before, after, {
      beforeResources: { assetFiles: { image: Uint8Array.from([1, 2, 3]) }, componentPackages: { quiz: { source: 'old' } } },
      afterResources: { assetFiles: { image: Uint8Array.from([1, 4, 3]) }, componentPackages: { quiz: { source: 'new' } } },
    })
    expect(complete.comparison.status).toBe('complete')
    expect(complete.changes).toContainEqual(expect.objectContaining({ field: 'name', target: expect.objectContaining({
      entity: 'state', id: 'state-answer', stateId: 'state-answer', locationId: 'location-answer', ownerKey: 'state:scene-1:state-answer',
    }) }))
    expect(complete.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$resources.assetFiles.image', target: expect.objectContaining({ entity: 'resource-asset', impact: 'shared' }) }),
      expect.objectContaining({ path: '$resources.componentPackages.quiz', target: expect.objectContaining({ entity: 'resource-package', impact: 'shared' }) }),
    ]))
    expect(complete.changes.find(change => change.path === '$resources.assetFiles.image')).toEqual(expect.objectContaining({
      before: expect.stringContaining('fnv1a32:'), after: expect.stringContaining('fnv1a32:'),
    }))

    const withoutResources = describeGenerationChanges(before, before, {})
    expect(withoutResources.changes).toEqual([])
    expect(withoutResources.comparison).toEqual(expect.objectContaining({ status: 'partial', scopes: expect.arrayContaining([
      expect.objectContaining({ scope: 'resource-assets', status: 'not-provided' }),
      expect.objectContaining({ scope: 'resource-packages', status: 'not-provided' }),
    ]) }))
  })

  it('U09-truncation reports omitted changes, value truncation, and incomplete comparison scope', () => {
    const before = Object.fromEntries(Array.from({ length: 205 }, (_, index) => [`field-${index}`, index === 0 ? 'a'.repeat(600) : index]))
    const after = Object.fromEntries(Array.from({ length: 205 }, (_, index) => [`field-${index}`, index === 0 ? 'b'.repeat(600) : index + 1]))
    const result = describeGenerationChanges(before, after, {})

    expect(result.changes).toHaveLength(200)
    expect(result.omitted).toBe(5)
    expect(result.truncation).toEqual({ changeLimit: 200, valueLengthLimit: 500, omittedChanges: 5, truncatedValues: 2 })
    expect(result.changes[0]).toEqual(expect.objectContaining({ truncated: { before: true, after: true } }))
    expect(result.comparison.status).toBe('partial')
    expect(result.comparison.scopes.find(scope => scope.scope === 'document')?.status).toBe('complete')
  })
})
