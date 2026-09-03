import { describe, expect, it } from 'vitest'
import {
  applyEditorTransactionStep,
  createEditorTransactionStep,
} from '@/renderer/authoring/editorTransaction'
import {
  createSessionToken,
  type CurrentCourseAuthoringTargetIdentity,
} from '@/renderer/authoring/courseAuthoringSession'
import type { CourseAuthoringOwner } from '@/renderer/authoring/courseAuthoringScope'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  freezeCourseAssetSidecar,
  type CourseAssetSidecar,
} from '@/renderer/project/v9AssetAdapter'
import {
  captureCourseRuntimeAssetReplacementTarget,
  courseRuntimeAssetBindingAuthoringField,
  planCourseRuntimeAssetReplacement,
  type CourseRuntimeAssetReplacementPlanResult,
  type CourseRuntimeAssetReplacementTarget,
  type CourseRuntimeCarrier,
  type PlanCourseRuntimeAssetReplacementInput,
} from '@/renderer/runtime/courseRuntimeTransactions'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  CourseSurfaceDocument,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/contracts/media-v1'

const CREATED_AT = '2026-08-24T00:00:00.000Z'
const COMMITTED_AT = '2026-08-24T09:30:00.000Z'
const OLD_ASSET_ID = 'runtime-asset-old'

type FixtureKind =
  | 'global'
  | 'slide-surface'
  | 'slide-scene'
  | 'flow-surface'
  | 'spatial-surface'
  | 'spatial-world'

interface ImageInput {
  meta: AssetMeta
  bytes: Uint8Array
}

interface RuntimeFixture {
  project: CourseProjectDocument
  sidecar: CourseAssetSidecar
  target: CourseRuntimeAssetReplacementTarget
  currentIdentity: CurrentCourseAuthoringTargetIdentity
  carrier: CourseRuntimeCarrier
  itemId: string
}

function image(
  id: string,
  values: ArrayLike<number> = [1, 2, 3, 4],
  patch: Partial<AssetMeta> = {},
): ImageInput {
  const bytes = Uint8Array.from(values)
  return {
    meta: {
      id,
      filename: `${id}.png`,
      mimeType: 'image/png',
      kind: 'image',
      path: `assets/${id}.png`,
      byteLength: bytes.byteLength,
      width: 800,
      height: 600,
      ...patch,
    },
    bytes,
  }
}

function runtimeLayer(
  id: string,
  bindingKey: string,
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
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    runtime: protocol === 'canvas-runtime'
      ? {
          protocol,
          runtimeApiVersion: 2,
          enabled: true,
          renderMode: 'phaser',
          source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
          content: { values: { title: 'Canvas Runtime' } },
          assets: { [bindingKey]: { assetId: OLD_ASSET_ID } },
        }
      : {
          protocol,
          runtimeApiVersion: 3,
          enabled: true,
          renderMode: 'dom',
          source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {destroy(){}}}})',
          content: { values: { title: 'Surface Runtime' } },
          assets: { [bindingKey]: { assetId: OLD_ASSET_ID } },
        },
  }
}

function surfaceTypeOf(surface: CourseSurfaceDocument) {
  return surface.type
}

function fixture(
  kind: FixtureKind,
  options: {
    bindingKey?: string
    protocol?: 'canvas-runtime' | 'surface-runtime'
    stateId?: string | null
  } = {},
): RuntimeFixture {
  const bindingKey = options.bindingKey ?? 'hero'
  const protocol = options.protocol ?? (
    kind.startsWith('spatial') || kind === 'flow-surface'
      ? 'surface-runtime'
      : 'canvas-runtime'
  )
  const old = image(OLD_ASSET_ID, [9, 8, 7])
  const base = createBlankCourseProject({
    id: `runtime-${kind}`,
    title: `Runtime ${kind}`,
    now: CREATED_AT,
    includeDefaultController: false,
    controls: 'none',
  })
  const itemId = `runtime-${kind}`
  const item = runtimeLayer(itemId, bindingKey, protocol)
  let project: CourseProjectDocument
  let owner: CourseAuthoringOwner
  let sceneId: string | null = null
  let carrier: CourseRuntimeCarrier

  if (kind === 'global') {
    project = {
      ...base,
      assets: { [OLD_ASSET_ID]: old.meta },
      globalLayerItems: [{
        item,
        visibility: { mode: 'all', locationIds: [] },
      }],
    }
    owner = 'global'
    carrier = 'global-layer'
  } else if (kind === 'slide-surface') {
    const surface = base.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide fixture')
    project = {
      ...base,
      assets: { [OLD_ASSET_ID]: old.meta },
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
    if (surface.type !== 'slide') throw new Error('expected Slide fixture')
    sceneId = surface.scenes[0]!.id
    project = {
      ...base,
      assets: { [OLD_ASSET_ID]: old.meta },
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
      assets: { [OLD_ASSET_ID]: old.meta },
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
    const world = kind === 'spatial-world' ? [item] : []
    const shared = kind === 'spatial-surface'
      ? [{ item, visibility: { mode: 'all' as const, locationIds: [] } }]
      : []
    project = {
      ...base,
      assets: { [OLD_ASSET_ID]: old.meta },
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
        surfaceLayerItems: shared,
        world: { bounds: { mode: 'infinite' }, layerItems: world },
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
  const target = captureCourseRuntimeAssetReplacementTarget({
    sessionToken,
    projectId: project.id,
    surfaceId: surface.id,
    stateId: options.stateId ?? null,
    owner,
    sceneId,
    itemId,
    bindingKey,
  })
  return {
    project,
    sidecar: freezeCourseAssetSidecar({ [OLD_ASSET_ID]: old.bytes }),
    target,
    currentIdentity: {
      projectId: project.id,
      documentRevision: project.revision,
      sessionToken,
      surfaceId: surface.id,
      stateId: target.courseTarget.stateId,
      owner,
      ownerKey: target.courseTarget.ownerKey,
    },
    carrier,
    itemId,
  }
}

function input(
  source: RuntimeFixture,
  replacement: ImageInput,
  patch: Partial<PlanCourseRuntimeAssetReplacementInput> = {},
): PlanCourseRuntimeAssetReplacementInput {
  return {
    project: source.project,
    sidecar: source.sidecar,
    currentIdentity: source.currentIdentity,
    target: source.target,
    asset: replacement.meta,
    bytes: replacement.bytes,
    now: COMMITTED_AT,
    ...patch,
  }
}

function planned(result: CourseRuntimeAssetReplacementPlanResult) {
  expect(result.ok).toBe(true)
  if (!result.ok || result.status !== 'planned') throw new Error('expected Runtime plan')
  return result.plan
}

function findRuntimeItem(project: CourseProjectDocument, itemId: string): RuntimeLayerItem {
  const global = project.globalLayerItems.find((entry) => entry.item.layerItemId === itemId)?.item
  if (global?.kind === 'runtime') return global
  for (const surface of project.surfaces) {
    const shared = surface.surfaceLayerItems.find((entry) => entry.item.layerItemId === itemId)?.item
    if (shared?.kind === 'runtime') return shared
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) {
        const item = scene.layerItems.find((candidate) => candidate.layerItemId === itemId)
        if (item?.kind === 'runtime') return item
      }
    } else if (surface.type === 'spatial-2d') {
      const item = surface.world.layerItems.find((candidate) => candidate.layerItemId === itemId)
      if (item?.kind === 'runtime') return item
    }
  }
  throw new Error(`missing Runtime ${itemId}`)
}

function replaceFixtureProject(
  source: RuntimeFixture,
  project: CourseProjectDocument,
): RuntimeFixture {
  return { ...source, project }
}

describe('planCourseRuntimeAssetReplacement', () => {
  it.each([
    ['global', 'canvas-runtime', 'global-layer'],
    ['slide-surface', 'canvas-runtime', 'surface-layer'],
    ['slide-scene', 'canvas-runtime', 'slide-scene'],
    ['flow-surface', 'surface-runtime', 'surface-layer'],
    ['spatial-surface', 'surface-runtime', 'surface-layer'],
    ['spatial-world', 'surface-runtime', 'spatial-world'],
  ] as const)(
    'plans one atomic replacement for %s without changing its %s protocol',
    (kind, protocol, expectedCarrier) => {
      const source = fixture(kind)
      const replacement = image(`replacement-${kind}`, [4, 5, 6, 7])
      const before = structuredClone(source.project)
      const plan = planned(planCourseRuntimeAssetReplacement(input(source, replacement)))
      const nextItem = findRuntimeItem(plan.nextDocument, source.itemId)

      expect(plan.projectId).toBe(source.project.id)
      expect(plan.baseRevision).toBe(source.project.revision)
      expect(plan.nextDocument.revision).toBe(source.project.revision + 1)
      expect(plan.nextDocument.updatedAt).toBe(COMMITTED_AT)
      expect(nextItem.runtime.protocol).toBe(protocol)
      expect(nextItem.runtime.assets.hero).toEqual({ assetId: replacement.meta.id })
      expect(plan.nextDocument.assets[OLD_ASSET_ID]).toEqual(source.project.assets[OLD_ASSET_ID])
      expect(plan.nextDocument.assets[replacement.meta.id]).toEqual(replacement.meta)
      expect(plan.resourceChanges.assetFileChanges).toEqual([{
        assetId: replacement.meta.id,
        after: replacement.bytes,
      }])
      expect(plan.selectionHint).toMatchObject({
        itemId: source.itemId,
        bindingKey: 'hero',
        carrier: expectedCarrier,
      })
      expect(plan.feedback).toMatchObject({
        kind: 'runtime-asset-replaced',
        previousAssetId: OLD_ASSET_ID,
        assetId: replacement.meta.id,
        carrier: expectedCarrier,
        assetDisposition: 'added',
      })
      expect(courseProjectDocumentSchema.safeParse(plan.nextDocument).success).toBe(true)

      const normalized = structuredClone(plan.nextDocument)
      normalized.revision = before.revision
      normalized.updatedAt = before.updatedAt
      delete normalized.assets[replacement.meta.id]
      findRuntimeItem(normalized, source.itemId).runtime.assets.hero = {
        assetId: OLD_ASSET_ID,
      }
      expect(normalized).toEqual(before)
    },
  )

  it('uses a field-specific stable address with JSON Pointer escaping', () => {
    const bindingKey = 'hero/x~y'
    const source = fixture('slide-scene', { bindingKey })
    const address = new URL(source.target.courseTarget.authoringAddress)

    expect(courseRuntimeAssetBindingAuthoringField(bindingKey)).toBe(
      'runtime/assets/hero~1x~0y/assetId',
    )
    expect(address.searchParams.get('field')).toBe(
      'runtime/assets/hero~1x~0y/assetId',
    )
    expect(source.target).not.toHaveProperty('targetId')
    expect(source.target).not.toHaveProperty('hitId')
    const plan = planned(planCourseRuntimeAssetReplacement(input(
      source,
      image('escaped-key-replacement'),
    )))
    expect(findRuntimeItem(plan.nextDocument, source.itemId).runtime.assets[bindingKey])
      .toEqual({ assetId: 'escaped-key-replacement' })
  })

  it('applies and reverses binding, metadata and bytes as one EditorTransactionStep', () => {
    const source = fixture('spatial-world')
    const replacement = image('atomic-runtime-image', [11, 12, 13])
    const plan = planned(planCourseRuntimeAssetReplacement(input(source, replacement)))
    const step = createEditorTransactionStep(source.project, plan)
    expect(step).not.toBeNull()
    const initialResources = {
      componentPackages: {},
      assetFiles: source.sidecar.files,
    }
    const forward = applyEditorTransactionStep({
      document: source.project,
      resources: initialResources,
    }, step!, 'forward')

    expect(findRuntimeItem(forward.document, source.itemId).runtime.assets.hero.assetId)
      .toBe(replacement.meta.id)
    expect(forward.document.assets[replacement.meta.id]).toEqual(replacement.meta)
    expect(forward.resources.assetFiles[replacement.meta.id]).toEqual(replacement.bytes)

    const inverse = applyEditorTransactionStep(forward, step!, 'inverse')
    expect(inverse.document).toEqual(source.project)
    expect(inverse.resources.assetFiles).toEqual(initialResources.assetFiles)
    expect(inverse.document.assets[replacement.meta.id]).toBeUndefined()
  })

  it('returns a no-op only when the current binding has complete matching resources', () => {
    const source = fixture('slide-scene')
    const old = image(OLD_ASSET_ID, [9, 8, 7])
    const result = planCourseRuntimeAssetReplacement(input(source, old))

    expect(result).toMatchObject({
      ok: true,
      status: 'no-op',
      plan: null,
      feedback: {
        kind: 'runtime-asset-unchanged',
        assetId: OLD_ASSET_ID,
        assetDisposition: 'unchanged',
      },
    })
    expect(source.project.revision).toBe(0)
  })

  it('reuses complete resources and repairs either missing resource half', () => {
    const replacement = image('known-runtime-image', [2, 4, 6, 8])
    const base = fixture('flow-surface')
    const completeProject = courseProjectDocumentSchema.parse({
      ...base.project,
      assets: {
        ...base.project.assets,
        [replacement.meta.id]: replacement.meta,
      },
    })
    const complete = {
      ...replaceFixtureProject(base, completeProject),
      sidecar: freezeCourseAssetSidecar({
        ...base.sidecar.files,
        [replacement.meta.id]: replacement.bytes,
      }),
    }
    const reused = planned(planCourseRuntimeAssetReplacement(input(complete, replacement)))
    expect(reused.resourceChanges).toEqual({})
    expect(reused.feedback?.assetDisposition).toBe('reused')

    const metadataOnly = replaceFixtureProject(base, completeProject)
    const repairedBytes = planned(planCourseRuntimeAssetReplacement(input(
      metadataOnly,
      replacement,
    )))
    expect(repairedBytes.feedback?.assetDisposition).toBe('repaired')
    expect(repairedBytes.resourceChanges.assetFileChanges).toEqual([{
      assetId: replacement.meta.id,
      after: replacement.bytes,
    }])

    const bytesOnly = {
      ...base,
      sidecar: freezeCourseAssetSidecar({
        ...base.sidecar.files,
        [replacement.meta.id]: replacement.bytes,
      }),
    }
    const repairedMeta = planned(planCourseRuntimeAssetReplacement(input(
      bytesOnly,
      replacement,
    )))
    expect(repairedMeta.feedback?.assetDisposition).toBe('repaired')
    expect(repairedMeta.resourceChanges).toEqual({})
    expect(repairedMeta.nextDocument.assets[replacement.meta.id]).toEqual(replacement.meta)
  })

  it('repairs a current binding with missing bytes instead of returning a false no-op', () => {
    const source = fixture('global')
    const withoutOldBytes = {
      ...source,
      sidecar: freezeCourseAssetSidecar({}),
    }
    const old = image(OLD_ASSET_ID, [9, 8, 7])
    const plan = planned(planCourseRuntimeAssetReplacement(input(withoutOldBytes, old)))

    expect(plan.feedback?.assetDisposition).toBe('repaired')
    expect(plan.nextDocument.revision).toBe(source.project.revision + 1)
    expect(plan.resourceChanges.assetFileChanges).toEqual([{
      assetId: OLD_ASSET_ID,
      after: old.bytes,
    }])
  })

  it('allows a Slide state A to B switch but resolves locking from captured state A', () => {
    const source = fixture('slide-scene', { stateId: 'state-a' })
    const project = structuredClone(source.project)
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    const scene = surface.scenes[0]!
    scene.presentation!.states.push(
      {
        id: 'state-a',
        name: 'State A',
        layerItemOverrides: { [source.itemId]: { locked: false } },
      },
      {
        id: 'state-b',
        name: 'State B',
        layerItemOverrides: { [source.itemId]: { locked: true } },
      },
    )
    findRuntimeItem(project, source.itemId).locked = true
    const validProject = courseProjectDocumentSchema.parse(project)
    const currentAtB: CurrentCourseAuthoringTargetIdentity = {
      ...source.currentIdentity,
      stateId: 'state-b',
    }
    const plan = planned(planCourseRuntimeAssetReplacement(input(
      replaceFixtureProject(source, validProject),
      image('state-shared-replacement'),
      { currentIdentity: currentAtB },
    )))

    expect(plan.selectionHint?.stateId).toBe('state-a')
    expect(plan.nextDocument.revision).toBe(source.project.revision + 1)

    const lockedProject = structuredClone(validProject)
    const lockedSurface = lockedProject.surfaces[0]!
    if (lockedSurface.type !== 'slide') throw new Error('expected Slide')
    const capturedState = lockedSurface.scenes[0]!.presentation!.states.find(
      (state) => state.id === 'state-a',
    )!
    capturedState.layerItemOverrides[source.itemId] = { locked: true }
    const locked = planCourseRuntimeAssetReplacement(input(
      replaceFixtureProject(source, courseProjectDocumentSchema.parse(lockedProject)),
      image('captured-state-locked'),
      { currentIdentity: currentAtB },
    ))
    expect(locked).toMatchObject({ ok: false, code: 'target-locked' })
  })

  it('rejects a missing captured Slide state and any state identity on non-Slide targets', () => {
    const missingSlideState = fixture('slide-scene', { stateId: 'missing-state' })
    expect(planCourseRuntimeAssetReplacement(input(
      missingSlideState,
      image('missing-state-replacement'),
    ))).toMatchObject({ ok: false, code: 'invalid-target' })

    const statefulFlowTarget = fixture('flow-surface', { stateId: 'state-a' })
    expect(planCourseRuntimeAssetReplacement(input(
      statefulFlowTarget,
      image('flow-state-target-replacement'),
    ))).toMatchObject({ ok: false, code: 'invalid-target' })

    const flow = fixture('flow-surface')
    expect(planCourseRuntimeAssetReplacement(input(
      flow,
      image('flow-state-current-replacement'),
      { currentIdentity: { ...flow.currentIdentity, stateId: 'state-a' } },
    ))).toMatchObject({ ok: false, code: 'invalid-target' })
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
  ] as const)('rejects stale identity: %s', (expectedCode, patchFactory) => {
    const source = fixture('slide-scene')
    const result = planCourseRuntimeAssetReplacement(input(
      source,
      image(`stale-${expectedCode}`),
      patchFactory(source),
    ))
    expect(result).toMatchObject({ ok: false, code: expectedCode })
  })

  it('rejects missing, moved, locked, re-addressed and retired bindings', () => {
    const source = fixture('global')
    const replacement = image('invalid-target-replacement')

    const missingProject = structuredClone(source.project)
    missingProject.globalLayerItems = []
    expect(planCourseRuntimeAssetReplacement(input(
      replaceFixtureProject(source, missingProject),
      replacement,
    ))).toMatchObject({ ok: false, code: 'item-missing' })

    const movedProject = structuredClone(source.project)
    const moved = movedProject.globalLayerItems.shift()!
    const surface = movedProject.surfaces[0]!
    surface.surfaceLayerItems.push(moved)
    expect(planCourseRuntimeAssetReplacement(input(
      replaceFixtureProject(source, movedProject),
      replacement,
    ))).toMatchObject({ ok: false, code: 'wrong-carrier' })

    const lockedProject = structuredClone(source.project)
    findRuntimeItem(lockedProject, source.itemId).locked = true
    expect(planCourseRuntimeAssetReplacement(input(
      replaceFixtureProject(source, lockedProject),
      replacement,
    ))).toMatchObject({ ok: false, code: 'target-locked' })

    const badAddress = {
      ...source.target,
      courseTarget: {
        ...source.target.courseTarget,
        authoringAddress: `${source.target.courseTarget.authoringAddress}-retargeted`,
      },
    }
    expect(planCourseRuntimeAssetReplacement(input(source, replacement, {
      target: badAddress,
    }))).toMatchObject({ ok: false, code: 'invalid-target' })

    const noBindingProject = structuredClone(source.project)
    delete findRuntimeItem(noBindingProject, source.itemId).runtime.assets.hero
    expect(planCourseRuntimeAssetReplacement(input(
      replaceFixtureProject(source, noBindingProject),
      replacement,
    ))).toMatchObject({ ok: false, code: 'binding-missing' })
  })

  it('explicitly rejects a Flow document block as a Runtime carrier', () => {
    const source = fixture('flow-surface')
    const project = structuredClone(source.project)
    const surface = project.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('expected Flow')
    surface.surfaceLayerItems = []
    surface.blocks.push({
      id: source.itemId,
      type: 'code',
      language: 'text',
      code: 'not a Runtime carrier',
    })

    const result = planCourseRuntimeAssetReplacement(input(
      replaceFixtureProject(source, project),
      image('flow-block-replacement'),
    ))
    expect(result).toMatchObject({ ok: false, code: 'wrong-carrier' })
  })

  it('changes only one binding on one Runtime among multiple Runtime layers', () => {
    const source = fixture('slide-scene')
    const project = structuredClone(source.project)
    const secondary = image('runtime-secondary', [1, 3, 5])
    const fallback = image('runtime-fallback', [2, 4, 6])
    const secondAsset = image('runtime-second-asset', [7, 8, 9])
    project.assets[secondary.meta.id] = secondary.meta
    project.assets[fallback.meta.id] = fallback.meta
    project.assets[secondAsset.meta.id] = secondAsset.meta
    const targetItem = findRuntimeItem(project, source.itemId)
    targetItem.runtime.assets.secondary = { assetId: secondary.meta.id }
    targetItem.runtime.staticFallback = {
      assetId: fallback.meta.id,
      coverage: 'scene',
    }
    const secondRuntime = runtimeLayer('runtime-second', 'hero', 'canvas-runtime')
    secondRuntime.order = 200
    secondRuntime.runtime.assets.hero = { assetId: secondAsset.meta.id }
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    surface.scenes[0]!.layerItems.push(secondRuntime)
    const validProject = courseProjectDocumentSchema.parse(project)
    const targetBefore = structuredClone(findRuntimeItem(validProject, source.itemId))
    const secondBefore = structuredClone(findRuntimeItem(validProject, secondRuntime.layerItemId))
    const expanded = {
      ...replaceFixtureProject(source, validProject),
      sidecar: freezeCourseAssetSidecar({
        ...source.sidecar.files,
        [secondary.meta.id]: secondary.bytes,
        [fallback.meta.id]: fallback.bytes,
        [secondAsset.meta.id]: secondAsset.bytes,
      }),
    }
    const replacement = image('one-binding-only', [10, 11, 12])
    const plan = planned(planCourseRuntimeAssetReplacement(input(expanded, replacement)))
    const targetAfter = findRuntimeItem(plan.nextDocument, source.itemId)
    const expectedTarget = structuredClone(targetBefore)
    expectedTarget.runtime.assets.hero = { assetId: replacement.meta.id }

    expect(targetAfter).toEqual(expectedTarget)
    expect(targetAfter.runtime.assets.secondary).toEqual({ assetId: secondary.meta.id })
    expect(targetAfter.runtime.staticFallback).toEqual({
      assetId: fallback.meta.id,
      coverage: 'scene',
    })
    expect(findRuntimeItem(plan.nextDocument, secondRuntime.layerItemId)).toEqual(secondBefore)
  })

  it('rejects metadata and byte collisions atomically', () => {
    const replacement = image('collision', [3, 1, 4])
    const source = fixture('spatial-world')
    const metadataProject = courseProjectDocumentSchema.parse({
      ...source.project,
      assets: {
        ...source.project.assets,
        [replacement.meta.id]: { ...replacement.meta, width: 999 },
      },
    })
    const metadataConflict = planCourseRuntimeAssetReplacement(input(
      replaceFixtureProject(source, metadataProject),
      replacement,
    ))
    expect(metadataConflict).toMatchObject({ ok: false, code: 'asset-conflict' })

    const bytesConflict = planCourseRuntimeAssetReplacement(input({
      ...source,
      sidecar: freezeCourseAssetSidecar({
        ...source.sidecar.files,
        [replacement.meta.id]: Uint8Array.from([3, 1, 5]),
      }),
    }, replacement))
    expect(bytesConflict).toMatchObject({ ok: false, code: 'asset-conflict' })
    expect(source.project.assets[replacement.meta.id]).toBeUndefined()
  })

  it.each([
    ['wrong-kind', { kind: 'audio' as const, mimeType: 'audio/mpeg' }],
    ['wrong-mime', { mimeType: 'text/plain' }],
    ['absolute-path', { path: 'C:\\runtime.png' }],
    ['wrong-size', { byteLength: 99 }],
    ['bad-width', { width: 0 }],
  ] as const)('rejects invalid image input: %s', (_label, patch) => {
    const source = fixture('slide-surface')
    const replacement = image('invalid-image', [1, 2], patch)
    expect(planCourseRuntimeAssetReplacement(input(source, replacement)))
      .toMatchObject({ ok: false, code: 'invalid-asset' })
  })

  it('safely rejects assetId __proto__ before any V9 record write', () => {
    const source = fixture('slide-scene')
    const unsafe = image('__proto__', [1, 2, 3])

    expect(planCourseRuntimeAssetReplacement(input(source, unsafe)))
      .toMatchObject({ ok: false, code: 'invalid-asset' })
    expect(Object.hasOwn(source.project.assets, '__proto__')).toBe(false)
  })

  it('detaches a Node Buffer input as a base Uint8Array resource delta', () => {
    const source = fixture('global')
    const buffer = Buffer.from([31, 41, 59, 26])
    const replacement = image('buffer-runtime-image', buffer)
    replacement.bytes = buffer
    const plan = planned(planCourseRuntimeAssetReplacement(input(source, replacement)))
    const after = plan.resourceChanges.assetFileChanges?.[0]?.after

    expect(after).toBeInstanceOf(Uint8Array)
    expect(Buffer.isBuffer(after)).toBe(false)
    expect(after?.constructor).toBe(Uint8Array)
    expect(Array.from(after ?? [])).toEqual([31, 41, 59, 26])
    buffer[0] = 255
    expect(after?.[0]).toBe(31)
  })

  it('rejects an invalid clock and a final document that still violates V9', () => {
    const source = fixture('slide-scene')
    const replacement = image('validation-replacement')
    expect(planCourseRuntimeAssetReplacement(input(source, replacement, {
      now: 'not-a-clock',
    }))).toMatchObject({ ok: false, code: 'invalid-clock' })

    const invalidProject = structuredClone(source.project)
    invalidProject.locations.push(structuredClone(invalidProject.locations[0]!))
    expect(planCourseRuntimeAssetReplacement(input(
      replaceFixtureProject(source, invalidProject),
      replacement,
    ))).toMatchObject({ ok: false, code: 'invalid-document' })
  })

  it('does not mutate inputs and detaches every planned document/resource value', () => {
    const source = fixture('spatial-surface')
    const replacement = image('immutable-runtime-image', [21, 34, 55])
    const projectBefore = structuredClone(source.project)
    const sidecarBefore = structuredClone(source.sidecar.files)
    const targetBefore = structuredClone(source.target)
    const plan = planned(planCourseRuntimeAssetReplacement(input(source, replacement)))

    expect(source.project).toEqual(projectBefore)
    expect(Object.keys(source.sidecar.files)).toEqual(Object.keys(sidecarBefore))
    for (const [assetId, bytes] of Object.entries(sidecarBefore)) {
      expect(Array.from(source.sidecar.files[assetId] ?? [])).toEqual(Array.from(bytes))
    }
    expect(source.target).toEqual(targetBefore)
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.nextDocument)).toBe(true)
    expect(Object.isFrozen(plan.nextDocument.surfaces[0])).toBe(true)
    expect(Object.isFrozen(plan.selectionHint)).toBe(true)
    expect(Object.isFrozen(plan.feedback)).toBe(true)

    replacement.meta.filename = 'mutated-after-plan.png'
    replacement.bytes[0] = 255
    expect(plan.nextDocument.assets['immutable-runtime-image']?.filename)
      .toBe('immutable-runtime-image.png')
    expect(plan.resourceChanges.assetFileChanges?.[0]?.after?.[0]).toBe(21)
  })
})
