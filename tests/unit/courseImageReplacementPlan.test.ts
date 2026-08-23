import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  captureCourseAuthoringTarget,
  createCourseAuthoringSession,
  type CourseAuthoringTarget,
  type CurrentCourseAuthoringTargetIdentity,
} from '@/renderer/authoring/courseAuthoringSession'
import {
  applyEditorTransactionStep,
  createEditorTransactionStep,
} from '@/renderer/authoring/editorTransaction'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { buildSlideEditorView } from '@/renderer/course/slideEditorView'
import {
  freezeCourseAssetSidecar,
  planCourseImageReplacement,
  type CourseImageReplacementPlanResult,
  type PlanCourseImageReplacementInput,
} from '@/renderer/course/v9MediaAudioCommands'
import { openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/projectTypes'

const FIXTURE_PATH = join(
  process.cwd(),
  'tests',
  'fixtures',
  'architecture-baseline',
  'slide-heavy.h5lesson',
)
const NOW = '2026-08-24T03:00:00.000Z'
const REPLACEMENT_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
])

function fixture() {
  return openCourseProjectArchive(new Uint8Array(readFileSync(FIXTURE_PATH)))
}

function replacementMeta(
  id = 'slide-hero-replacement',
  bytes = REPLACEMENT_BYTES,
): AssetMeta {
  return {
    id,
    filename: `${id}.png`,
    mimeType: 'image/png',
    kind: 'image',
    path: `assets/${id}.png`,
    byteLength: bytes.byteLength,
    width: 640,
    height: 360,
  }
}

function targetContext(input: {
  readonly project: CourseProjectDocument
  readonly locationId?: string
  readonly stateId?: string | null
  readonly itemId?: string
}): {
  readonly target: CourseAuthoringTarget
  readonly currentIdentity: CurrentCourseAuthoringTargetIdentity
} {
  const locationId = input.locationId ?? 'slide-location-intro'
  const itemId = input.itemId ?? 'slide-intro-hero'
  const projection = projectEffectiveLayers({
    project: input.project,
    locationId,
    ...(input.stateId === undefined ? {} : { stateId: input.stateId }),
    selectedIds: [itemId],
  })
  const row = projection.unifiedRows.find((candidate) => candidate.id === itemId)
  if (!row) throw new Error(`Fixture row is missing: ${itemId}`)
  const session = createCourseAuthoringSession({
    locationId: projection.locationId,
    surfaceType: projection.surfaceType,
    revision: projection.revision,
    itemIds: [row.id],
  })
  const target = captureCourseAuthoringTarget({
    sessionToken: session.token,
    projectId: projection.projectId,
    surfaceId: projection.surfaceId,
    stateId: projection.stateId,
    owner: row.owner,
    ownerKey: row.ownerKey,
    itemId: row.id,
    authoringAddress: row.authoringAddress,
  })
  return {
    target,
    currentIdentity: {
      projectId: projection.projectId,
      documentRevision: projection.revision,
      sessionToken: session.token,
      surfaceId: projection.surfaceId,
      stateId: projection.stateId,
      owner: row.owner,
      ownerKey: row.ownerKey,
    },
  }
}

function planned(result: CourseImageReplacementPlanResult) {
  if (!result.ok) throw new Error(`${result.code}: ${result.reason}`)
  if (result.status !== 'planned') throw new Error('Expected a transaction plan')
  return result.plan
}

function imageAssetId(
  project: CourseProjectDocument,
  locationId: string,
  stateId: string | null,
  itemId: string,
): string {
  const view = buildSlideEditorView({ project, locationId, stateId })
  const layer = view.layers.find((candidate) => (
    candidate.source === 'scene' && candidate.selectionId === itemId
  ))
  if (
    !layer ||
    layer.item.kind !== 'native' ||
    layer.item.content.nativeType !== 'image'
  ) {
    throw new Error(`Slide image is missing: ${itemId}`)
  }
  return layer.item.content.data.assetId
}

function introScene(project: CourseProjectDocument) {
  const surface = project.surfaces.find((candidate) => candidate.id === 'slide-surface')
  if (!surface || surface.type !== 'slide') throw new Error('Slide surface is missing')
  const scene = surface.scenes.find((candidate) => candidate.id === 'slide-scene-intro')
  if (!scene) throw new Error('Intro scene is missing')
  return scene
}

function inputFor(
  project: CourseProjectDocument,
  sidecar: ReturnType<typeof freezeCourseAssetSidecar>,
  context: ReturnType<typeof targetContext>,
  asset: AssetMeta,
  bytes: Uint8Array,
): PlanCourseImageReplacementInput {
  return {
    project,
    sidecar,
    currentIdentity: context.currentIdentity,
    target: context.target,
    asset,
    bytes,
    now: NOW,
  }
}

describe('Slide image replacement transaction planner', () => {
  it('updates captured A only and applies/inverts document plus cloned added bytes', () => {
    const archive = fixture()
    const project = archive.project
    const sidecar = freezeCourseAssetSidecar(archive.assetFiles)
    const context = targetContext({ project, stateId: null })
    const beforeProject = structuredClone(project)
    const beforeSummaryAsset = imageAssetId(
      project,
      'slide-location-summary',
      null,
      'slide-summary-hero',
    )
    const callerBytes = REPLACEMENT_BYTES.slice()
    const asset = replacementMeta('slide-hero-replacement', callerBytes)

    const plan = planned(planCourseImageReplacement(inputFor(
      project,
      sidecar,
      context,
      asset,
      callerBytes,
    )))

    expect(project).toEqual(beforeProject)
    expect(sidecar.files[asset.id]).toBeUndefined()
    expect(plan.baseRevision).toBe(project.revision)
    expect(plan.nextDocument.revision).toBe(project.revision + 1)
    expect(plan.nextDocument.updatedAt).toBe(NOW)
    expect(imageAssetId(
      plan.nextDocument,
      context.target.locationId,
      null,
      context.target.itemId,
    )).toBe(asset.id)
    expect(imageAssetId(
      plan.nextDocument,
      'slide-location-summary',
      null,
      'slide-summary-hero',
    )).toBe(beforeSummaryAsset)
    expect(plan.nextDocument.assets[asset.id]).toEqual(asset)
    expect(plan.resourceChanges.assetFileChanges).toHaveLength(1)
    expect(plan.resourceChanges.assetFileChanges![0]).toMatchObject({
      assetId: asset.id,
    })
    expect(plan.resourceChanges.assetFileChanges![0]).not.toHaveProperty('before')
    expect([...plan.resourceChanges.assetFileChanges![0]!.after!])
      .toEqual([...REPLACEMENT_BYTES])
    expect(plan.resourceChanges.assetFileChanges![0]!.after).not.toBe(callerBytes)
    expect(plan.selectionHint).toEqual({
      itemId: context.target.itemId,
      authoringAddress: context.target.authoringAddress,
      locationId: context.target.locationId,
      stateId: null,
    })
    expect(plan.feedback).toEqual({
      kind: 'image-replaced',
      assetId: asset.id,
      assetDisposition: 'added',
    })
    expect(Object.isFrozen(plan)).toBe(true)

    callerBytes[0] = 0
    expect([...plan.resourceChanges.assetFileChanges![0]!.after!])
      .toEqual([...REPLACEMENT_BYTES])

    const step = createEditorTransactionStep(project, plan)
    if (!step) throw new Error('Expected a replacement transaction step')
    const forward = applyEditorTransactionStep({
      document: project,
      resources: { componentPackages: {}, assetFiles: sidecar.files },
    }, step, 'forward')
    expect(imageAssetId(
      forward.document,
      context.target.locationId,
      null,
      context.target.itemId,
    )).toBe(asset.id)
    expect([...forward.resources.assetFiles[asset.id]!]).toEqual([...REPLACEMENT_BYTES])

    const inverse = applyEditorTransactionStep(forward, step, 'inverse')
    expect(inverse.document).toEqual(project)
    expect(inverse.resources.assetFiles).toEqual(sidecar.files)
  })

  it('writes named-state nativeData only and makes reuse/no-op rules explicit', () => {
    const archive = fixture()
    const project = archive.project
    const sidecar = freezeCourseAssetSidecar(archive.assetFiles)
    const named = targetContext({
      project,
      locationId: 'slide-location-evidence',
      stateId: 'slide-state-evidence',
    })
    const namedAsset = replacementMeta('slide-state-replacement')
    const namedPlan = planned(planCourseImageReplacement(inputFor(
      project,
      sidecar,
      named,
      namedAsset,
      REPLACEMENT_BYTES,
    )))

    const baseItem = introScene(namedPlan.nextDocument).layerItems.find((candidate) => (
      candidate.layerItemId === named.target.itemId
    ))
    if (
      !baseItem ||
      baseItem.kind !== 'native' ||
      baseItem.content.nativeType !== 'image'
    ) {
      throw new Error('Expected base image')
    }
    expect(baseItem.content.data.assetId).toBe('slide-hero')
    const evidence = introScene(namedPlan.nextDocument).presentation?.states.find(
      (candidate) => candidate.id === 'slide-state-evidence',
    )
    expect(evidence?.layerItemOverrides[named.target.itemId]?.nativeData)
      .toMatchObject({ assetId: namedAsset.id })
    expect(imageAssetId(
      namedPlan.nextDocument,
      named.target.locationId,
      named.target.stateId,
      named.target.itemId,
    )).toBe(namedAsset.id)
    expect(imageAssetId(
      namedPlan.nextDocument,
      named.target.locationId,
      null,
      named.target.itemId,
    )).toBe('slide-hero')

    const base = targetContext({ project, stateId: null })
    const currentMeta = project.assets['slide-hero']
    const currentBytes = sidecar.files['slide-hero']
    if (!currentMeta || !currentBytes) throw new Error('Current hero asset is missing')
    const noOp = planCourseImageReplacement(inputFor(
      project,
      sidecar,
      base,
      structuredClone(currentMeta),
      currentBytes.slice(),
    ))
    expect(noOp).toMatchObject({
      ok: true,
      status: 'no-op',
      plan: null,
      feedback: {
        kind: 'image-unchanged',
        assetId: currentMeta.id,
        assetDisposition: 'unchanged',
      },
    })

    const reusableMeta = Object.values(project.assets).find((candidate) => (
      candidate.kind === 'image' && candidate.id !== currentMeta.id
    ))
    if (!reusableMeta) throw new Error('Reusable fixture image is missing')
    const reusableBytes = sidecar.files[reusableMeta.id]
    if (!reusableBytes) throw new Error('Reusable fixture bytes are missing')
    const reusedPlan = planned(planCourseImageReplacement(inputFor(
      project,
      sidecar,
      base,
      structuredClone(reusableMeta),
      reusableBytes.slice(),
    )))
    expect(reusedPlan.resourceChanges).toEqual({})
    expect(reusedPlan.feedback?.assetDisposition).toBe('reused')
    expect(imageAssetId(
      reusedPlan.nextDocument,
      base.target.locationId,
      null,
      base.target.itemId,
    )).toBe(reusableMeta.id)
  })

  it('returns structured failures for deleted, owner, surface, carrier, lock and revision drift', () => {
    const archive = fixture()
    const project = archive.project
    const sidecar = freezeCourseAssetSidecar(archive.assetFiles)
    const base = targetContext({ project, stateId: null })
    const asset = replacementMeta()

    const deleted = structuredClone(project)
    const deletedScene = introScene(deleted)
    deletedScene.layerItems = deletedScene.layerItems.filter((candidate) => (
      candidate.layerItemId !== base.target.itemId
    ))
    const locked = structuredClone(project)
    const lockedItem = introScene(locked).layerItems.find((candidate) => (
      candidate.layerItemId === base.target.itemId
    ))
    if (!lockedItem) throw new Error('Lock target is missing')
    lockedItem.locked = true

    const wrongOwnerTarget: CourseAuthoringTarget = {
      ...base.target,
      owner: 'global',
      ownerKey: 'global',
    }
    const wrongOwnerCurrent: CurrentCourseAuthoringTargetIdentity = {
      ...base.currentIdentity,
      owner: 'global',
      ownerKey: 'global',
    }
    const wrongSurfaceTarget: CourseAuthoringTarget = {
      ...base.target,
      surfaceType: 'flow',
    }
    const wrongSurfaceCurrent: CurrentCourseAuthoringTargetIdentity = {
      ...base.currentIdentity,
      sessionToken: {
        ...base.currentIdentity.sessionToken,
        surfaceType: 'flow',
      },
    }
    const text = targetContext({
      project,
      stateId: null,
      itemId: 'slide-intro-title',
    })

    const cases = [
      {
        label: 'deleted item',
        input: inputFor(deleted, sidecar, base, asset, REPLACEMENT_BYTES),
        code: 'item-missing',
      },
      {
        label: 'wrong owner',
        input: {
          ...inputFor(project, sidecar, base, asset, REPLACEMENT_BYTES),
          target: wrongOwnerTarget,
          currentIdentity: wrongOwnerCurrent,
        },
        code: 'wrong-owner',
      },
      {
        label: 'wrong surface',
        input: {
          ...inputFor(project, sidecar, base, asset, REPLACEMENT_BYTES),
          target: wrongSurfaceTarget,
          currentIdentity: wrongSurfaceCurrent,
        },
        code: 'wrong-surface',
      },
      {
        label: 'non-image carrier',
        input: inputFor(project, sidecar, text, asset, REPLACEMENT_BYTES),
        code: 'invalid-target',
      },
      {
        label: 'locked target',
        input: inputFor(locked, sidecar, base, asset, REPLACEMENT_BYTES),
        code: 'target-locked',
      },
      {
        label: 'exact revision conflict',
        input: {
          ...inputFor(project, sidecar, base, asset, REPLACEMENT_BYTES),
          currentIdentity: {
            ...base.currentIdentity,
            documentRevision: base.currentIdentity.documentRevision + 1,
          },
        },
        code: 'revision-conflict',
      },
    ] as const

    for (const failureCase of cases) {
      const beforeProject = structuredClone(failureCase.input.project)
      const result = planCourseImageReplacement(failureCase.input)
      expect(result, failureCase.label).toMatchObject({
        ok: false,
        code: failureCase.code,
      })
      expect(failureCase.input.project, failureCase.label).toEqual(beforeProject)
      expect(sidecar.files[asset.id], failureCase.label).toBeUndefined()
    }
  })

  it('rejects invalid or same-ID conflicting metadata/bytes without overwriting inputs', () => {
    const archive = fixture()
    const project = archive.project
    const sidecar = freezeCourseAssetSidecar(archive.assetFiles)
    const base = targetContext({ project, stateId: null })
    const currentMeta = project.assets['slide-hero']
    const currentBytes = sidecar.files['slide-hero']
    if (!currentMeta || !currentBytes) throw new Error('Current hero asset is missing')
    const beforeProject = structuredClone(project)
    const beforeBytes = currentBytes.slice()

    const differentMetadata = planCourseImageReplacement(inputFor(
      project,
      sidecar,
      base,
      { ...structuredClone(currentMeta), filename: 'different.png' },
      currentBytes.slice(),
    ))
    expect(differentMetadata).toMatchObject({ ok: false, code: 'asset-conflict' })

    const conflictingBytes = currentBytes.slice()
    conflictingBytes[0] = conflictingBytes[0] === 0 ? 1 : 0
    const differentContent = planCourseImageReplacement(inputFor(
      project,
      sidecar,
      base,
      structuredClone(currentMeta),
      conflictingBytes,
    ))
    expect(differentContent).toMatchObject({ ok: false, code: 'asset-conflict' })

    const invalidKind = planCourseImageReplacement(inputFor(
      project,
      sidecar,
      base,
      { ...replacementMeta('video-id'), kind: 'video', mimeType: 'video/mp4' },
      REPLACEMENT_BYTES,
    ))
    expect(invalidKind).toMatchObject({ ok: false, code: 'invalid-asset' })
    const invalidLength = planCourseImageReplacement(inputFor(
      project,
      sidecar,
      base,
      { ...replacementMeta('bad-length'), byteLength: REPLACEMENT_BYTES.byteLength + 1 },
      REPLACEMENT_BYTES,
    ))
    expect(invalidLength).toMatchObject({ ok: false, code: 'invalid-asset' })

    expect(project).toEqual(beforeProject)
    expect([...sidecar.files['slide-hero']!]).toEqual([...beforeBytes])
    expect(sidecar.files['slide-hero']).not.toBe(conflictingBytes)
    expect(project.assets['slide-hero']).toEqual(currentMeta)
  })
})
