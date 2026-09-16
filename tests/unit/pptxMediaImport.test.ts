import { beforeEach, expect, it, vi } from 'vitest'
import { parsePptxImport } from '@/renderer/project/pptxImport'
import { readMediaMetadata } from '@/renderer/project/assetManager'
import { pptxMediaFixture } from '../fixtures/pptxMedia'
import { pptxImportFixture } from '../fixtures/pptxImport'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { planPptxImportTransaction } from '@/renderer/project/pptxImportTransaction'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'

vi.mock('@/renderer/project/assetManager', async importOriginal => ({
  ...await importOriginal<typeof import('@/renderer/project/assetManager')>(),
  readMediaMetadata: vi.fn(),
}))
beforeEach(() => { vi.mocked(readMediaMetadata).mockReset().mockResolvedValue({ duration: 2, width: 640, height: 360 }) })

it('retains embedded video bytes and editable Native references, deduplicating repeated media', async () => {
  const draft = await parsePptxImport(pptxMediaFixture({ duplicate: true }))
  const videos = draft.slides[0].items.filter(item => item.kind === 'native' && item.content.nativeType === 'video')
  expect(videos).toHaveLength(2)
  expect(draft.assets).toHaveLength(1)
  expect(draft.assets[0].meta).toMatchObject({ kind: 'video', mimeType: 'video/mp4', duration: 2, width: 640, height: 360 })
  expect(draft.assets[0].bytes).toEqual(new Uint8Array([1, 2, 3]))
  for (const item of videos) {
    if (item.kind !== 'native' || item.content.nativeType !== 'video') throw new Error('missing video')
    expect(item.content.data.assetId).toBe(draft.assets[0].meta.id)
    expect(item.content.data.autoplay).toBe(false)
    expect(item.content.data.showControls).toBe(true)
  }
  expect(readMediaMetadata).toHaveBeenCalledTimes(1)
})

it.each([{ external: true }, { missing: true }, { extension: 'avi' }])('reports unsupported media with page and object while retaining other editable content: %j', async options => {
  const draft = await parsePptxImport(pptxMediaFixture(options))
  expect(draft.assets).toHaveLength(0)
  expect(draft.slides[0].items.length).toBeGreaterThan(0)
  expect(draft.slides[0].items.some(item => item.kind === 'native' && item.content.nativeType === 'video')).toBe(false)
  expect(draft.issues.some(issue => issue.page === 1 && issue.message.includes('内嵌视频 50'))).toBe(true)
  expect(readMediaMetadata).not.toHaveBeenCalled()
})

it('omits undecodable embedded video and its asset atomically', async () => {
  vi.mocked(readMediaMetadata).mockRejectedValue(new Error('decode failed'))
  const draft = await parsePptxImport(pptxMediaFixture())
  expect(draft.assets).toHaveLength(0)
  expect(draft.issues.some(issue => issue.page === 1 && issue.type === '媒体编码')).toBe(true)
})

it('connects embedded audio to an editable click target and the canonical sound registry in one transaction', async () => {
  const draft = await parsePptxImport(pptxMediaFixture({ kind: 'audio' }))
  expect(draft.assets[0].meta.kind).toBe('audio')
  const sound = Object.values(draft.sounds!)[0]
  expect(sound.assetId).toBe(draft.assets[0].meta.id)
  const rule = draft.slides[0].interactions![0]
  expect(rule.actions[0].action).toMatchObject({ type: 'audio.play', soundId: sound.id, lifetime: 'scene' })
  const original = createBlankCourseProject()
  const step = planPptxImportTransaction(original, draft, '媒体')
  const project = courseProjectDocumentSchema.parse(step.nextDocument)
  expect(project.media.audio.sounds[sound.id]).toEqual(sound)
  expect(Object.keys(original.media.audio.sounds)).not.toContain(sound.id)
  const imported = project.surfaces.find(surface => surface.type === 'slide' && surface.scenes.some(scene => scene.interactions.some(item => item.id === rule.id)))
  expect(imported).toBeDefined()
})

function visibilityFixture(value: 'visible' | 'hidden', complex = false) {
  const files = unzipSync(pptxImportFixture())
  const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite"><p:childTnLst><p:set><p:cBhvr><p:cTn id="2" dur="1" fill="hold"><p:stCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cond></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="3"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${value}"/></p:to></p:set>${complex ? '<p:animMotion/>' : ''}</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`
  files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace('</p:sld>', `${timing}</p:sld>`))
  return zipSync(files)
}

it.each(['visible', 'hidden'] as const)('maps independent object-click %s to existing Native motion semantics', async value => {
  const draft = await parsePptxImport(visibilityFixture(value))
  const slide = draft.slides[0]
  const target = slide.items.find(item => item.label === '基础图形')!
  const trigger = slide.items.find(item => item.label.includes('课题'))!
  expect(slide.interactions).toHaveLength(1)
  expect(slide.interactions![0].trigger).toEqual({ type: 'node.click', nodeId: trigger.layerItemId })
  expect(slide.interactions![0].actions[0].action).toMatchObject({ type: value === 'visible' ? 'node.enter' : 'node.exit', nodeId: target.layerItemId, durationMs: 0, effect: 'none' })
  expect(target.playbackInitialVisibility).toBe(value === 'visible' ? 'hidden' : 'inherit')
  expect(draft.issues.some(issue => issue.type === '动画')).toBe(false)
  courseProjectDocumentSchema.parse(planPptxImportTransaction(createBlankCourseProject(), draft, '显隐').nextDocument)
})

it('retains static visibility for the whole timing tree when any effect is unsupported', async () => {
  const draft = await parsePptxImport(visibilityFixture('visible', true))
  expect(draft.slides[0].interactions).toEqual([])
  expect(draft.slides[0].items.every(item => item.playbackInitialVisibility === 'inherit')).toBe(true)
  expect(draft.issues.some(issue => issue.page === 1 && issue.type === '动画')).toBe(true)
})
