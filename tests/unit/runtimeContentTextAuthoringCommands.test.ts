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
  captureCourseRuntimeContentTextTarget,
  courseRuntimeContentValueAuthoringField,
  planRuntimeContentTextUpdate,
  type CourseRuntimeContentTextTarget,
  type PlanRuntimeContentTextUpdateInput,
  type RuntimeContentTextAuthoringCarrier,
  type RuntimeContentTextAuthoringPlanResult,
} from '@/renderer/runtime/runtimeContentTextAuthoringCommands'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  CourseSurfaceDocument,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'

const CREATED_AT = '2026-08-24T00:00:00.000Z'
const COMMITTED_AT = '2026-08-24T11:30:00.000Z'
const ASSET_ID = 'runtime-content-static-asset'
const CONTENT_KEY = 'title/a~b'

type FixtureKind =
  | 'global'
  | 'slide-surface'
  | 'slide-scene'
  | 'flow-surface'
  | 'spatial-surface'
  | 'spatial-world'

interface RuntimeFixture {
  readonly project: CourseProjectDocument
  readonly target: CourseRuntimeContentTextTarget
  readonly currentIdentity: CurrentCourseAuthoringTargetIdentity
  readonly carrier: RuntimeContentTextAuthoringCarrier
  readonly itemId: string
  readonly sceneId: string | null
}

function runtimeLayer(
  id: string,
  protocol: 'canvas-runtime' | 'surface-runtime',
  options: { readonly locked?: boolean } = {},
): RuntimeLayerItem {
  const value = protocol === 'canvas-runtime' ? 'Canvas Runtime' : 'Surface Runtime'
  return {
    kind: 'runtime',
    layerItemId: id,
    label: `Runtime ${id}`,
    frame: { mode: 'absolute', x: 120, y: 80, width: 640, height: 360 },
    order: 100,
    // Runtime enabled and LayerItem visible are intentionally independent.
    visible: false,
    locked: options.locked ?? false,
    rotation: 7,
    opacity: 0.9,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'hidden',
    runtime: protocol === 'canvas-runtime'
      ? {
          protocol,
          runtimeApiVersion: 2,
          enabled: true,
          renderMode: 'hybrid',
          source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
          content: {
            values: { [CONTENT_KEY]: value, preserved: 'API 2 preserved text' },
            metadata: {
              [CONTENT_KEY]: { label: '标题', multiline: true, maxLength: 120 },
            },
          },
          assets: { hero: { assetId: ASSET_ID } },
          nodeBindings: { title: 'node-title' },
          staticFallback: { assetId: ASSET_ID, coverage: 'scene' },
        }
      : {
          protocol,
          runtimeApiVersion: 3,
          enabled: false,
          renderMode: 'dom',
          source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {destroy(){}}}})',
          content: {
            values: { [CONTENT_KEY]: value, preserved: 'API 3 preserved text' },
            metadata: {
              [CONTENT_KEY]: { label: '标题', description: '只改这个键' },
            },
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
    readonly locked?: boolean
  } = {},
): RuntimeFixture {
  const protocol = options.protocol ?? (
    kind.startsWith('flow') || kind.startsWith('spatial')
      ? 'surface-runtime'
      : 'canvas-runtime'
  )
  const base = createBlankCourseProject({
    id: `runtime-content-text-${kind}`,
    title: `Runtime content text ${kind}`,
    now: CREATED_AT,
    includeDefaultController: false,
    controls: 'none',
  })
  const itemId = `runtime-content-${kind}`
  const item = runtimeLayer(itemId, protocol, options)
  const assets = {
    [ASSET_ID]: {
      id: ASSET_ID,
      filename: 'runtime-content-static.png',
      mimeType: 'image/png',
      kind: 'image' as const,
      path: 'assets/runtime-content-static.png',
      byteLength: 4,
      width: 800,
      height: 600,
    },
  }
  let project: CourseProjectDocument
  let owner: CourseAuthoringOwner
  let sceneId: string | null = null
  let carrier: RuntimeContentTextAuthoringCarrier

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
    const surfaceId = 'runtime-content-flow-surface'
    const blockId = 'runtime-content-flow-heading'
    project = {
      ...base,
      assets,
      locations: [{
        id: 'runtime-content-flow-location',
        label: 'Flow page',
        kind: 'flow-block',
        surfaceId,
        blockId,
      }],
      startLocationId: 'runtime-content-flow-location',
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
    const surfaceId = 'runtime-content-spatial-surface'
    const frameId = 'runtime-content-camera-home'
    project = {
      ...base,
      assets,
      locations: [{
        id: 'runtime-content-spatial-location',
        label: 'Spatial home',
        kind: 'spatial-camera',
        surfaceId,
        cameraFrameId: frameId,
      }],
      startLocationId: 'runtime-content-spatial-location',
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
  const initialValue = findRuntime(project, itemId).runtime.content.values[CONTENT_KEY]!
  const target = captureCourseRuntimeContentTextTarget({
    sessionToken,
    projectId: project.id,
    surfaceId: surface.id,
    stateId: null,
    owner,
    sceneId,
    itemId,
    contentKey: CONTENT_KEY,
    initialValue,
  })
  return {
    project,
    target,
    currentIdentity: {
      projectId: project.id,
      documentRevision: project.revision,
      sessionToken,
      surfaceId: surface.id,
      stateId: null,
      owner,
      ownerKey: target.courseTarget.ownerKey,
    },
    carrier,
    itemId,
    sceneId,
  }
}

function findRuntime(
  project: CourseProjectDocument,
  itemId: string,
): RuntimeLayerItem {
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
        const local = scene.layerItems.find((candidate) => (
          candidate.layerItemId === itemId
        ))
        if (local?.kind === 'runtime') return local
      }
    } else if (surface.type === 'spatial-2d') {
      const local = surface.world.layerItems.find((candidate) => (
        candidate.layerItemId === itemId
      ))
      if (local?.kind === 'runtime') return local
    }
  }
  throw new Error(`missing Runtime ${itemId}`)
}

function input(
  source: RuntimeFixture,
  patch: Partial<PlanRuntimeContentTextUpdateInput> = {},
): PlanRuntimeContentTextUpdateInput {
  return {
    project: source.project,
    currentIdentity: source.currentIdentity,
    target: source.target,
    value: '已更新的 Runtime 文字',
    now: COMMITTED_AT,
    ...patch,
  }
}

function planned(result: RuntimeContentTextAuthoringPlanResult) {
  expect(result.ok).toBe(true)
  if (!result.ok || result.status !== 'planned') {
    throw new Error('expected Runtime content text plan')
  }
  return result.plan
}

describe('Runtime content text authoring target', () => {
  it('escapes JSON Pointer segments and captures one deeply stable field identity', () => {
    const source = fixture('slide-scene')
    expect(courseRuntimeContentValueAuthoringField('title/a~b')).toBe(
      'runtime/content/values/title~1a~0b',
    )
    expect(source.target).toMatchObject({
      contentKey: CONTENT_KEY,
      initialValue: 'Canvas Runtime',
      courseTarget: {
        itemId: source.itemId,
        owner: 'scene',
      },
    })
    expect(source.target.courseTarget.authoringAddress).toContain(
      'field=runtime%2Fcontent%2Fvalues%2Ftitle~1a~0b',
    )
    expect(Object.isFrozen(source.target)).toBe(true)
    expect(Object.isFrozen(source.target.courseTarget)).toBe(true)
  })

  it.each([
    '',
    '   ',
    '__proto__',
    'prototype',
    'constructor',
    'x'.repeat(257),
  ])('rejects invalid content key %j during capture', (contentKey) => {
    const source = fixture('global')
    const stable = source.target.courseTarget
    expect(() => captureCourseRuntimeContentTextTarget({
      sessionToken: source.currentIdentity.sessionToken,
      projectId: stable.projectId,
      surfaceId: stable.surfaceId,
      stateId: stable.stateId,
      owner: stable.owner,
      sceneId: source.sceneId,
      itemId: stable.itemId,
      contentKey,
      initialValue: source.target.initialValue,
    })).toThrow(/Runtime 文字键/)
  })
})

describe('planRuntimeContentTextUpdate', () => {
  it.each([
    ['global', 'global-layer', 2, 'canvas-runtime'],
    ['slide-surface', 'surface-layer', 2, 'canvas-runtime'],
    ['slide-scene', 'slide-scene', 2, 'canvas-runtime'],
    ['flow-surface', 'surface-layer', 3, 'surface-runtime'],
    ['spatial-surface', 'surface-layer', 3, 'surface-runtime'],
    ['spatial-world', 'spatial-world', 3, 'surface-runtime'],
  ] as const)(
    'updates exactly one key for %s while preserving API %i %s and LayerItem fields',
    (kind, carrier, api, protocol) => {
      const source = fixture(kind)
      const before = structuredClone(source.project)
      const beforeItem = structuredClone(findRuntime(before, source.itemId))
      const plan = planned(planRuntimeContentTextUpdate(input(source)))
      const afterItem = findRuntime(plan.nextDocument, source.itemId)
      const expectedItem = structuredClone(beforeItem)
      expectedItem.runtime.content.values[CONTENT_KEY] = input(source).value

      expect(afterItem).toEqual(expectedItem)
      expect(afterItem.visible).toBe(false)
      expect(afterItem.runtime).toMatchObject({ protocol, runtimeApiVersion: api })
      expect(afterItem.runtime.content.values.preserved).toBe(
        beforeItem.runtime.content.values.preserved,
      )
      expect(plan.nextDocument.revision).toBe(before.revision + 1)
      expect(plan.nextDocument.updatedAt).toBe(COMMITTED_AT)
      expect(plan.resourceChanges).toEqual({})
      expect(plan.selectionHint).toMatchObject({
        carrier,
        itemId: source.itemId,
        contentKey: CONTENT_KEY,
        authoringAddress: source.target.courseTarget.authoringAddress,
      })
      expect(plan.feedback).toMatchObject({
        kind: 'runtime-content-text-updated',
        carrier,
        protocol,
        runtimeApiVersion: api,
        previousValue: source.target.initialValue,
        value: input(source).value,
      })

      const normalized = structuredClone(plan.nextDocument)
      normalized.revision = before.revision
      normalized.updatedAt = before.updatedAt
      findRuntime(normalized, source.itemId).runtime.content.values[CONTENT_KEY] =
        beforeItem.runtime.content.values[CONTENT_KEY]!
      expect(normalized).toEqual(before)
    },
  )

  it('returns a frozen true no-op for identical text', () => {
    const source = fixture('spatial-world')
    const result = planRuntimeContentTextUpdate(input(source, {
      value: source.target.initialValue,
    }))

    expect(result).toMatchObject({
      ok: true,
      status: 'no-op',
      plan: null,
      feedback: {
        kind: 'runtime-content-text-unchanged',
        protocol: 'surface-runtime',
        runtimeApiVersion: 3,
      },
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(source.project.revision).toBe(0)
  })

  it('produces one reversible EditorTransactionStep with no resource delta', () => {
    const source = fixture('flow-surface')
    const plan = planned(planRuntimeContentTextUpdate(input(source)))
    const step = createEditorTransactionStep(source.project, plan)
    expect(step).not.toBeNull()

    const resources = { componentPackages: {}, assetFiles: {} }
    const forward = applyEditorTransactionStep({
      document: source.project,
      resources,
    }, step!, 'forward')
    expect(findRuntime(forward.document, source.itemId).runtime.content.values[CONTENT_KEY])
      .toBe(input(source).value)
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
    const target = captureCourseRuntimeContentTextTarget({
      sessionToken: initial.currentIdentity.sessionToken,
      projectId: valid.id,
      surfaceId: surface.id,
      stateId: 'state-a',
      owner: 'scene',
      sceneId: scene.id,
      itemId: initial.itemId,
      contentKey: CONTENT_KEY,
      initialValue: initial.target.initialValue,
    })
    const withStates: RuntimeFixture = {
      ...initial,
      project: valid,
      target,
      currentIdentity: { ...initial.currentIdentity, stateId: 'state-b' },
    }
    expect(planRuntimeContentTextUpdate(input(withStates))).toMatchObject({
      ok: true,
      status: 'planned',
    })

    const lockedProject = structuredClone(valid)
    const lockedSurface = lockedProject.surfaces[0]!
    if (lockedSurface.type !== 'slide') throw new Error('expected Slide')
    lockedSurface.scenes[0]!.presentation!.states[0]!
      .layerItemOverrides[initial.itemId] = { locked: true }
    expect(planRuntimeContentTextUpdate(input({
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
        owner: 'global' as const,
        ownerKey: 'global',
      },
    })],
  ] as const)('rejects exact target drift: %s', (expectedCode, patch) => {
    const source = fixture('slide-scene')
    expect(planRuntimeContentTextUpdate(input(source, patch(source))))
      .toMatchObject({ ok: false, code: expectedCode })
  })

  it('rejects missing, moved, wrong-type, re-addressed, missing-key and Flow-block targets', () => {
    const source = fixture('flow-surface')

    const missing = structuredClone(source.project)
    missing.surfaces[0]!.surfaceLayerItems = []
    expect(planRuntimeContentTextUpdate(input(source, { project: missing })))
      .toMatchObject({ ok: false, code: 'item-missing' })

    const moved = structuredClone(source.project)
    const entry = moved.surfaces[0]!.surfaceLayerItems.shift()!
    moved.globalLayerItems.push(entry)
    expect(planRuntimeContentTextUpdate(input(source, { project: moved })))
      .toMatchObject({ ok: false, code: 'wrong-carrier' })

    const wrongType = structuredClone(source.project)
    ;(wrongType.surfaces[0]!.surfaceLayerItems[0]!.item as { kind: string }).kind = 'native'
    expect(planRuntimeContentTextUpdate(input(source, { project: wrongType })))
      .toMatchObject({ ok: false, code: 'invalid-target' })

    expect(planRuntimeContentTextUpdate(input(source, {
      target: {
        ...source.target,
        courseTarget: {
          ...source.target.courseTarget,
          authoringAddress: `${source.target.courseTarget.authoringAddress}-retargeted`,
        },
      },
    }))).toMatchObject({ ok: false, code: 'invalid-target' })

    const keyMissing = structuredClone(source.project)
    delete findRuntime(keyMissing, source.itemId).runtime.content.values[CONTENT_KEY]
    expect(planRuntimeContentTextUpdate(input(source, { project: keyMissing })))
      .toMatchObject({ ok: false, code: 'content-key-missing' })

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
    expect(planRuntimeContentTextUpdate(input(source, { project: flowBlock })))
      .toMatchObject({ ok: false, code: 'wrong-carrier' })
  })

  it('rejects base lock, changed initial text, invalid key and non-string values', () => {
    const locked = fixture('global', { locked: true })
    expect(planRuntimeContentTextUpdate(input(locked)))
      .toMatchObject({ ok: false, code: 'target-locked' })

    const changed = fixture('slide-scene')
    const changedProject = structuredClone(changed.project)
    findRuntime(changedProject, changed.itemId).runtime.content.values[CONTENT_KEY] =
      'concurrent same-revision change'
    expect(planRuntimeContentTextUpdate(input(changed, { project: changedProject })))
      .toMatchObject({ ok: false, code: 'content-changed' })

    expect(planRuntimeContentTextUpdate(input(changed, {
      target: { ...changed.target, contentKey: '__proto__' },
    }))).toMatchObject({ ok: false, code: 'invalid-target' })
    expect(planRuntimeContentTextUpdate(input(changed, {
      value: 42 as unknown as string,
    }))).toMatchObject({ ok: false, code: 'invalid-value' })
  })

  it('rejects invalid clock, captured state, current non-Slide state and full V9 document', () => {
    const source = fixture('slide-scene')
    expect(planRuntimeContentTextUpdate(input(source, { now: 'not-a-clock' })))
      .toMatchObject({ ok: false, code: 'invalid-clock' })

    expect(planRuntimeContentTextUpdate(input(source, {
      target: {
        ...source.target,
        courseTarget: { ...source.target.courseTarget, stateId: 'missing-state' },
      },
    }))).toMatchObject({ ok: false, code: 'invalid-target' })

    const flow = fixture('flow-surface')
    expect(planRuntimeContentTextUpdate(input(flow, {
      currentIdentity: { ...flow.currentIdentity, stateId: 'state-a' },
    }))).toMatchObject({ ok: false, code: 'invalid-target' })

    const invalidProject = structuredClone(source.project)
    invalidProject.locations.push(structuredClone(invalidProject.locations[0]!))
    expect(planRuntimeContentTextUpdate(input(source, { project: invalidProject })))
      .toMatchObject({ ok: false, code: 'invalid-document' })
  })

  it('does not mutate inputs and deeply freezes the detached plan', () => {
    const source = fixture('spatial-world')
    const before = structuredClone(source.project)
    const targetBefore = structuredClone(source.target)
    const plan = planned(planRuntimeContentTextUpdate(input(source)))

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
