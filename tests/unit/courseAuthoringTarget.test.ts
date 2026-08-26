import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  COURSE_AUTHORING_TARGET_REJECTION_CODES,
  captureCourseAuthoringTarget,
  createCourseAuthoringSession,
  guardCourseAuthoringTargetCallback,
  validateCourseAuthoringTarget,
  type CourseAuthoringTarget,
  type CourseAuthoringTargetItemLookup,
  type CourseAuthoringTargetRejectionCode,
  type CurrentCourseAuthoringTargetIdentity,
} from '@/renderer/authoring/courseAuthoringSession'
import {
  projectEffectiveLayers,
  type EffectiveLayerProjection,
} from '@/renderer/course/effectiveLayerProjection'
import { openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'

const SLIDE_FIXTURE_PATH = join(
  process.cwd(),
  'tests',
  'fixtures',
  'architecture-baseline',
  'slide-heavy.h5lesson',
)

interface SlideTargetContext {
  readonly project: CourseProjectDocument
  readonly projection: EffectiveLayerProjection
  readonly target: CourseAuthoringTarget
  readonly current: CurrentCourseAuthoringTargetIdentity
}

function slideTargetContext(): SlideTargetContext {
  const archive = openCourseProjectArchive(new Uint8Array(readFileSync(SLIDE_FIXTURE_PATH)))
  const project = archive.project
  const projection = projectEffectiveLayers({
    project,
    locationId: 'slide-location-intro',
    selectedIds: ['slide-intro-hero'],
  })
  const row = projection.unifiedRows.find((candidate) => (
    candidate.id === 'slide-intro-hero'
  ))
  if (!row) throw new Error('Slide-heavy fixture is missing slide-intro-hero')

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
    project,
    projection,
    target,
    current: {
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

function hasCapturedImage(
  projection: EffectiveLayerProjection,
): CourseAuthoringTargetItemLookup {
  return (target) => {
    const row = projection.unifiedRows.find((candidate) => (
      candidate.id === target.itemId &&
      candidate.authoringAddress === target.authoringAddress &&
      candidate.owner === target.owner &&
      candidate.ownerKey === target.ownerKey
    ))
    return row?.item.kind === 'native' && row.item.content.nativeType === 'image'
  }
}

describe('CourseAuthoringTarget', () => {
  it('captures only frozen scalar identity from the real Slide fixture and effective row', () => {
    const { project, projection, target } = slideTargetContext()
    const row = projection.unifiedRows.find((candidate) => (
      candidate.id === 'slide-intro-hero'
    ))!

    expect(target).toEqual({
      projectId: project.id,
      documentRevision: project.revision,
      revisionPolicy: { kind: 'exact' },
      sessionGeneration: 0,
      surfaceType: 'slide',
      surfaceId: 'slide-surface',
      locationId: 'slide-location-intro',
      stateId: 'slide-state-base',
      owner: 'scene',
      ownerKey: 'scene:slide-scene-intro',
      itemId: 'slide-intro-hero',
      authoringAddress: row.authoringAddress,
    })
    expect(Object.isFrozen(target)).toBe(true)
    expect(Object.isFrozen(target.revisionPolicy)).toBe(true)
    expect(Reflect.set(
      target as unknown as Record<string, unknown>,
      'itemId',
      'selection-b',
    )).toBe(false)
    expect(Reflect.set(
      target.revisionPolicy as unknown as Record<string, unknown>,
      'kind',
      'merge',
    )).toBe(false)
    expect(target.itemId).toBe('slide-intro-hero')
    expect(target.revisionPolicy.kind).toBe('exact')
    expect(target).not.toHaveProperty('selectedIds')
    expect(target).not.toHaveProperty('document')
    expect(target).not.toHaveProperty('item')
  })

  it('keeps captured A when selection changes to B in the same scene', () => {
    const { project, target, current } = slideTargetContext()
    const selectionB = projectEffectiveLayers({
      project,
      locationId: target.locationId,
      selectedIds: ['slide-intro-title'],
    })

    expect(selectionB.unifiedRows.find((row) => row.id === 'slide-intro-title'))
      .toMatchObject({ selected: true, ownerKey: target.ownerKey })
    expect(selectionB.unifiedRows.find((row) => row.id === target.itemId))
      .toMatchObject({ selected: false })

    const callback = vi.fn(() => target.itemId)
    const result = guardCourseAuthoringTargetCallback({
      target,
      current,
      hasItem: hasCapturedImage(selectionB),
    }, callback)

    expect(result).toBe('slide-intro-hero')
    expect(callback).toHaveBeenCalledOnce()
    expect(target.itemId).toBe('slide-intro-hero')
  })

  it('returns stable stale codes and never runs a rejected callback', () => {
    const { projection, target, current } = slideTargetContext()
    const existing = hasCapturedImage(projection)
    type StaleCase = {
      readonly label: string
      readonly current: CurrentCourseAuthoringTargetIdentity
      readonly hasItem: CourseAuthoringTargetItemLookup
      readonly code: CourseAuthoringTargetRejectionCode
    }
    const staleCases: readonly StaleCase[] = [
      {
        label: 'project identity',
        current: { ...current, projectId: 'another-project' },
        hasItem: existing,
        code: 'project-mismatch',
      },
      {
        label: 'session generation',
        current: {
          ...current,
          sessionToken: {
            ...current.sessionToken,
            generation: current.sessionToken.generation + 1,
          },
        },
        hasItem: existing,
        code: 'session-stale',
      },
      {
        label: 'surface type',
        current: {
          ...current,
          sessionToken: { ...current.sessionToken, surfaceType: 'flow' },
        },
        hasItem: existing,
        code: 'surface-or-location',
      },
      {
        label: 'surface id',
        current: { ...current, surfaceId: 'another-surface' },
        hasItem: existing,
        code: 'surface-or-location',
      },
      {
        label: 'location id',
        current: {
          ...current,
          sessionToken: {
            ...current.sessionToken,
            locationId: 'slide-location-summary',
          },
        },
        hasItem: existing,
        code: 'surface-or-location',
      },
      {
        label: 'presentation state',
        current: { ...current, stateId: 'slide-state-evidence' },
        hasItem: existing,
        code: 'surface-or-location',
      },
      {
        label: 'owner',
        current: { ...current, owner: 'global', ownerKey: 'global' },
        hasItem: existing,
        code: 'owner-mismatch',
      },
      {
        label: 'owner key',
        current: { ...current, ownerKey: 'scene:another-scene' },
        hasItem: existing,
        code: 'owner-mismatch',
      },
      {
        label: 'deleted or changed carrier',
        current,
        hasItem: () => false,
        code: 'item-missing',
      },
      {
        label: 'exact document revision',
        current: { ...current, documentRevision: current.documentRevision + 1 },
        hasItem: existing,
        code: 'revision-conflict',
      },
    ]

    expect(COURSE_AUTHORING_TARGET_REJECTION_CODES).toEqual([
      'project-mismatch',
      'session-stale',
      'surface-or-location',
      'owner-mismatch',
      'item-missing',
      'revision-conflict',
    ])

    for (const staleCase of staleCases) {
      const validation = validateCourseAuthoringTarget({
        target,
        current: staleCase.current,
        hasItem: staleCase.hasItem,
      })
      expect(validation, staleCase.label).toMatchObject({
        ok: false,
        code: staleCase.code,
      })
      if (validation.ok) throw new Error(`Expected ${staleCase.label} to reject`)
      expect(validation.reason, staleCase.label).not.toBe('')

      const callback = vi.fn(() => 'must-not-run')
      const guarded = guardCourseAuthoringTargetCallback({
        target,
        current: staleCase.current,
        hasItem: staleCase.hasItem,
      }, callback)
      expect(guarded, staleCase.label).toMatchObject({
        ok: false,
        code: staleCase.code,
      })
      expect(callback, staleCase.label).not.toHaveBeenCalled()
    }
  })
})
