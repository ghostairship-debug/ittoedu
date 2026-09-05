import { describe, expect, it } from 'vitest'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { updateCourseBackground } from '@/renderer/course/courseBackgroundCommands'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'

const NOW = '2026-09-05T00:00:00.000Z'

/** The strict schema requires every referenced asset id to exist; register one first. */
function withRegisteredAsset(project: CourseProjectDocument, id: string): CourseProjectDocument {
  const meta: AssetMeta = {
    id,
    filename: `${id}.png`,
    mimeType: 'image/png',
    kind: 'image',
    path: `assets/${id}.png`,
    byteLength: 4,
  }
  return { ...project, assets: { ...project.assets, [id]: meta } }
}

describe('courseBackgroundCommands: updateCourseBackground', () => {
  it('defaults to no color/asset on a fresh project (legacy V9 parity)', () => {
    const project = createBlankCourseProject({ now: NOW })
    expect(project.backgroundColor).toBeUndefined()
    expect(project.backgroundAssetId).toBeUndefined()
  })

  it('writes backgroundColor in one commit and bumps the revision', () => {
    const project = createBlankCourseProject({ now: NOW })
    const result = updateCourseBackground(project, { backgroundColor: '#112233' }, {
      expectedRevision: project.revision,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.historyEntry).toBe(true)
    expect(result.project.backgroundColor).toBe('#112233')
    expect(result.project.revision).toBe(project.revision + 1)
  })

  it('sets backgroundAssetId to a string, then clears it with an explicit null', () => {
    const project = withRegisteredAsset(createBlankCourseProject({ now: NOW }), 'asset_course_bg')
    const withAsset = updateCourseBackground(project, { backgroundAssetId: 'asset_course_bg' })
    expect(withAsset.ok).toBe(true)
    if (!withAsset.ok) throw new Error(withAsset.reason)
    expect(withAsset.project.backgroundAssetId).toBe('asset_course_bg')

    const cleared = updateCourseBackground(withAsset.project, { backgroundAssetId: null }, {
      expectedRevision: withAsset.project.revision,
    })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) throw new Error(cleared.reason)
    expect(cleared.project.backgroundAssetId).toBeNull()
  })

  it('leaves backgroundAssetId untouched when the patch omits it', () => {
    const project = withRegisteredAsset(createBlankCourseProject({ now: NOW }), 'asset_course_bg')
    const withAsset = updateCourseBackground(project, { backgroundAssetId: 'asset_course_bg' })
    expect(withAsset.ok).toBe(true)
    if (!withAsset.ok) throw new Error(withAsset.reason)

    const colorOnly = updateCourseBackground(withAsset.project, { backgroundColor: '#445566' })
    expect(colorOnly.ok).toBe(true)
    if (!colorOnly.ok) throw new Error(colorOnly.reason)
    expect(colorOnly.project.backgroundAssetId).toBe('asset_course_bg')
    expect(colorOnly.project.backgroundColor).toBe('#445566')
  })

  it('rejects an invalid color and writes nothing', () => {
    const project = createBlankCourseProject({ now: NOW })
    const result = updateCourseBackground(project, { backgroundColor: 'not-a-color' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.project).toBe(project)
  })

  it('rejects a stale expectedRevision and writes nothing', () => {
    const project = createBlankCourseProject({ now: NOW })
    const result = updateCourseBackground(project, { backgroundColor: '#112233' }, {
      expectedRevision: project.revision + 1,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.project).toBe(project)
  })

  it('short-circuits a patch that changes nothing (zero history entries)', () => {
    const project = createBlankCourseProject({ now: NOW })
    const seeded = updateCourseBackground(project, { backgroundColor: '#112233' })
    expect(seeded.ok).toBe(true)
    if (!seeded.ok) throw new Error(seeded.reason)

    const noop = updateCourseBackground(seeded.project, { backgroundColor: '#112233' })
    expect(noop.ok).toBe(true)
    if (!noop.ok) throw new Error(noop.reason)
    expect(noop.historyEntry).toBe(false)
    expect(noop.project).toBe(seeded.project)
  })
})
