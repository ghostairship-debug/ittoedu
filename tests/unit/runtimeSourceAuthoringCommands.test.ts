import { describe, expect, it } from 'vitest'
import {
  applyEditorTransactionStep,
  createEditorTransactionStep,
} from '@/renderer/authoring/editorTransaction'
import {
  captureCourseAuthoringTarget,
  createSessionToken,
  type CourseAuthoringTarget,
  type CurrentCourseAuthoringTargetIdentity,
} from '@/renderer/authoring/courseAuthoringSession'
import {
  makeLayerItemAuthoringAddress,
  ownerKeyFor,
  type CourseAuthoringOwner,
} from '@/renderer/authoring/courseAuthoringScope'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  planRuntimeSourceUpdate,
  type PlanRuntimeSourceUpdateInput,
  type RuntimeSourceAuthoringPlanResult,
} from '@/renderer/runtime/runtimeSourceAuthoringCommands'
import {
  COURSE_RUNTIME_SOURCE_AUTHORING_FIELD,
  type RuntimeSourceAuthoringCarrier,
} from '@/renderer/runtime/runtimeSourceAuthoringView'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  CourseSurfaceDocument,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'

const CREATED_AT = '2026-08-24T00:00:00.000Z'
const COMMITTED_AT = '2026-08-24T10:30:00.000Z'
const ASSET_ID = 'runtime-static-asset'

type FixtureKind =
  | 'global'
  | 'slide-surface'
  | 'slide-scene'
  | 'flow-surface'
  | 'spatial-surface'
  | 'spatial-world'

interface RuntimeFixture {
  readonly project: CourseProjectDocument
  readonly target: CourseAuthoringTarget
  readonly currentIdentity: CurrentCourseAuthoringTargetIdentity
  readonly carrier: RuntimeSourceAuthoringCarrier
  readonly itemId: string
}

function runtimeLayer(
  id: string,
  protocol: 'canvas-runtime' | 'surface-runtime',
): RuntimeLayerItem {
  return {
    kind: 'runtime',
    layerItemId: id,
    label: `Runtime ${id}`,
    frame: { mode: 'absolute', x: 120, y: 80, width: 640, height: 360 },
    order: 100,
    visible: true,
    locked: false,
    rotation: 7,
    opacity: 0.9,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'hidden',
    runtime: protocol === 'canvas-runtime'
      ? {
          protocol,
          runtimeApiVersion: 2,
          enabled: false,
          renderMode: 'hybrid',
          source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
          content: {
            values: { title: 'Canvas Runtime' },
            metadata: { title: { label: '标题', multiline: true } },
          },
          assets: { hero: { assetId: ASSET_ID } },
          nodeBindings: { title: 'node-title' },
          staticFallback: { assetId: ASSET_ID, coverage: 'scene' },
        }
      : {
          protocol,
          runtimeApiVersion: 3,
          enabled: true,
          renderMode: 'dom',
          source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {destroy(){}}}})',
          content: {
            values: { title: 'Surface Runtime' },
            metadata: { title: { label: '标题', multiline: true } },
          },
          assets: { hero: { assetId: ASSET_ID } },
          nodeBindings: { title: 'node-title' },
          staticFallback: { assetId: ASSET_ID, coverage: 'surface' },
        },
  }
}

function surfaceTypeOf(surface: CourseSurfaceDocument) {
  return surface.type
}

function fixture(
  kind: FixtureKind,
  options: {
    readonly protocol?: 'canvas-runtime' | 'surface-runtime'
    readonly stateId?: string | null
  } = {},
): RuntimeFixture {
  const protocol = options.protocol ?? (
    kind.startsWith('flow') || kind.startsWith('spatial')
      ? 'surface-runtime'
      : 'canvas-runtime'
  )
  const base = createBlankCourseProject({
    id: `runtime-source-${kind}`,
    title: `Runtime source ${kind}`,
    now: CREATED_AT,
    includeDefaultController: false,
    controls: 'none',
  })
  const itemId = `runtime-${kind}`
  const item = runtimeLayer(itemId, protocol)
  const assets = {
    [ASSET_ID]: {
      id: ASSET_ID,
      filename: 'runtime-static.png',
      mimeType: 'image/png',
      kind: 'image' as const,
      path: 'assets/runtime-static.png',
      byteLength: 4,
      width: 800,
      height: 600,
    },
  }
  let project: CourseProjectDocument
  let owner: CourseAuthoringOwner
  let sceneId: string | null = null
  let carrier: RuntimeSourceAuthoringCarrier

  if (kind === 'global') {
    project = {
      ...base,
      assets,
      globalLayerItems: [{
        item,
        visibility: { mode: 'all', locationIds: [] },
      }],
    }
    owner = 'global'
    carrier = 'global-layer'
  } else if (kind === 'slide-surface') {
    const surface = base.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    project = {
      ...base,
      assets,
      surfaces: [{
        ...surface,
        surfaceLayerItems: [{
          item,
          visibility: { mode: 'all', locationIds: [] },
        }],
      }],
    }
    owner = 'surface'
    carrier = 'surface-layer'
  } else if (kind === 'slide-scene') {
    const surface = base.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    sceneId = surface.scenes[0]!.id
    project = {
      ...base,
      assets,
      surfaces: [{
        ...surface,
        scenes: [{ ...surface.scenes[0]!, layerItems: [item] }],
      }],
    }
    owner = 'scene'
    carrier = 'slide-scene'
  } else if (kind === 'flow-surface') {
    const surfaceId = 'surface-flow'
    const blockId = 'flow-heading'
    project = {
      ...base,
      assets,
      locations: [{
        id: 'location-flow',
        label: 'Flow page',
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
          item,
          visibility: { mode: 'all', locationIds: [] },
        }],
        blocks: [{ id: blockId, type: 'heading', level: 1, text: 'Flow' }],
      }],
    }
    owner = 'surface'
    carrier = 'surface-layer'
  } else {
    const surfaceId = 'surface-spatial'
    const frameId = 'camera-home'
    project = {
      ...base,
      assets,
      locations: [{
        id: 'location-spatial',
        label: 'Spatial home',
        kind: 'spatial-camera',
        surfaceId,
        cameraFrameId: frameId,
      }],
      startLocationId: 'location-spatial',
      surfaces: [{
        id: surfaceId,
        title: 'Spatial',
        type: 'spatial-2d',
        surfaceLayerItems: kind === 'spatial-surface'
          ? [{ item, visibility: { mode: 'all', locationIds: [] } }]
          : [],
        world: {
          bounds: { mode: 'infinite' },
          layerItems: kind === 'spatial-world' ? [item] : [],
        },
        camera: {
          home: { x: 0, y: 0, zoom: 1 },
          frames: [{ id: frameId, name: 'Home', x: 0, y: 0, zoom: 1 }],
        },
        semanticZoom: [],
      }],
    }
    owner = kind === 'spatial-world' ? 'world' : 'surface'
    carrier = kind === 'spatial-world' ? 'spatial-world' : 'surface-layer'
  }

  project = courseProjectDocumentSchema.parse(project)
  const location = project.locations[0]!
  const surface = project.surfaces[0]!
  const sessionToken = createSessionToken({
    locationId: location.id,
    surfaceType: surfaceTypeOf(surface),
    revision: project.revision,
  }, 4)
  const stateId = options.stateId ?? null
  const target = captureCourseAuthoringTarget({
    sessionToken,
    projectId: project.id,
    surfaceId: surface.id,
    stateId,
    owner,
    ownerKey: ownerKeyFor(owner, surface.id, sceneId),
    itemId,
    authoringAddress: makeLayerItemAuthoringAddress({
      projectId: project.id,
      owner,
      surfaceId: surface.id,
      sceneId,
      kind: 'runtime',
      layerItemId: itemId,
      field: COURSE_RUNTIME_SOURCE_AUTHORING_FIELD,
    }),
  })
  return {
    project,
    target,
    currentIdentity: {
      projectId: project.id,
      documentRevision: project.revision,
      sessionToken,
      surfaceId: surface.id,
      stateId,
      owner,
      ownerKey: target.ownerKey,
    },
    carrier,
    itemId,
  }
}

function findRuntime(project: CourseProjectDocument, itemId: string): RuntimeLayerItem {
  const global = project.globalLayerItems.find(
    (entry) => entry.item.layerItemId === itemId,
  )?.item
  if (global?.kind === 'runtime') return global
  for (const surface of project.surfaces) {
    const shared = surface.surfaceLayerItems.find(
      (entry) => entry.item.layerItemId === itemId,
    )?.item
    if (shared?.kind === 'runtime') return shared
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) {
        const local = scene.layerItems.find((item) => item.layerItemId === itemId)
        if (local?.kind === 'runtime') return local
      }
    } else if (surface.type === 'spatial-2d') {
      const local = surface.world.layerItems.find(
        (item) => item.layerItemId === itemId,
      )
      if (local?.kind === 'runtime') return local
    }
  }
  throw new Error(`missing Runtime ${itemId}`)
}

function nextSource(source: RuntimeFixture): string {
  return findRuntime(source.project, source.itemId).runtime.runtimeApiVersion === 3
    ? 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {mount(){},destroy(){}}}})'
    : 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {mount(){},destroy(){}}}})'
}

function input(
  source: RuntimeFixture,
  patch: Partial<PlanRuntimeSourceUpdateInput> = {},
): PlanRuntimeSourceUpdateInput {
  return {
    project: source.project,
    currentIdentity: source.currentIdentity,
    target: source.target,
    source: nextSource(source),
    now: COMMITTED_AT,
    ...patch,
  }
}

function planned(result: RuntimeSourceAuthoringPlanResult) {
  expect(result.ok).toBe(true)
  if (!result.ok || result.status !== 'planned') throw new Error('expected source plan')
  return result.plan
}

describe('planRuntimeSourceUpdate', () => {
  it.each([
    ['global', 'global-layer', 2, 'canvas-runtime'],
    ['slide-surface', 'surface-layer', 2, 'canvas-runtime'],
    ['slide-scene', 'slide-scene', 2, 'canvas-runtime'],
    ['flow-surface', 'surface-layer', 3, 'surface-runtime'],
    ['spatial-surface', 'surface-layer', 3, 'surface-runtime'],
    ['spatial-world', 'spatial-world', 3, 'surface-runtime'],
  ] as const)(
    'updates source for %s while preserving API %i %s and every other field',
    (kind, carrier, api, protocol) => {
      const source = fixture(kind)
      const before = structuredClone(source.project)
      const beforeItem = structuredClone(findRuntime(before, source.itemId))
      const plan = planned(planRuntimeSourceUpdate(input(source)))
      const afterItem = findRuntime(plan.nextDocument, source.itemId)
      const expectedItem = structuredClone(beforeItem)
      expectedItem.runtime.source = nextSource(source)

      expect(afterItem).toEqual(expectedItem)
      expect(afterItem.runtime).toMatchObject({ protocol, runtimeApiVersion: api })
      expect(plan.nextDocument.revision).toBe(before.revision + 1)
      expect(plan.nextDocument.updatedAt).toBe(COMMITTED_AT)
      expect(plan.resourceChanges).toEqual({})
      expect(plan.selectionHint).toMatchObject({
        carrier,
        itemId: source.itemId,
        authoringAddress: source.target.authoringAddress,
      })
      expect(plan.feedback).toMatchObject({
        kind: 'runtime-source-updated',
        carrier,
        protocol,
        runtimeApiVersion: api,
      })

      const normalized = structuredClone(plan.nextDocument)
      normalized.revision = before.revision
      normalized.updatedAt = before.updatedAt
      findRuntime(normalized, source.itemId).runtime.source = beforeItem.runtime.source
      expect(normalized).toEqual(before)
    },
  )

  it('returns a frozen true no-op for identical source', () => {
    const source = fixture('spatial-world')
    const currentSource = findRuntime(source.project, source.itemId).runtime.source
    const result = planRuntimeSourceUpdate(input(source, { source: currentSource }))

    expect(result).toMatchObject({
      ok: true,
      status: 'no-op',
      plan: null,
      feedback: {
        kind: 'runtime-source-unchanged',
        protocol: 'surface-runtime',
        runtimeApiVersion: 3,
      },
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(source.project.revision).toBe(0)
  })

  it('produces one reversible EditorTransactionStep with no resource delta', () => {
    const source = fixture('flow-surface')
    const plan = planned(planRuntimeSourceUpdate(input(source)))
    const step = createEditorTransactionStep(source.project, plan)
    expect(step).not.toBeNull()

    const resources = { componentPackages: {}, assetFiles: {} }
    const forward = applyEditorTransactionStep({
      document: source.project,
      resources,
    }, step!, 'forward')
    expect(findRuntime(forward.document, source.itemId).runtime.source)
      .toBe(nextSource(source))
    expect(forward.resources).toEqual(resources)
    expect(applyEditorTransactionStep(forward, step!, 'inverse').document)
      .toEqual(source.project)
  })

  it('allows state A to B switching but resolves lock from captured state A', () => {
    const initial = fixture('slide-scene')
    const project = structuredClone(initial.project)
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    const scene = surface.scenes[0]!
    scene.presentation = {
      initialStateId: 'state-a',
      states: [
        {
          id: 'state-a',
          name: 'A',
          layerItemOverrides: { [initial.itemId]: { locked: false } },
        },
        {
          id: 'state-b',
          name: 'B',
          layerItemOverrides: { [initial.itemId]: { locked: true } },
        },
      ],
    }
    findRuntime(project, initial.itemId).locked = true
    const valid = courseProjectDocumentSchema.parse(project)
    const withStates: RuntimeFixture = {
      ...initial,
      project: valid,
      target: { ...initial.target, stateId: 'state-a' },
      currentIdentity: { ...initial.currentIdentity, stateId: 'state-b' },
    }
    const stateResult = planRuntimeSourceUpdate(input(withStates))
    if (!stateResult.ok) {
      throw new Error(`${stateResult.code}: ${stateResult.reason}`)
    }
    expect(stateResult).toMatchObject({
      ok: true,
      status: 'planned',
    })

    const lockedProject = structuredClone(valid)
    const lockedSurface = lockedProject.surfaces[0]!
    if (lockedSurface.type !== 'slide') throw new Error('expected Slide')
    lockedSurface.scenes[0]!.presentation!.states[0]!
      .layerItemOverrides[initial.itemId] = { locked: true }
    expect(planRuntimeSourceUpdate(input({
      ...withStates,
      project: courseProjectDocumentSchema.parse(lockedProject),
    }))).toMatchObject({ ok: false, code: 'target-locked' })
  })

  it.each([
    ['project-mismatch', (source: RuntimeFixture) => ({
      currentIdentity: { ...source.currentIdentity, projectId: 'another-project' },
    })],
    ['revision-conflict', (source: RuntimeFixture) => ({
      currentIdentity: {
        ...source.currentIdentity,
        documentRevision: source.project.revision + 1,
        sessionToken: {
          ...source.currentIdentity.sessionToken,
          revision: source.project.revision + 1,
        },
      },
    })],
    ['session-stale', (source: RuntimeFixture) => ({
      currentIdentity: {
        ...source.currentIdentity,
        sessionToken: {
          ...source.currentIdentity.sessionToken,
          generation: source.currentIdentity.sessionToken.generation + 1,
        },
      },
    })],
    ['surface-or-location', (source: RuntimeFixture) => ({
      currentIdentity: {
        ...source.currentIdentity,
        sessionToken: {
          ...source.currentIdentity.sessionToken,
          locationId: 'another-location',
        },
      },
    })],
    ['owner-mismatch', (source: RuntimeFixture) => ({
      currentIdentity: {
        ...source.currentIdentity,
        owner: 'surface' as const,
        ownerKey: `surface:${source.currentIdentity.surfaceId}`,
      },
    })],
  ] as const)('rejects exact target drift: %s', (expectedCode, patch) => {
    const source = fixture('slide-scene')
    expect(planRuntimeSourceUpdate(input(source, patch(source))))
      .toMatchObject({ ok: false, code: expectedCode })
  })

  it('rejects missing, moved, wrong-type, re-addressed and Flow-block targets', () => {
    const source = fixture('flow-surface')

    const missing = structuredClone(source.project)
    const missingSurface = missing.surfaces[0]!
    missingSurface.surfaceLayerItems = []
    expect(planRuntimeSourceUpdate(input(source, { project: missing })))
      .toMatchObject({ ok: false, code: 'item-missing' })

    const moved = structuredClone(source.project)
    const movedSurface = moved.surfaces[0]!
    const entry = movedSurface.surfaceLayerItems.shift()!
    moved.globalLayerItems.push(entry)
    expect(planRuntimeSourceUpdate(input(source, { project: moved })))
      .toMatchObject({ ok: false, code: 'wrong-carrier' })

    const wrongType = structuredClone(source.project)
    wrongType.surfaces[0]!.surfaceLayerItems[0]!.item.kind = 'native'
    expect(planRuntimeSourceUpdate(input(source, { project: wrongType })))
      .toMatchObject({ ok: false, code: 'invalid-target' })

    expect(planRuntimeSourceUpdate(input(source, {
      target: {
        ...source.target,
        authoringAddress: `${source.target.authoringAddress}-retargeted`,
      },
    }))).toMatchObject({ ok: false, code: 'invalid-target' })

    const flowBlock = structuredClone(source.project)
    const flowSurface = flowBlock.surfaces[0]!
    if (flowSurface.type !== 'flow') throw new Error('expected Flow')
    flowSurface.surfaceLayerItems = []
    flowSurface.blocks.push({
      id: source.itemId,
      type: 'code',
      language: 'javascript',
      code: 'not a Runtime LayerItem',
    })
    expect(planRuntimeSourceUpdate(input(source, { project: flowBlock })))
      .toMatchObject({ ok: false, code: 'wrong-carrier' })
  })

  it.each([
    ['', '运行时源码为空'],
    ['import thing from "package"', '不能使用 import'],
    ['export default {}', '不能使用 export'],
    ['const thing = require("package")', '不能使用 require'],
    ['CoursewareRuntime.define({', 'Unexpected'],
  ])('rejects invalid source without changing the input: %j', (invalid, reason) => {
    const source = fixture('global')
    const before = structuredClone(source.project)
    const result = planRuntimeSourceUpdate(input(source, { source: invalid }))

    expect(result).toMatchObject({ ok: false, code: 'invalid-source' })
    if (!result.ok) expect(result.reason).toContain(reason)
    expect(source.project).toEqual(before)
  })

  it('rejects source that violates the canonical V9 UTF-8 size limit', () => {
    const source = fixture('spatial-world')
    const oversized = `CoursewareRuntime.define({runtimeApiVersion:3});/*${'x'.repeat(
      2 * 1024 * 1024,
    )}*/`

    expect(planRuntimeSourceUpdate(input(source, { source: oversized })))
      .toMatchObject({ ok: false, code: 'invalid-source' })
  })

  it('rejects invalid clock, captured state, current non-Slide state and full V9 document', () => {
    const source = fixture('slide-scene')
    expect(planRuntimeSourceUpdate(input(source, { now: 'not-a-clock' })))
      .toMatchObject({ ok: false, code: 'invalid-clock' })

    const missingState = fixture('slide-scene', { stateId: 'missing-state' })
    expect(planRuntimeSourceUpdate(input(missingState)))
      .toMatchObject({ ok: false, code: 'invalid-target' })

    const flow = fixture('flow-surface')
    expect(planRuntimeSourceUpdate(input(flow, {
      currentIdentity: { ...flow.currentIdentity, stateId: 'state-a' },
    }))).toMatchObject({ ok: false, code: 'invalid-target' })

    const invalidProject = structuredClone(source.project)
    invalidProject.locations.push(structuredClone(invalidProject.locations[0]!))
    expect(planRuntimeSourceUpdate(input(source, { project: invalidProject })))
      .toMatchObject({ ok: false, code: 'invalid-document' })
  })

  it('does not mutate inputs and deeply freezes the detached plan', () => {
    const source = fixture('spatial-world')
    const before = structuredClone(source.project)
    const targetBefore = structuredClone(source.target)
    const plan = planned(planRuntimeSourceUpdate(input(source)))

    expect(source.project).toEqual(before)
    expect(source.target).toEqual(targetBefore)
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.nextDocument)).toBe(true)
    expect(Object.isFrozen(plan.nextDocument.surfaces[0])).toBe(true)
    expect(Object.isFrozen(plan.resourceChanges)).toBe(true)
    expect(Object.isFrozen(plan.selectionHint)).toBe(true)
    expect(Object.isFrozen(plan.feedback)).toBe(true)
  })
})
