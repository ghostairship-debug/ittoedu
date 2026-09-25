import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { describe, expect, it } from 'vitest'
import { assetMetaSchema, courseProjectAssetMetaSchema } from '../../src/shared/contracts/media-v1/schema'
import { publishedCourseV2Schema } from '../../src/shared/publishedCourseSchema'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'


describe('approved project font asset contract', () => {
  const base = { id: 'font-a', filename: 'lesson.woff2', mimeType: 'font/woff2', path: 'assets/lesson.woff2', byteLength: 4 }
  it.each(['image', 'audio', 'video', 'font'])('preserves the strict %s asset branch', kind => {
    expect(assetMetaSchema.parse({ ...base, kind }).kind).toBe(kind)
    expect(courseProjectAssetMetaSchema.parse({ ...base, kind }).kind).toBe(kind)
    expect(courseProjectAssetMetaSchema.safeParse({ ...base, kind, unexpected: true }).success).toBe(false)
  })
  it('rejects unknown kinds and carries font data through the existing Published MIME/URL profile', () => {
    expect(courseProjectAssetMetaSchema.safeParse({ ...base, kind: 'other' }).success).toBe(false)
    const payload = buildPublishedCourseV2Payload({ project: createBlankCourseProject(), assetFiles: {}, components: {} })
    payload.assets['font-a'] = { mimeType: 'font/woff2', url: 'data:font/woff2;base64,d09GMg==' }
    expect(publishedCourseV2Schema.parse(payload).assets['font-a']).toEqual(payload.assets['font-a'])
    expect(publishedCourseV2Schema.safeParse({ ...payload, assets: { 'font-a': { ...payload.assets['font-a'], kind: 'font' } } }).success).toBe(false)
  })
})
