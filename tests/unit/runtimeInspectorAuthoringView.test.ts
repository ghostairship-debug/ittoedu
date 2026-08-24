import { describe, expect, it } from 'vitest'
import { createSessionToken } from '@/renderer/authoring/courseAuthoringSession'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  RUNTIME_INSPECTOR_AUTHORING_FIELDS,
  selectRuntimeInspectorAuthoringView,
} from '@/renderer/runtime/runtimeInspectorAuthoringView'
import { courseRuntimeContentValueAuthoringField } from '@/renderer/runtime/runtimeContentTextAuthoringCommands'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'

const NOW = '2026-08-24T00:00:00.000Z'
const CONTENT_KEY = 'title/a~b'
const ASSETS = {
  'asset-hero': {
    id: 'asset-hero',
    filename: 'hero.png',
    mimeType: 'image/png',
    kind: 'image' as const,
    path: 'assets/hero.png',
    byteLength: 4,
    width: 800,
    height: 600,
  },
  'asset-poster': {
    id: 'asset-poster',
    filename: 'poster.png',
    mimeType: 'image/png',
    kind: 'image' as const,
    path: 'assets/poster.png',
    byteLength: 4,
    width: 800,
    height: 600,
  },
}

type CarrierKind = 'global' | 'surface' | 'scene' | 'world'

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
    visible: false,
    locked: false,
    rotation: 4,
    opacity: 0.8,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'hidden',
    runtime: protocol === 'canvas-runtime'
      ? {
          protocol,
          runtimeApiVersion: 2,
          enabled: true,
          renderMode: 'hybrid',
          source: '/* 中文 */ CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
          content: {
            values: { [CONTENT_KEY]: 'Canvas 标题', preserved: '保留' },
            metadata: {
              [CONTENT_KEY]: {
                label: '标题',
                description: '可编辑标题',
                multiline: true,
                maxLength: 120,
              },
            },
          },
          assets: {
            hero: { assetId: 'asset-hero' },
            poster: { assetId: 'asset-poster' },
          },
          nodeBindings: { title: 'node-title' },
          staticFallback: { assetId: 'asset-poster', coverage: 'scene' },
        }
      : {
          protocol,
          runtimeApiVersion: 3,
          enabled: false,
          renderMode: 'dom',
          source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {destroy(){}}}})',
          content: {
            values: { [CONTENT_KEY]: 'Surface 标题', preserved: '保留' },
            metadata: { [CONTENT_KEY]: { label: '标题' } },
          },
          assets: { hero: { assetId: 'asset-hero' } },
          staticFallback: { assetId: 'asset-hero', coverage: 'surface' },
        },
  }
}

function fixture(kind: CarrierKind): {
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly editingScope: 'scene' | 'global'
  readonly itemId: string
} {
  const base = createBlankCourseProject({
    id: `runtime-inspector-${kind}`,
    title: `Runtime inspector ${kind}`,
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  const itemId = `runtime-${kind}`
  const globalItem = runtimeLayer(itemId, 'canvas-runtime')
  if (kind === 'global') {
    return {
      project: courseProjectDocumentSchema.parse({
        ...base,
        assets: ASSETS,
        globalLayerItems: [{
          item: globalItem,
          visibility: { mode: 'all', locationIds: [] },
        }],
      }),
      locationId: base.locations[0]!.id,
      editingScope: 'global',
      itemId,
    }
  }
  if (kind === 'scene') {
    const surface = base.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    return {
      project: courseProjectDocumentSchema.parse({
        ...base,
        assets: ASSETS,
        surfaces: [{
          ...surface,
          scenes: [{
            ...surface.scenes[0]!,
            layerItems: [runtimeLayer(itemId, 'canvas-runtime')],
          }],
        }],
      }),
      locationId: base.locations[0]!.id,
      editingScope: 'scene',
      itemId,
    }
  }
  if (kind === 'surface') {
    const surfaceId = 'surface-flow'
    const blockId = 'flow-heading'
    return {
      project: courseProjectDocumentSchema.parse({
        ...base,
        assets: ASSETS,
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
          surfaceLayerItems: [{
            item: runtimeLayer(itemId, 'surface-runtime'),
            visibility: { mode: 'all', locationIds: [] },
          }],
          blocks: [{ id: blockId, type: 'heading', level: 1, text: 'Flow' }],
        }],
      }),
      locationId: 'location-flow',
      editingScope: 'scene',
      itemId,
    }
  }
  const surfaceId = 'surface-spatial'
  const frameId = 'camera-home'
  return {
    project: courseProjectDocumentSchema.parse({
      ...base,
      assets: ASSETS,
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
          layerItems: [runtimeLayer(itemId, 'surface-runtime')],
        },
        camera: {
          home: { x: 0, y: 0, zoom: 1 },
          frames: [{ id: frameId, name: 'Home', x: 0, y: 0, zoom: 1 }],
        },
        semanticZoom: [],
      }],
    }),
    locationId: 'location-spatial',
    editingScope: 'scene',
    itemId,
  }
}

function select(
  source: ReturnType<typeof fixture>,
  activeStateId?: string | null,
) {
  const surface = source.project.surfaces[0]!
  return selectRuntimeInspectorAuthoringView({
    project: source.project,
    locationId: source.locationId,
    editingScope: source.editingScope,
    activeStateId,
    sessionToken: createSessionToken({
      locationId: source.locationId,
      surfaceType: surface.type,
      revision: source.project.revision,
    }, 9),
  })
}

describe('selectRuntimeInspectorAuthoringView', () => {
  it.each([
    ['global', 'global-layer', 'global', 'canvas-runtime', 2],
    ['surface', 'surface-layer', 'surface', 'surface-runtime', 3],
    ['scene', 'slide-scene', 'scene', 'canvas-runtime', 2],
    ['world', 'spatial-world', 'world', 'surface-runtime', 3],
  ] as const)(
    'maps %s to its canonical %s carrier and exact scalar targets',
    (kind, carrier, owner, protocol, runtimeApiVersion) => {
      const source = fixture(kind)
      const view = select(source)

      expect(view).toMatchObject({
        availability: 'available',
        carrier,
        protocol,
        runtimeApiVersion,
        effectiveLocked: false,
        enabledTarget: {
          field: 'enabled',
          initialValue: protocol === 'canvas-runtime',
          courseTarget: { owner, itemId: source.itemId },
        },
        renderModeTarget: {
          field: 'renderMode',
          initialValue: protocol === 'canvas-runtime' ? 'hybrid' : 'dom',
          courseTarget: { owner, itemId: source.itemId },
        },
      })
      if (view.availability !== 'available') throw new Error('expected view')
      expect(view.enabledTarget.courseTarget.authoringAddress).toContain(
        `field=${encodeURIComponent(RUNTIME_INSPECTOR_AUTHORING_FIELDS.enabled)}`,
      )
      expect(view.renderModeTarget.courseTarget.authoringAddress).toContain(
        `field=${encodeURIComponent(RUNTIME_INSPECTOR_AUTHORING_FIELDS.renderMode)}`,
      )
    },
  )

  it('projects exact summary values, metadata and B1-10 content targets', () => {
    const source = fixture('global')
    const view = select(source)
    if (view.availability !== 'available') throw new Error('expected view')

    expect(view.runtime).toMatchObject({
      enabled: true,
      renderMode: 'hybrid',
      nodeBindings: { title: 'node-title' },
    })
    expect(view.sourceBytes).toBe(new TextEncoder().encode(view.runtime.source).byteLength)
    expect(view.assetCount).toBe(2)
    expect(view.fallback).toEqual({ assetId: 'asset-poster', coverage: 'scene' })
    expect(view.contentFields).toHaveLength(2)
    expect(view.contentFields[0]).toMatchObject({
      key: CONTENT_KEY,
      value: 'Canvas 标题',
      metadata: {
        label: '标题',
        description: '可编辑标题',
        multiline: true,
        maxLength: 120,
      },
      target: {
        contentKey: CONTENT_KEY,
        initialValue: 'Canvas 标题',
        courseTarget: { itemId: source.itemId },
      },
    })
    expect(view.contentFields[0]!.target!.courseTarget.authoringAddress).toContain(
      `field=${encodeURIComponent(courseRuntimeContentValueAuthoringField(CONTENT_KEY))}`,
    )
    expect(view.contentFields[1]).not.toHaveProperty('metadata')
  })

  it('returns one detached deeply frozen inspector snapshot', () => {
    const source = fixture('scene')
    const view = select(source)
    if (view.availability !== 'available') throw new Error('expected view')

    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.runtime)).toBe(true)
    expect(Object.isFrozen(view.contentFields)).toBe(true)
    expect(Object.isFrozen(view.contentFields[0])).toBe(true)
    expect(Object.isFrozen(view.contentFields[0]!.metadata)).toBe(true)
    expect(Object.isFrozen(view.enabledTarget.courseTarget)).toBe(true)
    const surface = source.project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    const persisted = surface.scenes[0]!.layerItems[0]
    expect(persisted?.kind).toBe('runtime')
    if (persisted?.kind !== 'runtime') throw new Error('expected Runtime')
    expect(view.runtime).not.toBe(persisted.runtime)
    expect(view.contentFields[0]!.metadata).not.toBe(
      persisted.runtime.content.metadata?.[CONTENT_KEY],
    )
  })

  it('keeps schema-valid legacy content keys visible and read-only without inherited metadata', () => {
    const source = fixture('global')
    const project = structuredClone(source.project)
    const entry = project.globalLayerItems[0]?.item
    if (entry?.kind !== 'runtime') throw new Error('expected Runtime')
    const excessiveKey = 'x'.repeat(257)
    entry.runtime.content = {
      values: JSON.parse(JSON.stringify({
        constructor: '构造器文案',
        '': '空键文案',
        [excessiveKey]: '长键文案',
        safe: '安全文案',
      })) as Record<string, string>,
      metadata: {},
    }
    const parsed = courseProjectDocumentSchema.parse(project)
    const view = select({ ...source, project: parsed })
    if (view.availability !== 'available') throw new Error('expected view')

    for (const key of ['constructor', '', excessiveKey]) {
      expect(view.contentFields.find((field) => field.key === key)).toMatchObject({
        key,
        target: null,
        readonlyReason: expect.stringContaining('只读'),
      })
    }
    expect(view.contentFields.find((field) => field.key === 'constructor'))
      .not.toHaveProperty('metadata')
    expect(view.contentFields.find((field) => field.key === 'safe')?.target)
      .toMatchObject({ contentKey: 'safe', initialValue: '安全文案' })
  })

  it('uses named-state effective lock while keeping one inspector document key', () => {
    const source = fixture('scene')
    const project = structuredClone(source.project)
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    const scene = surface.scenes[0]!
    scene.presentation = {
      initialStateId: 'state-a',
      states: [
        {
          id: 'state-a',
          name: 'A',
          layerItemOverrides: { [source.itemId]: { locked: false } },
        },
        {
          id: 'state-b',
          name: 'B',
          layerItemOverrides: { [source.itemId]: { locked: true } },
        },
      ],
    }
    scene.layerItems[0]!.locked = true
    const valid = { ...source, project: courseProjectDocumentSchema.parse(project) }
    const atA = select(valid, 'state-a')
    const atB = select(valid, 'state-b')

    expect(atA).toMatchObject({ availability: 'available', effectiveLocked: false })
    expect(atB).toMatchObject({ availability: 'available', effectiveLocked: true })
    expect(atA.documentKey).toBe(atB.documentKey)
    if (atA.availability !== 'available' || atB.availability !== 'available') {
      throw new Error('expected named-state views')
    }
    expect(atA.enabledTarget.courseTarget.stateId).toBe('state-a')
    expect(atB.enabledTarget.courseTarget.stateId).toBe('state-b')
  })

  it('preserves the missing-Runtime creation slot without inventing property targets', () => {
    const source = fixture('scene')
    const project = structuredClone(source.project)
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    surface.scenes[0]!.layerItems = []

    const view = select({
      ...source,
      project: courseProjectDocumentSchema.parse(project),
    })
    expect(view).toMatchObject({
      availability: 'unavailable',
      reason: 'runtime-missing',
      label: expect.stringContaining('尚未创建 Runtime'),
      documentKey: null,
      creationTarget: {
        projectId: project.id,
        owner: 'scene',
        sceneId: surface.scenes[0]!.id,
        slot: 'runtime-template',
      },
    })
    expect(view).not.toHaveProperty('enabledTarget')
    expect(view).not.toHaveProperty('renderModeTarget')
  })
})
