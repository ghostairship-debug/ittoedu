import { describe, expect, it } from 'vitest'
import { createSessionToken } from '@/renderer/authoring/courseAuthoringSession'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  COURSE_RUNTIME_SOURCE_AUTHORING_FIELD,
  selectRuntimeSourceAuthoringView,
} from '@/renderer/runtime/runtimeSourceAuthoringView'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'

const NOW = '2026-08-24T00:00:00.000Z'

type SurfaceKind = 'slide' | 'flow' | 'spatial'

function runtimeLayer(
  id: string,
  protocol: 'canvas-runtime' | 'surface-runtime',
): RuntimeLayerItem {
  return {
    kind: 'runtime',
    layerItemId: id,
    label: `Runtime ${id}`,
    frame: { mode: 'absolute', x: 20, y: 30, width: 640, height: 360 },
    order: 10,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    runtime: protocol === 'canvas-runtime'
      ? {
          protocol,
          runtimeApiVersion: 2,
          enabled: true,
          renderMode: 'hybrid',
          source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
          content: { values: { title: 'Canvas' } },
          assets: {},
          nodeBindings: { title: 'node-title' },
        }
      : {
          protocol,
          runtimeApiVersion: 3,
          enabled: false,
          renderMode: 'dom',
          source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {destroy(){}}}})',
          content: { values: { title: 'Surface' } },
          assets: {},
          nodeBindings: { title: 'node-title' },
        },
  }
}

function projectFor(
  kind: SurfaceKind,
  options: { readonly global?: boolean; readonly local?: boolean } = {},
): CourseProjectDocument {
  const base = createBlankCourseProject({
    id: `runtime-view-${kind}`,
    title: `Runtime view ${kind}`,
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  const globalItem = runtimeLayer('runtime-global', 'canvas-runtime')
  globalItem.order = 0
  if (kind === 'slide') {
    const surface = base.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    return courseProjectDocumentSchema.parse({
      ...base,
      globalLayerItems: options.global
        ? [{ item: globalItem, visibility: { mode: 'all', locationIds: [] } }]
        : [],
      surfaces: [{
        ...surface,
        scenes: [{
          ...surface.scenes[0]!,
          layerItems: options.local
            ? [runtimeLayer('runtime-slide', 'canvas-runtime')]
            : [],
        }],
      }],
    })
  }
  if (kind === 'flow') {
    const surfaceId = 'surface-flow'
    const blockId = 'flow-heading'
    return courseProjectDocumentSchema.parse({
      ...base,
      globalLayerItems: options.global
        ? [{ item: globalItem, visibility: { mode: 'all', locationIds: [] } }]
        : [],
      locations: [{
        id: 'location-flow',
        label: 'Flow',
        kind: 'flow-block',
        surfaceId,
        blockId,
      }],
      startLocationId: 'location-flow',
      surfaces: [{
        id: surfaceId,
        title: 'Flow',
        type: 'flow',
        layout: { readingWidth: 760, wideContentWidth: 1120 },
        surfaceLayerItems: options.local
          ? [{
              item: runtimeLayer('runtime-flow', 'surface-runtime'),
              visibility: { mode: 'all', locationIds: [] },
            }]
          : [],
        blocks: [{ id: blockId, type: 'heading', level: 1, text: 'Flow' }],
      }],
    })
  }
  const surfaceId = 'surface-spatial'
  const frameId = 'camera-home'
  return courseProjectDocumentSchema.parse({
    ...base,
    globalLayerItems: options.global
      ? [{ item: globalItem, visibility: { mode: 'all', locationIds: [] } }]
      : [],
    locations: [{
      id: 'location-spatial',
      label: 'Spatial',
      kind: 'spatial-camera',
      surfaceId,
      cameraFrameId: frameId,
    }],
    startLocationId: 'location-spatial',
    surfaces: [{
      id: surfaceId,
      title: 'Spatial',
      type: 'spatial-2d',
      surfaceLayerItems: [],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: options.local
          ? [runtimeLayer('runtime-world', 'surface-runtime')]
          : [],
      },
      camera: {
        home: { x: 0, y: 0, zoom: 1 },
        frames: [{ id: frameId, name: 'Home', x: 0, y: 0, zoom: 1 }],
      },
      semanticZoom: [],
    }],
  })
}

function select(
  project: CourseProjectDocument,
  editingScope: 'scene' | 'global',
  activeStateId?: string | null,
) {
  const location = project.locations[0]!
  const surface = project.surfaces[0]!
  return selectRuntimeSourceAuthoringView({
    project,
    locationId: location.id,
    editingScope,
    activeStateId,
    sessionToken: createSessionToken({
      locationId: location.id,
      surfaceType: surface.type,
      revision: project.revision,
    }, 7),
  })
}

describe('selectRuntimeSourceAuthoringView', () => {
  it.each([
    ['slide', 'slide-scene', 'runtime-slide', 'canvas-runtime', 2],
    ['flow', 'surface-layer', 'runtime-flow', 'surface-runtime', 3],
    ['spatial', 'spatial-world', 'runtime-world', 'surface-runtime', 3],
  ] as const)(
    'maps %s local scope to its real %s Runtime carrier',
    (kind, carrier, itemId, protocol, api) => {
      const project = projectFor(kind, { local: true })
      const view = select(project, 'scene')

      expect(view).toMatchObject({
        availability: 'available',
        carrier,
        effectiveLocked: false,
        runtime: { protocol, runtimeApiVersion: api },
        target: {
          projectId: project.id,
          itemId,
          authoringAddress: expect.stringContaining(
            `field=${encodeURIComponent(COURSE_RUNTIME_SOURCE_AUTHORING_FIELD)}`,
          ),
        },
      })
      expect(view.documentKey).not.toBeNull()
      expect(JSON.stringify(view)).not.toContain('targetId')
      expect(JSON.stringify(view)).not.toContain('hitId')
    },
  )

  it.each(['slide', 'flow', 'spatial'] as const)(
    'maps %s global scope to the first project-global Runtime',
    (kind) => {
      const project = projectFor(kind, { global: true, local: true })
      const view = select(project, 'global')

      expect(view).toMatchObject({
        availability: 'available',
        carrier: 'global-layer',
        target: { owner: 'global', ownerKey: 'global', itemId: 'runtime-global' },
      })
    },
  )

  it('captures Slide effective lock but keeps one document key across named states', () => {
    const project = structuredClone(projectFor('slide', { local: true }))
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    const scene = surface.scenes[0]!
    scene.presentation = {
      initialStateId: 'state-a',
      states: [
        {
          id: 'state-a',
          name: 'A',
          layerItemOverrides: { 'runtime-slide': { locked: false } },
        },
        {
          id: 'state-b',
          name: 'B',
          layerItemOverrides: { 'runtime-slide': { locked: true } },
        },
      ],
    }
    scene.layerItems[0]!.locked = true
    const valid = courseProjectDocumentSchema.parse(project)
    const atA = select(valid, 'scene', 'state-a')
    const atB = select(valid, 'scene', 'state-b')

    expect(atA).toMatchObject({
      availability: 'available',
      effectiveLocked: false,
      target: { stateId: 'state-a' },
    })
    expect(atB).toMatchObject({
      availability: 'available',
      effectiveLocked: true,
      target: { stateId: 'state-b' },
    })
    expect(atA.documentKey).toBe(atB.documentKey)
  })

  it('returns a detached, deeply frozen canonical Runtime definition', () => {
    const project = projectFor('flow', { local: true })
    const view = select(project, 'scene')
    if (view.availability !== 'available') throw new Error('expected Runtime view')

    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.runtime)).toBe(true)
    expect(Object.isFrozen(view.runtime.content.values)).toBe(true)
    expect(Object.isFrozen(view.target)).toBe(true)
    expect(view.runtime).not.toBe(
      project.surfaces[0]!.surfaceLayerItems[0]!.item.kind === 'runtime'
        ? project.surfaces[0]!.surfaceLayerItems[0]!.item.runtime
        : null,
    )
  })

  it('reports missing Runtime honestly and never treats a Flow block as a carrier', () => {
    const project = projectFor('flow')
    const surface = project.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('expected Flow')
    surface.blocks.push({
      id: 'looks-like-runtime',
      type: 'code',
      language: 'javascript',
      code: 'CoursewareRuntime.define({})',
    })

    expect(select(project, 'scene')).toEqual({
      availability: 'unavailable',
      reason: 'runtime-missing',
      label: 'Flow · Flow 尚未创建 Runtime',
      documentKey: null,
      creationTarget: null,
    })
  })

  it.each([
    ['scene', 'scene', 'slide-scene'],
    ['global', 'global', null],
  ] as const)(
    'exposes an exact missing Slide %s Runtime creation slot',
    (editingScope, owner, expectedSceneId) => {
      const project = projectFor('slide')
      const location = project.locations[0]!
      const view = select(project, editingScope, 'state_initial')

      expect(view).toMatchObject({
        availability: 'unavailable',
        reason: 'runtime-missing',
        creationTarget: {
          projectId: project.id,
          documentRevision: project.revision,
          revisionPolicy: { kind: 'exact' },
          sessionGeneration: 7,
          surfaceType: 'slide',
          surfaceId: location.surfaceId,
          locationId: location.id,
          stateId: 'state_initial',
          owner,
          ownerKey: owner === 'global' ? 'global' : `scene:${location.id}`,
          sceneId: expectedSceneId === null ? null : location.id,
          slot: 'runtime-template',
        },
      })
      if (view.availability !== 'unavailable' || !view.creationTarget) {
        throw new Error('expected Runtime creation target')
      }
      expect(Object.isFrozen(view)).toBe(true)
      expect(Object.isFrozen(view.creationTarget)).toBe(true)
      expect(JSON.stringify(view.creationTarget)).not.toContain('itemId')
      expect(JSON.stringify(view.creationTarget)).not.toContain('authoringAddress')
    },
  )

  it.each(['flow', 'spatial'] as const)(
    'does not expose local or global Runtime creation while located on %s',
    (kind) => {
      const project = projectFor(kind)
      expect(select(project, 'scene')).toMatchObject({
        availability: 'unavailable',
        reason: 'runtime-missing',
        creationTarget: null,
      })
      expect(select(project, 'global')).toMatchObject({
        availability: 'unavailable',
        reason: 'runtime-missing',
        creationTarget: null,
      })
    },
  )

  it('rejects invalid location, stale session and invalid state without a target', () => {
    const project = projectFor('slide', { local: true })
    const location = project.locations[0]!
    const surface = project.surfaces[0]!
    const token = createSessionToken({
      locationId: location.id,
      surfaceType: surface.type,
      revision: project.revision,
    }, 1)

    expect(selectRuntimeSourceAuthoringView({
      project,
      locationId: 'missing-location',
      editingScope: 'scene',
      sessionToken: token,
    })).toMatchObject({
      availability: 'unavailable',
      reason: 'invalid-location',
      creationTarget: null,
    })
    expect(selectRuntimeSourceAuthoringView({
      project,
      locationId: location.id,
      editingScope: 'scene',
      sessionToken: { ...token, revision: token.revision + 1 },
    })).toMatchObject({
      availability: 'unavailable',
      reason: 'invalid-session',
      creationTarget: null,
    })
    expect(selectRuntimeSourceAuthoringView({
      project,
      locationId: location.id,
      editingScope: 'scene',
      activeStateId: 'missing-state',
      sessionToken: token,
    })).toMatchObject({
      availability: 'unavailable',
      reason: 'invalid-state',
      creationTarget: null,
    })
  })
})
