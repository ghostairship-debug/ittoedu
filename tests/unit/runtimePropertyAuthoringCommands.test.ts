import { describe, expect, it } from 'vitest'
import {
  applyEditorTransactionStep,
  createEditorTransactionStep,
} from '@/renderer/authoring/editorTransaction'
import {
  createSessionToken,
  type CurrentCourseAuthoringTargetIdentity,
} from '@/renderer/authoring/courseAuthoringSession'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { selectRuntimeInspectorAuthoringView } from '@/renderer/runtime/runtimeInspectorAuthoringView'
import {
  planRuntimePropertyUpdate,
  retargetCourseRuntimeProperty,
  type CourseRuntimePropertyTarget,
  type CourseRuntimePropertyUpdate,
  type PlanRuntimePropertyUpdateInput,
  type RuntimePropertyAuthoringPlanResult,
} from '@/renderer/runtime/runtimePropertyAuthoringCommands'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'

const CREATED_AT = '2026-08-24T00:00:00.000Z'
const COMMITTED_AT = '2026-08-24T12:00:00.000Z'

type CarrierKind = 'global' | 'surface' | 'scene' | 'world'

interface RuntimePropertyFixture {
  readonly project: CourseProjectDocument
  readonly target: CourseRuntimePropertyTarget
  readonly currentIdentity: CurrentCourseAuthoringTargetIdentity
  readonly itemId: string
}

function runtimeLayer(
  id: string,
  protocol: 'canvas-runtime' | 'surface-runtime',
  locked = false,
): RuntimeLayerItem {
  return {
    kind: 'runtime',
    layerItemId: id,
    label: `Runtime ${id}`,
    frame: { mode: 'absolute', x: 100, y: 80, width: 640, height: 360 },
    order: 20,
    visible: false,
    locked,
    rotation: 5,
    opacity: 0.75,
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
            values: { title: 'Canvas', preserved: 'unchanged' },
            metadata: { title: { label: '标题', maxLength: 80 } },
          },
          assets: {},
          nodeBindings: { title: 'node-title' },
        }
      : {
          protocol,
          runtimeApiVersion: 3,
          enabled: false,
          renderMode: 'dom',
          source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {destroy(){}}}})',
          content: {
            values: { title: 'Surface', preserved: 'unchanged' },
            metadata: { title: { label: '标题' } },
          },
          assets: {},
          nodeBindings: { title: 'node-title' },
        },
  }
}

function projectFor(kind: CarrierKind, locked = false): {
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly editingScope: 'scene' | 'global'
  readonly itemId: string
} {
  const base = createBlankCourseProject({
    id: `runtime-property-${kind}`,
    title: `Runtime property ${kind}`,
    now: CREATED_AT,
    includeDefaultController: false,
    controls: 'none',
  })
  const itemId = `runtime-${kind}`
  if (kind === 'global') {
    return {
      project: courseProjectDocumentSchema.parse({
        ...base,
        globalLayerItems: [{
          item: runtimeLayer(itemId, 'canvas-runtime', locked),
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
        surfaces: [{
          ...surface,
          scenes: [{
            ...surface.scenes[0]!,
            layerItems: [runtimeLayer(itemId, 'canvas-runtime', locked)],
          }],
        }],
      }),
      locationId: base.locations[0]!.id,
      editingScope: 'scene',
      itemId,
    }
  }
  if (kind === 'surface') {
    const surfaceId = 'runtime-property-flow'
    const blockId = 'runtime-property-heading'
    return {
      project: courseProjectDocumentSchema.parse({
        ...base,
        locations: [{
          id: 'runtime-property-flow-location',
          label: 'Flow',
          kind: 'flow-block',
          surfaceId,
          blockId,
        }],
        startLocationId: 'runtime-property-flow-location',
        surfaces: [{
          id: surfaceId,
          title: 'Flow',
          type: 'flow',
          layout: { readingWidth: 760, wideContentWidth: 1120 },
          surfaceLayerItems: [{
            item: runtimeLayer(itemId, 'surface-runtime', locked),
            visibility: { mode: 'all', locationIds: [] },
          }],
          blocks: [{ id: blockId, type: 'heading', level: 1, text: 'Flow' }],
        }],
      }),
      locationId: 'runtime-property-flow-location',
      editingScope: 'scene',
      itemId,
    }
  }
  const surfaceId = 'runtime-property-spatial'
  const frameId = 'runtime-property-camera'
  return {
    project: courseProjectDocumentSchema.parse({
      ...base,
      locations: [{
        id: 'runtime-property-spatial-location',
        label: 'Spatial',
        kind: 'spatial-camera',
        surfaceId,
        cameraFrameId: frameId,
      }],
      startLocationId: 'runtime-property-spatial-location',
      surfaces: [{
        id: surfaceId,
        title: 'Spatial',
        type: 'spatial-2d',
        surfaceLayerItems: [],
        world: {
          bounds: { mode: 'infinite' },
          layerItems: [runtimeLayer(itemId, 'surface-runtime', locked)],
        },
        camera: {
          home: { x: 0, y: 0, zoom: 1 },
          frames: [{ id: frameId, name: 'Home', x: 0, y: 0, zoom: 1 }],
        },
        semanticZoom: [],
      }],
    }),
    locationId: 'runtime-property-spatial-location',
    editingScope: 'scene',
    itemId,
  }
}

function fixture(
  kind: CarrierKind,
  field: 'enabled' | 'renderMode',
  options: { readonly locked?: boolean; readonly activeStateId?: string | null } = {},
): RuntimePropertyFixture {
  const source = projectFor(kind, options.locked)
  const surface = source.project.surfaces[0]!
  const sessionToken = createSessionToken({
    locationId: source.locationId,
    surfaceType: surface.type,
    revision: source.project.revision,
  }, 5)
  const view = selectRuntimeInspectorAuthoringView({
    project: source.project,
    locationId: source.locationId,
    editingScope: source.editingScope,
    activeStateId: options.activeStateId,
    sessionToken,
  })
  if (view.availability !== 'available') throw new Error(view.label)
  const target = field === 'enabled' ? view.enabledTarget : view.renderModeTarget
  return {
    project: source.project,
    target,
    currentIdentity: {
      projectId: source.project.id,
      documentRevision: source.project.revision,
      sessionToken,
      surfaceId: surface.id,
      stateId: options.activeStateId ?? null,
      owner: target.courseTarget.owner,
      ownerKey: target.courseTarget.ownerKey,
    },
    itemId: source.itemId,
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
        const local = scene.layerItems.find((item) => item.layerItemId === itemId)
        if (local?.kind === 'runtime') return local
      }
    } else if (surface.type === 'spatial-2d') {
      const world = surface.world.layerItems.find(
        (item) => item.layerItemId === itemId,
      )
      if (world?.kind === 'runtime') return world
    }
  }
  throw new Error(`missing Runtime ${itemId}`)
}

function input(
  source: RuntimePropertyFixture,
  update: CourseRuntimePropertyUpdate,
  patch: Partial<PlanRuntimePropertyUpdateInput> = {},
): PlanRuntimePropertyUpdateInput {
  return {
    project: source.project,
    currentIdentity: source.currentIdentity,
    target: source.target,
    update,
    now: COMMITTED_AT,
    ...patch,
  }
}

function planned(result: RuntimePropertyAuthoringPlanResult) {
  expect(result.ok).toBe(true)
  if (!result.ok || result.status !== 'planned') {
    throw new Error('expected Runtime property plan')
  }
  return result.plan
}

describe('planRuntimePropertyUpdate successful plans', () => {
  it.each([
    ['global', 'enabled', { field: 'enabled', value: false }, 'global-layer'],
    ['surface', 'enabled', { field: 'enabled', value: true }, 'surface-layer'],
    ['scene', 'renderMode', { field: 'renderMode', value: 'phaser' }, 'slide-scene'],
    ['world', 'enabled', { field: 'enabled', value: true }, 'spatial-world'],
  ] as const)(
    'plans one exact %s %s update for the %s carrier',
    (kind, field, update, carrier) => {
      const source = fixture(kind, field)
      const before = structuredClone(findRuntime(source.project, source.itemId))
      const plan = planned(planRuntimePropertyUpdate(input(source, update)))
      const after = findRuntime(plan.nextDocument, source.itemId)

      expect(plan.projectId).toBe(source.project.id)
      expect(plan.baseRevision).toBe(source.project.revision)
      expect(plan.nextDocument.revision).toBe(source.project.revision + 1)
      expect(plan.nextDocument.updatedAt).toBe(COMMITTED_AT)
      expect(plan.resourceChanges).toEqual({})
      expect(plan.selectionHint).toMatchObject({
        itemId: source.itemId,
        field,
        carrier,
        authoringAddress: source.target.courseTarget.authoringAddress,
      })
      expect(plan.feedback).toMatchObject({
        kind: 'runtime-property-updated',
        itemId: source.itemId,
        field,
        carrier,
        value: update.value,
      })
      expect(after.runtime[field]).toBe(update.value)
      expect({ ...after, runtime: { ...after.runtime, [field]: before.runtime[field] } })
        .toEqual(before)
      expect(findRuntime(source.project, source.itemId)).toEqual(before)
      expect(Object.isFrozen(plan)).toBe(true)
      expect(Object.isFrozen(plan.nextDocument)).toBe(true)
    },
  )

  it.each(['phaser', 'dom'] as const)(
    'accepts API 2 renderMode %s without changing protocol or API',
    (renderMode) => {
      const source = fixture('scene', 'renderMode')
      const beforeRuntime = structuredClone(findRuntime(source.project, source.itemId).runtime)
      const plan = planned(planRuntimePropertyUpdate(input(source, {
        field: 'renderMode',
        value: renderMode,
      })))
      const runtime = findRuntime(plan.nextDocument, source.itemId).runtime

      expect(runtime).toEqual({ ...beforeRuntime, renderMode })
      expect(runtime.protocol).toBe('canvas-runtime')
      expect(runtime.runtimeApiVersion).toBe(2)
    },
  )

  it('keeps Runtime enabled independent from LayerItem visibility', () => {
    const source = fixture('surface', 'enabled')
    const before = findRuntime(source.project, source.itemId)
    expect(before.runtime.enabled).toBe(false)
    expect(before.visible).toBe(false)

    const plan = planned(planRuntimePropertyUpdate(input(source, {
      field: 'enabled',
      value: true,
    })))
    const after = findRuntime(plan.nextDocument, source.itemId)
    expect(after.runtime.enabled).toBe(true)
    expect(after.visible).toBe(false)
  })

  it('round-trips one transaction step with empty resource changes', () => {
    const source = fixture('global', 'enabled')
    const plan = planned(planRuntimePropertyUpdate(input(source, {
      field: 'enabled',
      value: false,
    })))
    const step = createEditorTransactionStep(source.project, plan)
    expect(step).not.toBeNull()
    if (!step) throw new Error('expected step')

    const next = applyEditorTransactionStep(
      {
        document: source.project,
        resources: { componentPackages: {}, assetFiles: {} },
      },
      step,
      'forward',
    )
    expect(findRuntime(next.document, source.itemId).runtime.enabled).toBe(false)
    const previous = applyEditorTransactionStep(next, step, 'inverse')
    expect(previous.document).toEqual(source.project)
    expect(previous.resources).toEqual({ componentPackages: {}, assetFiles: {} })
  })
})

describe('planRuntimePropertyUpdate guards', () => {
  it('returns a frozen no-op with feedback and no transaction', () => {
    const source = fixture('scene', 'renderMode')
    const result = planRuntimePropertyUpdate(input(source, {
      field: 'renderMode',
      value: 'hybrid',
    }))

    expect(result).toMatchObject({
      ok: true,
      status: 'no-op',
      plan: null,
      feedback: {
        kind: 'runtime-property-unchanged',
        previousValue: 'hybrid',
        value: 'hybrid',
      },
    })
    expect(Object.isFrozen(result)).toBe(true)
  })

  it.each(['phaser', 'hybrid'] as const)(
    'rejects API 3 renderMode %s and preserves DOM-only semantics',
    (renderMode) => {
      const source = fixture('world', 'renderMode')
      expect(planRuntimePropertyUpdate(input(source, {
        field: 'renderMode',
        value: renderMode,
      }))).toMatchObject({
        ok: false,
        code: 'invalid-value',
        reason: expect.stringContaining('API 3'),
      })
    },
  )

  it('accepts API 3 DOM as a valid no-op', () => {
    const source = fixture('surface', 'renderMode')
    expect(planRuntimePropertyUpdate(input(source, {
      field: 'renderMode',
      value: 'dom',
    }))).toMatchObject({ ok: true, status: 'no-op' })
  })

  it('rejects a target/update field mismatch', () => {
    const source = fixture('global', 'enabled')
    expect(planRuntimePropertyUpdate(input(source, {
      field: 'renderMode',
      value: 'dom',
    }))).toMatchObject({ ok: false, code: 'invalid-target' })
  })

  it.each([
    { field: 'enabled', value: 'true' },
    { field: 'renderMode', value: 'canvas' },
  ])('rejects invalid scalar update %#', (update) => {
    const source = fixture(
      'global',
      update.field === 'enabled' ? 'enabled' : 'renderMode',
    )
    expect(planRuntimePropertyUpdate(input(
      source,
      update as unknown as CourseRuntimePropertyUpdate,
    ))).toMatchObject({ ok: false, code: 'invalid-value' })
  })

  it('rejects an invalid initial scalar target', () => {
    const source = fixture('global', 'enabled')
    const target = {
      ...source.target,
      initialValue: 'true',
    } as unknown as CourseRuntimePropertyTarget
    expect(planRuntimePropertyUpdate(input(
      source,
      { field: 'enabled', value: false },
      { target },
    ))).toMatchObject({ ok: false, code: 'invalid-target' })
  })

  it('rejects a tampered exact field address', () => {
    const source = fixture('scene', 'renderMode')
    const target = {
      ...source.target,
      courseTarget: {
        ...source.target.courseTarget,
        authoringAddress: source.target.courseTarget.authoringAddress.replace(
          'runtime%2FrenderMode',
          'runtime%2Fenabled',
        ),
      },
    } as CourseRuntimePropertyTarget
    expect(planRuntimePropertyUpdate(input(
      source,
      { field: 'renderMode', value: 'dom' },
      { target },
    ))).toMatchObject({ ok: false, code: 'invalid-target' })
  })

  it('rejects a changed initial value even when revision was not advanced', () => {
    const source = fixture('scene', 'enabled')
    const project = structuredClone(source.project)
    findRuntime(project, source.itemId).runtime.enabled = false

    expect(planRuntimePropertyUpdate(input(
      source,
      { field: 'enabled', value: false },
      { project },
    ))).toMatchObject({ ok: false, code: 'property-changed' })
  })

  it('rejects base and named-state effective locks', () => {
    const baseLocked = fixture('global', 'enabled', { locked: true })
    expect(planRuntimePropertyUpdate(input(baseLocked, {
      field: 'enabled',
      value: false,
    }))).toMatchObject({ ok: false, code: 'target-locked' })

    const source = projectFor('scene')
    const project = structuredClone(source.project)
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    surface.scenes[0]!.presentation = {
      initialStateId: 'locked-state',
      states: [{
        id: 'locked-state',
        name: 'Locked',
        layerItemOverrides: { [source.itemId]: { locked: true } },
      }],
    }
    const lockedState = fixtureFromProject(
      courseProjectDocumentSchema.parse(project),
      source.locationId,
      source.editingScope,
      source.itemId,
      'enabled',
      'locked-state',
    )
    expect(planRuntimePropertyUpdate(input(lockedState, {
      field: 'enabled',
      value: false,
    }))).toMatchObject({ ok: false, code: 'target-locked' })
  })

  it('allows named-state navigation alone while honoring the captured state lock', () => {
    const source = projectFor('scene')
    const project = structuredClone(source.project)
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    surface.scenes[0]!.presentation = {
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
    const valid = courseProjectDocumentSchema.parse(project)
    const atA = fixtureFromProject(
      valid,
      source.locationId,
      source.editingScope,
      source.itemId,
      'enabled',
      'state-a',
    )
    const currentIdentity = {
      ...atA.currentIdentity,
      stateId: 'state-b',
    }

    expect(planRuntimePropertyUpdate(input(
      atA,
      { field: 'enabled', value: false },
      { currentIdentity },
    ))).toMatchObject({ ok: true, status: 'planned' })
  })

  it('reports wrong carrier after the exact item moves', () => {
    const source = fixture('scene', 'enabled')
    const project = structuredClone(source.project)
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    const item = surface.scenes[0]!.layerItems.shift()
    if (!item) throw new Error('expected Runtime')
    project.globalLayerItems.push({
      item,
      visibility: { mode: 'all', locationIds: [] },
    })

    expect(planRuntimePropertyUpdate(input(
      source,
      { field: 'enabled', value: false },
      { project },
    ))).toMatchObject({ ok: false, code: 'wrong-carrier' })
  })

  it('reports item-missing after the exact item is deleted', () => {
    const source = fixture('world', 'enabled')
    const project = structuredClone(source.project)
    const surface = project.surfaces[0]!
    if (surface.type !== 'spatial-2d') throw new Error('expected Spatial')
    surface.world.layerItems = []

    expect(planRuntimePropertyUpdate(input(
      source,
      { field: 'enabled', value: true },
      { project },
    ))).toMatchObject({ ok: false, code: 'item-missing' })
  })

  it.each([
    ['session-stale', { sessionGeneration: 99 }, {}],
    ['revision-conflict', {}, { documentRevision: 99 }],
  ] as const)('reports %s without producing a plan', (code, targetPatch, identityPatch) => {
    const source = fixture('global', 'enabled')
    const target = {
      ...source.target,
      courseTarget: { ...source.target.courseTarget, ...targetPatch },
    } as CourseRuntimePropertyTarget
    const currentIdentity = {
      ...source.currentIdentity,
      ...identityPatch,
    }
    expect(planRuntimePropertyUpdate(input(
      source,
      { field: 'enabled', value: false },
      { target, currentIdentity },
    ))).toMatchObject({ ok: false, code })
  })

  it('rejects an invalid explicit clock', () => {
    const source = fixture('global', 'enabled')
    expect(planRuntimePropertyUpdate(input(
      source,
      { field: 'enabled', value: false },
      { now: 'tomorrow' },
    ))).toMatchObject({ ok: false, code: 'invalid-clock' })
  })

  it('rejects an otherwise invalid V9 document on the no-op path', () => {
    const source = fixture('scene', 'enabled')
    const project = { ...source.project, title: '' }
    expect(planRuntimePropertyUpdate(input(
      source,
      { field: 'enabled', value: true },
      { project },
    ))).toMatchObject({ ok: false, code: 'invalid-document' })
  })

  it('retarget helper rejects a malformed scene ownerKey', () => {
    const source = fixture('scene', 'enabled')
    expect(() => retargetCourseRuntimeProperty(
      { ...source.target.courseTarget, ownerKey: 'scene:' },
      { field: 'enabled', initialValue: true },
    )).toThrow(/ownerKey/)
  })
})

function fixtureFromProject(
  project: CourseProjectDocument,
  locationId: string,
  editingScope: 'scene' | 'global',
  itemId: string,
  field: 'enabled' | 'renderMode',
  activeStateId: string | null,
): RuntimePropertyFixture {
  const surface = project.surfaces[0]!
  const sessionToken = createSessionToken({
    locationId,
    surfaceType: surface.type,
    revision: project.revision,
  }, 5)
  const view = selectRuntimeInspectorAuthoringView({
    project,
    locationId,
    editingScope,
    activeStateId,
    sessionToken,
  })
  if (view.availability !== 'available') throw new Error(view.label)
  const target = field === 'enabled' ? view.enabledTarget : view.renderModeTarget
  return {
    project,
    target,
    currentIdentity: {
      projectId: project.id,
      documentRevision: project.revision,
      sessionToken,
      surfaceId: surface.id,
      stateId: activeStateId,
      owner: target.courseTarget.owner,
      ownerKey: target.courseTarget.ownerKey,
    },
    itemId,
  }
}
