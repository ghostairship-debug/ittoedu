import { describe, expect, it } from 'vitest'
import { resolveCourseProjectDiagnosticTargetRoute, resolveCourseProjectDeliveryFindingRoute, resolveCourseProjectHealthRoute } from '../../src/renderer/diagnostics/projectHealthNavigation'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'

const fixture = (): CourseProjectV10 => ({
  schemaVersion: 10, id: 'health', revision: 0, title: '工程',
  definitions: { group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } } },
  instances: {
    group: { id: 'group', definitionId: 'group', data: {}, childIds: ['nested'] },
    nested: { id: 'nested', definitionId: 'group', data: {} },
    globalGroup: { id: 'globalGroup', definitionId: 'group', data: {}, childIds: ['globalNested'] },
    globalNested: { id: 'globalNested', definitionId: 'group', data: {} },
  },
  surfaces: [{ id: 'slide', kind: 'slide', title: '第1页', childIds: ['group'] }],
  global: { underlay: [], overlay: ['globalGroup'] }, assets: { hero: { id: 'hero', path: 'hero.png' } },
})

describe('current V10 project diagnostic routes', () => {
  it('follows nested ownership to the actual surface or global scope for health and delivery', () => {
    const project = fixture()
    const expected = { available: true, scope: 'scene', tab: 'properties', surfaceId: 'slide', instanceId: 'nested' }
    expect(resolveCourseProjectHealthRoute(project, { severity: 'error', code: 'image-asset-reference-missing', message: '缺素材',
      path: ['instances', 'nested', 'data', 'assetId'], target: { projectId: project.id, kind: 'instance', instanceId: 'nested' } })).toEqual(expected)
    expect(resolveCourseProjectDeliveryFindingRoute(project, { code: 'image-output', surfaceId: 'wrong-surface', path: ['instances', 'nested'] })).toEqual(expected)
    expect(resolveCourseProjectDeliveryFindingRoute(project, { code: 'source-output', instanceId: 'globalNested' })).toEqual({
      available: true, scope: 'global', tab: 'properties', instanceId: 'globalNested',
    })
  })

  it('uses current project, surface, asset and definition views without inferring an instance', () => {
    const project = fixture()
    expect(resolveCourseProjectDiagnosticTargetRoute(project, { projectId: project.id, kind: 'project' })).toEqual({ available: true, scope: 'global', tab: 'properties' })
    expect(resolveCourseProjectDiagnosticTargetRoute(project, { projectId: project.id, kind: 'surface', surfaceId: 'slide' })).toEqual({ available: true, scope: 'scene', tab: 'properties', surfaceId: 'slide' })
    expect(resolveCourseProjectDiagnosticTargetRoute(project, { projectId: project.id, kind: 'asset', assetId: 'hero' })).toEqual({ available: true, scope: 'scene', tab: 'elements' })
    expect(resolveCourseProjectDeliveryFindingRoute(project, { code: 'source-build', path: ['definitions', 'group'] })).toEqual({ available: true, scope: 'scene', tab: 'components' })
  })

  it('reports unavailable for foreign, deleted and unowned identities instead of choosing a substitute', () => {
    const project = fixture()
    expect(resolveCourseProjectDiagnosticTargetRoute(project, { projectId: 'other', kind: 'instance', instanceId: 'nested' })).toMatchObject({ available: false })
    delete project.instances.nested
    expect(resolveCourseProjectDeliveryFindingRoute(project, { code: 'output', instanceId: 'nested', surfaceId: 'slide' })).toMatchObject({ available: false })
    expect(resolveCourseProjectDiagnosticTargetRoute(project, { projectId: project.id, kind: 'surface', surfaceId: 'deleted' })).toMatchObject({ available: false })
    expect(resolveCourseProjectDiagnosticTargetRoute(project, { projectId: project.id, kind: 'asset', assetId: 'deleted' })).toMatchObject({ available: false })
    project.global.overlay = []
    expect(resolveCourseProjectDeliveryFindingRoute(project, { code: 'output', instanceId: 'globalNested' })).toMatchObject({ available: false })
  })
})
