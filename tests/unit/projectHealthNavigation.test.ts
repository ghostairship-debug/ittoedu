import { describe, expect, it } from 'vitest'
import { createTextNode } from '../../src/renderer/project/nativeNodeFactories'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import {
  resolveCourseProjectDiagnosticTargetRoute,
  resolveCourseProjectHealthRoute,
} from '../../src/renderer/diagnostics/projectHealthNavigation'
import type { CourseProjectHealthFinding } from '../../src/shared/courseProjectHealth'

describe('resolveCourseProjectDiagnosticTargetRoute', () => {
  it('routes a stable scene layer identity to its V9 location and authoring item', () => {
    const project = createBlankCourseProject()
    const location = project.locations[0]
    const surface = project.surfaces[0]
    if (!location || location.kind !== 'slide-scene' || !surface || surface.type !== 'slide') {
      throw new Error('expected blank Slide project')
    }
    const layerItem = sceneNodeToCourseLayerItem(createTextNode({ id: 'stable-text' }), 1)
    surface.scenes[0]!.layerItems.push(layerItem)
    const layerItemId = layerItem.layerItemId
    expect(resolveCourseProjectDiagnosticTargetRoute(project, {
      version: 1,
      kind: 'layer-item',
      owner: 'scene',
      projectId: project.id,
      surfaceId: surface.id,
      sceneId: location.sceneId,
      layerItemId,
    }, 'project-health:asset-reference-missing')).toEqual({
      scope: 'scene',
      tab: 'properties',
      locationId: location.id,
      layerItemId,
    })
  })

  it('routes a stable Flow block and component package to their V9 UI surfaces', () => {
    const project = createBlankFlowCourseProject()
    const location = project.locations[0]
    if (!location || location.kind !== 'flow-block') throw new Error('expected Flow location')
    expect(resolveCourseProjectDiagnosticTargetRoute(project, {
      version: 1,
      kind: 'flow-block',
      projectId: project.id,
      surfaceId: location.surfaceId,
      blockId: location.blockId,
    })).toEqual({
      scope: 'scene',
      tab: 'properties',
      locationId: location.id,
    })
    expect(resolveCourseProjectDiagnosticTargetRoute(project, {
      version: 1,
      kind: 'component-package',
      projectId: project.id,
      packageId: 'quiz',
      packageVersion: '1.0.0',
    })).toEqual({ scope: 'scene', tab: 'components' })
  })

  it('routes project-level global interaction findings to global automation', () => {
    const project = createBlankCourseProject()
    expect(resolveCourseProjectDiagnosticTargetRoute(project, {
      version: 1,
      kind: 'project',
      projectId: project.id,
    }, 'project-health:interaction-action-reference-missing', [
      'globalInteractions',
      0,
      'actions',
      0,
    ])).toEqual({
      scope: 'global',
      tab: 'automation',
    })
  })

  it('routes a V9 health finding from its catalog target', () => {
    const project = createBlankCourseProject()
    const finding: CourseProjectHealthFinding = {
      severity: 'error',
      code: 'asset-kind-mismatch',
      message: '素材类型不匹配',
      path: ['assets', 'hero'],
      target: {
        version: 1,
        kind: 'asset',
        projectId: project.id,
        assetId: 'hero',
      },
    }
    expect(resolveCourseProjectHealthRoute(project, finding)).toEqual({
      scope: 'scene',
      tab: 'elements',
    })
  })
})
