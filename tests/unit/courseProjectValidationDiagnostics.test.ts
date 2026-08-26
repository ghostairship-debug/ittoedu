import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createRectangleNode } from '@/renderer/project/createProject'
import {
  COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION,
  COURSE_PROJECT_VALIDATION_FATAL_CODES,
  COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER,
  resolveSchemaValidCourseProjectDiagnosticTarget,
} from '@/shared/courseProjectValidationDiagnostics'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'

function projectWithSceneLayer() {
  const project = createBlankCourseProject({
    includeDefaultController: false,
    controls: 'none',
  })
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('expected slide surface')
  const scene = surface.scenes[0]
  if (!scene) throw new Error('expected slide scene')
  const item = sceneNodeToCourseLayerItem(createRectangleNode({
    id: 'diagnostic-layer',
    name: '诊断图层',
  }), 0)
  scene.layerItems.push(item)
  return { project, surface, scene, item }
}

describe('Course Project Validation DiagnosticTarget V1', () => {
  it('resolves array paths to stable V9 ids without retaining indexes', () => {
    const { project, surface, scene, item } = projectWithSceneLayer()

    const target = resolveSchemaValidCourseProjectDiagnosticTarget(project, {
      path: ['surfaces', 0, 'scenes', 0, 'layerItems', 0, 'frame'],
    })

    expect(target).toEqual({
      version: COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION,
      kind: 'layer-item',
      owner: 'scene',
      projectId: project.id,
      surfaceId: surface.id,
      sceneId: scene.id,
      layerItemId: item.layerItemId,
    })
    expect(JSON.stringify(target)).not.toContain('layerItems')
    expect(JSON.stringify(target)).not.toContain(':0')
  })

  it('uses finding metadata and falls back to the project for stale hints', () => {
    const { project, surface, item } = projectWithSceneLayer()

    expect(resolveSchemaValidCourseProjectDiagnosticTarget(project, {
      layerItemId: item.layerItemId,
    })).toMatchObject({
      version: 1,
      kind: 'layer-item',
      owner: 'scene',
      layerItemId: item.layerItemId,
    })
    expect(resolveSchemaValidCourseProjectDiagnosticTarget(project, {
      surfaceId: surface.id,
    })).toEqual({
      version: 1,
      kind: 'surface',
      projectId: project.id,
      surfaceId: surface.id,
    })
    expect(resolveSchemaValidCourseProjectDiagnosticTarget(project, {
      path: ['surfaces', 999, 'scenes', 999],
      surfaceId: 'stale-surface',
      layerItemId: 'stale-layer',
    })).toEqual({
      version: 1,
      kind: 'project',
      projectId: project.id,
    })
  })

  it('enumerates the complete report code surface with honest reachability', () => {
    expect(COURSE_PROJECT_VALIDATION_FATAL_CODES).toEqual([
      'archive-invalid',
      'input-unreadable',
      'schema-invalid',
      'unsupported-project-version',
      'usage-error',
      'validation-failed',
    ])
    expect(COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER.map(({ code }) => code)).toEqual([
      'asset-byte-length-mismatch',
      'asset-bytes-missing',
      'asset-metadata-missing',
      'component-asset-bytes-missing',
      'component-bytes-missing',
      'component-hash-mismatch',
      'component-manifest-identity-mismatch',
      'component-metadata-missing',
      'component-protocol',
      'duplicate-stable-id',
      'migration-marker',
      'online-remote-asset',
      'online-remote-url-invalid',
      'player-bundle-empty',
      'project-schema-invalid',
      'runtime-protocol',
      'static-export-info',
      'static-export-interactions-omitted',
      'static-export-preflight',
      'static-export-warning',
      'v8-field',
    ])
    expect(COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER.filter(
      ({ status }) => status === 'active',
    ).map(({ code }) => code)).toEqual([
      'duplicate-stable-id',
      'static-export-interactions-omitted',
    ])
    expect(new Set(COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER.map(
      ({ status }) => status,
    ))).toEqual(new Set([
      'active',
      'schema-shadowed',
      'archive-shadowed',
      'upstream-filtered',
    ]))
  })
})
