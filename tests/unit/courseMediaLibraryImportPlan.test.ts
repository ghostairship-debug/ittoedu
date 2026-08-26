import { describe, expect, it } from 'vitest'
import {
  planCourseMediaLibraryImport,
  type PlanCourseMediaLibraryImportInput,
} from '@/renderer/media/courseMediaLibraryImport'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  freezeCourseAssetSidecar,
  type CourseAssetSidecar,
  type CourseImportedAsset,
} from '@/renderer/project/v9AssetAdapter'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/projectTypes'

const CREATED_AT = '2026-08-24T00:00:00.000Z'
const COMMITTED_AT = '2026-08-24T01:00:00.000Z'

function asset(
  id: string,
  bytes: readonly number[],
  patch: Partial<AssetMeta> = {},
): CourseImportedAsset {
  const binary = Uint8Array.from(bytes)
  return {
    meta: {
      id,
      filename: `${id}.png`,
      mimeType: 'image/png',
      kind: 'image',
      path: `assets/${id}.png`,
      byteLength: binary.byteLength,
      width: 800,
      height: 600,
      ...patch,
    },
    bytes: binary,
  }
}

function project(
  assets: Readonly<Record<string, AssetMeta>> = {},
): CourseProjectDocument {
  const base = createBlankCourseProject({
    id: 'arch-2-media-library',
    title: 'ARCH-2 media library',
    now: CREATED_AT,
    includeDefaultController: false,
    controls: 'none',
  })
  return {
    ...base,
    assets: structuredClone(assets),
  }
}

function input(
  document: CourseProjectDocument,
  sidecar: CourseAssetSidecar,
  items: readonly CourseImportedAsset[],
  patch: Partial<PlanCourseMediaLibraryImportInput> = {},
): PlanCourseMediaLibraryImportInput {
  return {
    project: document,
    sidecar,
    items,
    projectId: document.id,
    baseRevision: document.revision,
    now: COMMITTED_AT,
    ...patch,
  }
}

describe('planCourseMediaLibraryImport', () => {
  it('plans a whole project-library batch as one revision and detached resource delta', () => {
    const document = project()
    const sidecar = freezeCourseAssetSidecar({})
    const image = asset('library-image', [1, 2, 3, 4])
    const audio = asset('library-audio', [5, 6, 7], {
      filename: 'library-audio.mp3',
      mimeType: 'audio/mpeg',
      kind: 'audio',
      path: 'assets/library-audio.mp3',
      width: undefined,
      height: undefined,
      duration: 1.25,
    })
    const surfacesBefore = structuredClone(document.surfaces)

    const result = planCourseMediaLibraryImport(input(
      document,
      sidecar,
      [image, audio],
    ))

    expect(result.ok).toBe(true)
    if (!result.ok || result.status !== 'planned') throw new Error('expected plan')
    expect(result.plan.projectId).toBe(document.id)
    expect(result.plan.baseRevision).toBe(document.revision)
    expect(result.plan.nextDocument.revision).toBe(document.revision + 1)
    expect(result.plan.nextDocument.updatedAt).toBe(COMMITTED_AT)
    expect(result.plan.nextDocument.surfaces).toEqual(surfacesBefore)
    expect(result.plan.nextDocument.assets).toEqual({
      'library-image': image.meta,
      'library-audio': audio.meta,
    })
    expect(result.plan.resourceChanges.assetFileChanges).toEqual([
      { assetId: 'library-image', after: image.bytes },
      { assetId: 'library-audio', after: audio.bytes },
    ])
    expect(result.plan.feedback).toEqual({
      kind: 'media-library-imported',
      importedAssetIds: ['library-image', 'library-audio'],
      addedAssetIds: ['library-image', 'library-audio'],
      repairedAssetIds: [],
      reusedAssetIds: [],
    })
    expect(document.revision).toBe(0)
    expect(document.assets).toEqual({})
    expect(sidecar.files).toEqual({})
  })

  it('returns zero-write no-ops for empty and fully reused batches', () => {
    const existing = asset('existing', [9, 8, 7])
    const document = project({ existing: existing.meta })
    const sidecar = freezeCourseAssetSidecar({ existing: existing.bytes })

    const empty = planCourseMediaLibraryImport(input(document, sidecar, []))
    expect(empty).toEqual({
      ok: true,
      status: 'no-op',
      plan: null,
      feedback: {
        kind: 'media-library-unchanged',
        importedAssetIds: [],
        addedAssetIds: [],
        repairedAssetIds: [],
        reusedAssetIds: [],
      },
    })

    const reused = planCourseMediaLibraryImport(input(
      document,
      sidecar,
      [existing, {
        meta: structuredClone(existing.meta),
        bytes: existing.bytes.slice(),
      }],
    ))
    expect(reused).toEqual({
      ok: true,
      status: 'no-op',
      plan: null,
      feedback: {
        kind: 'media-library-unchanged',
        importedAssetIds: [],
        addedAssetIds: [],
        repairedAssetIds: [],
        reusedAssetIds: ['existing'],
      },
    })
    expect(document.revision).toBe(0)
  })

  it('repairs either missing half only when the present half agrees exactly', () => {
    const missingBytes = asset('missing-bytes', [1, 1, 2, 3])
    const missingMeta = asset('missing-meta', [5, 8, 13])
    const document = project({ 'missing-bytes': missingBytes.meta })
    const sidecar = freezeCourseAssetSidecar({
      'missing-meta': missingMeta.bytes,
    })

    const result = planCourseMediaLibraryImport(input(
      document,
      sidecar,
      [missingBytes, missingMeta],
    ))

    expect(result.ok).toBe(true)
    if (!result.ok || result.status !== 'planned') throw new Error('expected plan')
    expect(result.plan.nextDocument.revision).toBe(1)
    expect(result.plan.nextDocument.assets['missing-bytes']).toEqual(missingBytes.meta)
    expect(result.plan.nextDocument.assets['missing-meta']).toEqual(missingMeta.meta)
    expect(result.plan.resourceChanges.assetFileChanges).toEqual([
      { assetId: 'missing-bytes', after: missingBytes.bytes },
    ])
    expect(result.plan.feedback).toMatchObject({
      importedAssetIds: ['missing-bytes', 'missing-meta'],
      addedAssetIds: [],
      repairedAssetIds: ['missing-bytes', 'missing-meta'],
      reusedAssetIds: [],
    })

    const metadataConflict = planCourseMediaLibraryImport(input(
      document,
      sidecar,
      [asset('missing-bytes', [1, 1, 2, 3], { filename: 'different.png' })],
    ))
    expect(metadataConflict).toMatchObject({ ok: false, code: 'asset-conflict' })

    const bytesConflict = planCourseMediaLibraryImport(input(
      document,
      sidecar,
      [asset('missing-meta', [3, 2, 1])],
    ))
    expect(bytesConflict).toMatchObject({ ok: false, code: 'asset-conflict' })
  })

  it('rejects existing or in-batch ID conflicts atomically', () => {
    const existing = asset('collision', [1, 2, 3])
    const document = project({ collision: existing.meta })
    const sidecar = freezeCourseAssetSidecar({ collision: existing.bytes })
    const addition = asset('safe-addition', [4, 5, 6])

    const metadataConflict = planCourseMediaLibraryImport(input(
      document,
      sidecar,
      [addition, asset('collision', [1, 2, 3], { width: 900 })],
    ))
    expect(metadataConflict).toMatchObject({ ok: false, code: 'asset-conflict' })

    const bytesConflict = planCourseMediaLibraryImport(input(
      document,
      sidecar,
      [addition, asset('collision', [3, 2, 1])],
    ))
    expect(bytesConflict).toMatchObject({ ok: false, code: 'asset-conflict' })

    const batchConflict = planCourseMediaLibraryImport(input(
      project(),
      freezeCourseAssetSidecar({}),
      [asset('duplicate', [1]), asset('duplicate', [2])],
    ))
    expect(batchConflict).toMatchObject({ ok: false, code: 'asset-conflict' })
    expect(document.assets).toEqual({ collision: existing.meta })
    expect(sidecar.files.collision).toEqual(existing.bytes)
  })

  it('rejects stale identity, invalid clock, and invalid metadata without writes', () => {
    const document = project()
    const sidecar = freezeCourseAssetSidecar({})
    const item = asset('new-asset', [1, 2])

    expect(planCourseMediaLibraryImport(input(document, sidecar, [item], {
      projectId: 'another-project',
    }))).toMatchObject({ ok: false, code: 'project-mismatch' })
    expect(planCourseMediaLibraryImport(input(document, sidecar, [item], {
      baseRevision: document.revision + 1,
    }))).toMatchObject({ ok: false, code: 'revision-conflict' })
    expect(planCourseMediaLibraryImport(input(document, sidecar, [item], {
      now: 'not-a-clock',
    }))).toMatchObject({ ok: false, code: 'invalid-clock' })
    expect(planCourseMediaLibraryImport(input(document, sidecar, [{
      meta: { ...item.meta, byteLength: item.meta.byteLength + 1 },
      bytes: item.bytes,
    }]))).toMatchObject({ ok: false, code: 'invalid-asset' })
    expect(document.assets).toEqual({})
    expect(sidecar.files).toEqual({})
  })

  it('detaches returned metadata and resource bytes from mutable caller inputs', () => {
    const document = project()
    const sidecar = freezeCourseAssetSidecar({})
    const item = asset('detached', [21, 34, 55])
    const originalFilename = item.meta.filename
    const result = planCourseMediaLibraryImport(input(document, sidecar, [item]))

    expect(result.ok).toBe(true)
    if (!result.ok || result.status !== 'planned') throw new Error('expected plan')
    expect(result.plan.nextDocument.assets.detached).not.toBe(item.meta)
    expect(result.plan.resourceChanges.assetFileChanges?.[0]?.after)
      .not.toBe(item.bytes)
    item.meta.filename = 'caller-mutated.png'
    item.bytes[0] = 255
    expect(result.plan.nextDocument.assets.detached?.filename).toBe(originalFilename)
    expect([...result.plan.resourceChanges.assetFileChanges![0]!.after!])
      .toEqual([21, 34, 55])
    expect(Object.isFrozen(result.plan)).toBe(true)
    expect(Object.isFrozen(result.plan.nextDocument.assets.detached!)).toBe(true)
  })

  it('detaches Buffer-backed bytes instead of retaining its shared slice view', () => {
    const document = project()
    const sidecar = freezeCourseAssetSidecar({})
    const callerBytes = Buffer.from([89, 144, 233])
    const baseItem = asset('buffer-backed', [...callerBytes])
    const item: CourseImportedAsset = {
      meta: baseItem.meta,
      bytes: callerBytes,
    }

    const result = planCourseMediaLibraryImport(input(document, sidecar, [item]))

    expect(result.ok).toBe(true)
    if (!result.ok || result.status !== 'planned') throw new Error('expected plan')
    const plannedBytes = result.plan.resourceChanges.assetFileChanges![0]!.after!
    expect(plannedBytes).not.toBe(callerBytes)
    expect(plannedBytes.constructor).toBe(Uint8Array)
    callerBytes[0] = 255
    expect([...plannedBytes]).toEqual([89, 144, 233])
  })

  it.each(['toString', '__proto__'])(
    'treats inherited Object.prototype key %s as an absent asset ID',
    (assetId) => {
      const document = project()
      const sidecar = freezeCourseAssetSidecar({})
      const item = asset(assetId, [1, 2, 3])

      const result = planCourseMediaLibraryImport(input(document, sidecar, [item]))

      expect(result.ok).toBe(true)
      if (!result.ok || result.status !== 'planned') throw new Error('expected plan')
      expect(Object.hasOwn(result.plan.nextDocument.assets, assetId)).toBe(true)
      expect(result.plan.nextDocument.assets[assetId]).toEqual(item.meta)
      expect(result.plan.resourceChanges.assetFileChanges).toEqual([
        { assetId, after: item.bytes },
      ])
    },
  )
})
