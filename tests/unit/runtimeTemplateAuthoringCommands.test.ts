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
import {
  captureCourseRuntimeTemplateCreationTarget,
  planRuntimeTemplateCreation,
  type CourseRuntimeTemplateCreationPlanResult,
  type CourseRuntimeTemplateCreationTarget,
  type CourseRuntimeTemplateOwner,
  type PlanRuntimeTemplateCreationInput,
} from '@/renderer/runtime/runtimeTemplateAuthoringCommands'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'

const CREATED_AT = '2026-08-24T00:00:00.000Z'
const COMMITTED_AT = '2026-08-24T12:30:00.000Z'
const NEW_ITEM_ID = 'runtime-template-new'

interface Fixture {
  readonly project: CourseProjectDocument
  readonly target: CourseRuntimeTemplateCreationTarget
  readonly currentIdentity: CurrentCourseAuthoringTargetIdentity
}

function baseProject(): CourseProjectDocument {
  let index = 0
  return createBlankCourseProject({
    id: 'runtime-template-project',
    title: 'Runtime template',
    now: CREATED_AT,
    idFactory: () => `fixture-${++index}`,
  })
}

function fixture(
  owner: CourseRuntimeTemplateOwner,
  options: {
    readonly project?: CourseProjectDocument
    readonly stateId?: string | null
    readonly currentStateId?: string | null
    readonly generation?: number
  } = {},
): Fixture {
  const project = options.project ?? baseProject()
  const location = project.locations[0]!
  const surface = project.surfaces[0]!
  if (location.kind !== 'slide-scene' || surface.type !== 'slide') {
    throw new Error('expected Slide fixture')
  }
  const generation = options.generation ?? 4
  const sessionToken = createSessionToken({
    locationId: location.id,
    surfaceType: 'slide',
    revision: project.revision,
  }, generation)
  const stateId = options.stateId ?? null
  const sceneId = owner === 'scene' ? location.sceneId : null
  const target = captureCourseRuntimeTemplateCreationTarget({
    sessionToken,
    projectId: project.id,
    surfaceId: surface.id,
    stateId,
    owner,
    sceneId,
  })
  return {
    project,
    target,
    currentIdentity: {
      projectId: project.id,
      documentRevision: project.revision,
      sessionToken,
      surfaceId: surface.id,
      stateId: options.currentStateId ?? stateId,
      owner,
      ownerKey: target.ownerKey,
    },
  }
}

function input(
  source: Fixture,
  patch: Partial<PlanRuntimeTemplateCreationInput> = {},
): PlanRuntimeTemplateCreationInput {
  return {
    project: source.project,
    currentIdentity: source.currentIdentity,
    target: source.target,
    newItemId: NEW_ITEM_ID,
    now: COMMITTED_AT,
    ...patch,
  }
}

function planned(result: CourseRuntimeTemplateCreationPlanResult) {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`${result.code}: ${result.reason}`)
  return result.plan
}

function createdRuntime(
  project: CourseProjectDocument,
  owner: CourseRuntimeTemplateOwner,
  itemId = NEW_ITEM_ID,
): RuntimeLayerItem {
  const item = owner === 'global'
    ? project.globalLayerItems.find((entry) => entry.item.layerItemId === itemId)?.item
    : project.surfaces[0]!.type === 'slide'
      ? project.surfaces[0]!.scenes[0]!.layerItems.find(
          (candidate) => candidate.layerItemId === itemId,
        )
      : undefined
  if (!item || item.kind !== 'runtime') throw new Error('missing created Runtime')
  return item
}

describe('planRuntimeTemplateCreation', () => {
  it.each([
    ['scene', '场景运行时', 'slide-scene'],
    ['global', '全局运行时', 'global-layer'],
  ] as const)(
    'creates the exact canonical %s template as one immutable transaction',
    (owner, label, carrier) => {
      const source = fixture(owner)
      const before = structuredClone(source.project)
      const plan = planned(planRuntimeTemplateCreation(input(source)))
      const item = createdRuntime(plan.nextDocument, owner)

      expect(item).toEqual({
        kind: 'runtime',
        layerItemId: NEW_ITEM_ID,
        label,
        frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 720 },
        order: 0,
        visible: true,
        locked: false,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'surface',
        playbackInitialVisibility: 'inherit',
        runtime: {
          protocol: 'canvas-runtime',
          runtimeApiVersion: 2,
          enabled: true,
          renderMode: 'phaser',
          source: `CoursewareRuntime.define({
  runtimeApiVersion: 2,
  create(ctx) {
    return {
      destroy() {},
    }
  },
})`,
          content: { values: {} },
          assets: {},
        },
      })
      expect(plan.nextDocument).toMatchObject({
        revision: before.revision + 1,
        updatedAt: COMMITTED_AT,
      })
      expect(plan.resourceChanges).toEqual({})
      expect(plan.selectionHint).toMatchObject({
        itemId: NEW_ITEM_ID,
        owner,
        carrier,
        locationId: source.target.locationId,
      })
      expect(plan.feedback).toEqual({
        kind: 'runtime-template-created',
        itemId: NEW_ITEM_ID,
        owner,
        carrier,
        protocol: 'canvas-runtime',
        runtimeApiVersion: 2,
      })
      expect(Object.isFrozen(plan)).toBe(true)
      expect(Object.isFrozen(plan.nextDocument)).toBe(true)
      expect(source.project).toEqual(before)
      expect(courseProjectDocumentSchema.safeParse(plan.nextDocument).success).toBe(true)
      if (owner === 'global') {
        expect(plan.nextDocument.globalLayerItems.find(
          (entry) => entry.item.layerItemId === NEW_ITEM_ID,
        )?.visibility).toEqual({ mode: 'all', locationIds: [] })
      }

      const step = createEditorTransactionStep(source.project, plan)
      expect(step).not.toBeNull()
      const resources = { componentPackages: {}, assetFiles: {} }
      const forward = applyEditorTransactionStep({
        document: source.project,
        resources,
      }, step!, 'forward')
      expect(createdRuntime(forward.document, owner)).toEqual(item)
      expect(forward.resources).toEqual(resources)
      expect(applyEditorTransactionStep(forward, step!, 'inverse').document)
        .toEqual(source.project)
    },
  )

  it('allocates the first unused unified order across owners', () => {
    const project = structuredClone(baseProject())
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    const controller = project.globalLayerItems[0]!.item
    const local = structuredClone(controller)
    local.layerItemId = 'local-existing'
    local.label = 'Local existing'
    local.order = 0
    surface.scenes[0]!.layerItems.push(local)
    const valid = courseProjectDocumentSchema.parse(project)

    expect(createdRuntime(
      planned(planRuntimeTemplateCreation(input(fixture('global', {
        project: valid,
      })))).nextDocument,
      'global',
    ).order).toBe(2)
  })

  it('allows state A to B switching only while captured state A still exists', () => {
    const project = structuredClone(baseProject())
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    const scene = surface.scenes[0]!
    scene.presentation = {
      initialStateId: 'state-a',
      states: [
        { id: 'state-a', name: 'A', layerItemOverrides: {} },
        { id: 'state-b', name: 'B', layerItemOverrides: {} },
      ],
    }
    const valid = courseProjectDocumentSchema.parse(project)
    const switched = fixture('scene', {
      project: valid,
      stateId: 'state-a',
      currentStateId: 'state-b',
    })

    expect(planRuntimeTemplateCreation(input(switched))).toMatchObject({
      ok: true,
      status: 'planned',
    })
    const missing = structuredClone(valid)
    const missingSurface = missing.surfaces[0]!
    if (missingSurface.type !== 'slide') throw new Error('expected Slide')
    missingSurface.scenes[0]!.presentation!.states = [
      { id: 'state-b', name: 'B', layerItemOverrides: {} },
    ]
    missingSurface.scenes[0]!.presentation!.initialStateId = 'state-b'
    expect(planRuntimeTemplateCreation(input(switched, { project: missing })))
      .toMatchObject({ ok: false, code: 'invalid-target' })
  })

  it.each([
    ['project-mismatch', (source: Fixture) => ({
      currentIdentity: { ...source.currentIdentity, projectId: 'other-project' },
    })],
    ['session-stale', (source: Fixture) => ({
      currentIdentity: {
        ...source.currentIdentity,
        sessionToken: {
          ...source.currentIdentity.sessionToken,
          generation: source.currentIdentity.sessionToken.generation + 1,
        },
      },
    })],
    ['surface-or-location', (source: Fixture) => ({
      currentIdentity: {
        ...source.currentIdentity,
        sessionToken: {
          ...source.currentIdentity.sessionToken,
          locationId: 'other-location',
        },
      },
    })],
    ['surface-or-location', (source: Fixture) => ({
      currentIdentity: {
        ...source.currentIdentity,
        surfaceId: 'other-surface',
      },
    })],
    ['owner-mismatch', (source: Fixture) => ({
      currentIdentity: {
        ...source.currentIdentity,
        owner: 'global' as const,
        ownerKey: 'global',
      },
    })],
    ['revision-conflict', (source: Fixture) => ({
      currentIdentity: {
        ...source.currentIdentity,
        documentRevision: source.currentIdentity.documentRevision + 1,
        sessionToken: {
          ...source.currentIdentity.sessionToken,
          revision: source.currentIdentity.sessionToken.revision + 1,
        },
      },
    })],
  ] as const)('rejects exact target drift: %s', (code, patch) => {
    const source = fixture('scene')
    expect(planRuntimeTemplateCreation(input(source, patch(source))))
      .toMatchObject({ ok: false, code })
  })

  it('rejects malformed slot, scene and owner identities without retargeting', () => {
    const source = fixture('scene')
    const invalidSlot = {
      ...source.target,
      slot: 'some-runtime-slot',
    } as unknown as CourseRuntimeTemplateCreationTarget
    expect(planRuntimeTemplateCreation(input(source, { target: invalidSlot })))
      .toMatchObject({ ok: false, code: 'invalid-target' })

    const wrongScene = { ...source.target, sceneId: 'another-scene' }
    expect(planRuntimeTemplateCreation(input(source, { target: wrongScene })))
      .toMatchObject({ ok: false, code: 'wrong-carrier' })

    const wrongKey = { ...source.target, ownerKey: 'scene:another-scene' }
    expect(planRuntimeTemplateCreation(input(source, {
      target: wrongKey,
      currentIdentity: { ...source.currentIdentity, ownerKey: wrongKey.ownerKey },
    }))).toMatchObject({ ok: false, code: 'wrong-carrier' })

    const unsupportedSurface = {
      ...source.target,
      surfaceType: 'flow',
    } as unknown as CourseRuntimeTemplateCreationTarget
    expect(planRuntimeTemplateCreation(input(source, {
      target: unsupportedSurface,
      currentIdentity: {
        ...source.currentIdentity,
        sessionToken: {
          ...source.currentIdentity.sessionToken,
          surfaceType: 'flow',
        },
      },
    }))).toMatchObject({ ok: false, code: 'invalid-target' })

    const missingLocation = {
      ...source.target,
      locationId: 'missing-location',
    }
    expect(planRuntimeTemplateCreation(input(source, {
      target: missingLocation,
      currentIdentity: {
        ...source.currentIdentity,
        sessionToken: {
          ...source.currentIdentity.sessionToken,
          locationId: missingLocation.locationId,
        },
      },
    }))).toMatchObject({ ok: false, code: 'surface-or-location' })
  })

  it.each(['scene', 'global'] as const)(
    'rejects an occupied %s slot and preserves the existing definition',
    (owner) => {
      const first = fixture(owner)
      const occupiedProject = planned(
        planRuntimeTemplateCreation(input(first)),
      ).nextDocument
      const occupied = fixture(owner, { project: occupiedProject })
      const before = structuredClone(occupiedProject)

      expect(planRuntimeTemplateCreation(input(occupied, {
        newItemId: 'another-runtime',
      }))).toMatchObject({ ok: false, code: 'runtime-already-exists' })
      expect(occupiedProject).toEqual(before)
      expect(createdRuntime(occupiedProject, owner).layerItemId).toBe(NEW_ITEM_ID)
    },
  )

  it('rejects invalid/conflicting IDs, clock and invalid output schema with zero writes', () => {
    const source = fixture('scene')
    const before = structuredClone(source.project)
    const existingId = source.project.globalLayerItems[0]!.item.layerItemId

    expect(planRuntimeTemplateCreation(input(source, { newItemId: ' bad-id ' })))
      .toMatchObject({ ok: false, code: 'invalid-item-id' })
    expect(planRuntimeTemplateCreation(input(source, { newItemId: existingId })))
      .toMatchObject({ ok: false, code: 'id-conflict' })
    expect(planRuntimeTemplateCreation(input(source, { now: 'tomorrow' })))
      .toMatchObject({ ok: false, code: 'invalid-clock' })

    const invalidDocument = structuredClone(source.project)
    invalidDocument.title = ''
    expect(planRuntimeTemplateCreation(input(source, { project: invalidDocument })))
      .toMatchObject({ ok: false, code: 'invalid-document' })
    expect(source.project).toEqual(before)
  })
})

describe('captureCourseRuntimeTemplateCreationTarget', () => {
  it('returns a deeply frozen exact Slide slot and rejects unsupported capture', () => {
    const source = fixture('scene', { stateId: 'state_initial' })
    expect(source.target).toMatchObject({
      documentRevision: source.project.revision,
      revisionPolicy: { kind: 'exact' },
      sessionGeneration: 4,
      surfaceType: 'slide',
      stateId: 'state_initial',
      owner: 'scene',
      slot: 'runtime-template',
    })
    expect(Object.isFrozen(source.target)).toBe(true)
    expect(Object.isFrozen(source.target.revisionPolicy)).toBe(true)

    expect(() => captureCourseRuntimeTemplateCreationTarget({
      sessionToken: { ...source.currentIdentity.sessionToken, surfaceType: 'flow' },
      projectId: source.project.id,
      surfaceId: source.target.surfaceId,
      stateId: null,
      owner: 'scene',
      sceneId: source.target.sceneId,
    })).toThrow(/Slide/)
    expect(() => captureCourseRuntimeTemplateCreationTarget({
      sessionToken: source.currentIdentity.sessionToken,
      projectId: source.project.id,
      surfaceId: source.target.surfaceId,
      stateId: null,
      owner: 'global',
      sceneId: source.target.sceneId,
    })).toThrow(/sceneId/)
  })
})
