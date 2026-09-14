import { describe, expect, it } from 'vitest'
import { buildGenerationPrompt, generationInitialRequestForPrompt, generationRequestForPrompt } from '@/main/localAgent/profile'
import { captureGenerationSnapshot } from '@/renderer/authoring/generation/generationSnapshot'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { expandGenerationShortCandidate, generationAssetAliases } from '@/shared/generationContract'
import { courseAgentSkillMarkdown, courseAgentSkills, publicCourseReplyGuidance } from '@/shared/courseAgentSkills'

function fixture(instruction = '请使用课件里已有的星云图片作为本页背景，保留其他内容。', count = 1) {
  const document = createBlankCourseProject({ title: '素材复用', includeDefaultController: false, controls: 'none' })
  for (let i = 0; i < count; i++) {
    const id = `asset-${String(i).padStart(4, '0')}`
    document.assets[id] = { id, kind: 'image', filename: i === 0 ? 'nebula.png' : `illustration-${i}.png`,
      mimeType: 'image/png', path: `assets/${id}.png`, width: 1536, height: 1024, byteLength: 986881 }
  }
  document.assets['current-figure'] = { id: 'current-figure', kind: 'image', filename: 'figure.png',
    mimeType: 'image/png', path: 'assets/figure.png', width: 1, height: 1, byteLength: 70 }
  document.assets['audio-1'] = { id: 'audio-1', kind: 'audio', filename: 'narration.mp3',
    mimeType: 'audio/mpeg', path: 'assets/narration.mp3', byteLength: 100 }
  const surface = document.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Expected Slide fixture')
  surface.scenes[0]!.backgroundAssetId = 'current-figure'
  return captureGenerationSnapshot({ document,
    workspace: { version: 1, projectId: document.id, normalizedPath: 'c:/lessons/reuse.h5lesson' },
    sessionToken: { locationId: document.startLocationId, surfaceType: 'slide', revision: document.revision, generation: 1 },
    projection: projectEffectiveLayers({ project: document, locationId: document.startLocationId }),
    selectedIds: [], scope: 'page', instruction, purpose: 'local-edit', intent: 'edit' })
}

describe('existing image discovery in the initial prompt', () => {
  it('identifies an unreferenced reusable image with frozen metadata and the same alias in initial and repair turns', () => {
    const request = fixture(), before = JSON.stringify(request)
    const full = generationRequestForPrompt(request), initial = generationInitialRequestForPrompt(request)
    expect(initial.context).toHaveProperty('assets.asset-0000', { filename: 'nebula.png', kind: 'image', mimeType: 'image/png', width: 1536, height: 1024 })
    expect(initial.context).toHaveProperty('assets.current-figure.width', 1)
    expect(initial.context).not.toHaveProperty('assets.audio-1')
    const alias = Object.entries(full.assetAliases).find(([, id]) => id === 'asset-0000')![0]
    expect(initial.assetAliases![alias]).toBe('asset-0000')
    expect(initial.requestDetails.assetInventory).toMatchObject({ total: 2, included: 2, partial: false })
    expect(JSON.stringify(request)).toBe(before)
    for (const phase of ['initial', 'host-feedback'] as const) {
      const prompt = buildGenerationPrompt('codex', request, 'c:/candidate', phase)
      const wire = JSON.parse(prompt.split('\n').at(-1)!)
      expect(wire.context.assets['asset-0000'].filename).toBe('nebula.png')
      expect(wire.assetAliases[alias]).toBe('asset-0000')
      expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(12 * 1024)
      expect(prompt).toContain(publicCourseReplyGuidance)
    }
    const destination = Object.keys(full.destinationAliases)[0]!
    const expanded = expandGenerationShortCandidate({ version: 2, requestId: request.requestId, summary: '复用已有图片',
      afterCommit: { version: 1, action: 'finish' }, steps: [{ id: 'background', tool: 'owner.background', destination,
        input: { backgroundAssetId: { $asset: alias } } }] }, request, crypto.randomUUID())
    expect(expanded.steps[0]!.input).toEqual({ backgroundAssetId: 'asset-0000' })
  })

  it('delivers the same user-language guidance to every native prompt and generated skill', () => {
    for (const adapter of ['codex', 'claude', 'opencode'] as const) {
      const prompt = buildGenerationPrompt(adapter, fixture(), 'c:/candidate')
      expect(prompt).toContain(publicCourseReplyGuidance)
      expect(prompt).not.toContain('观察含未保存内容、范围与版本')
    }
    for (const skill of courseAgentSkills) expect(courseAgentSkillMarkdown(skill)).toContain(publicCourseReplyGuidance)
  })

  it.each(['把当前图片的颜色改为绿色', '添加标题', '生成一张新的图片作为背景'])('does not expand unused media for %s', instruction => {
    const request = fixture(instruction), initial = generationInitialRequestForPrompt(request)
    expect(initial.context).not.toHaveProperty('assets')
    expect(initial.requestDetails).not.toHaveProperty('assetInventory')
    expect(Object.values(initial.assetAliases!)).toEqual(['current-figure'])
  })

  it('bounds the compact inventory while explicitly retaining complete on-demand discovery', () => {
    const request = fixture('Reuse an existing image as this page background', 200)
    const initial = generationInitialRequestForPrompt(request), full = generationRequestForPrompt(request)
    const assets = (initial.context as any).assets
    const aliases = Object.fromEntries(Object.entries(initial.assetAliases!).filter(([, id]) => assets[id]))
    expect(Buffer.byteLength(JSON.stringify({ assets, aliases }))).toBeLessThanOrEqual(1_536)
    expect(initial.requestDetails.assetInventory).toMatchObject({ total: 201, partial: true })
    expect(Object.keys(assets).length).toBeGreaterThan(0)
    expect(initial.requestDetails.assetInventory!.instruction).toContain('禁止猜选')
    expect(initial.requestDetails.fields).toEqual(expect.arrayContaining(['context.assets', 'assetAliases']))
    expect(Object.keys((full.context as any).assets)).toHaveLength(202)
    expect(full.assetAliases).toEqual(generationAssetAliases(request))
    expect(JSON.stringify(assets)).not.toContain('byteLength')
    expect(JSON.stringify(assets)).not.toContain('assets/')
    for (const adapter of ['codex', 'claude', 'opencode'] as const) {
      expect(Buffer.byteLength(buildGenerationPrompt(adapter, request, 'c:/candidate'))).toBeLessThanOrEqual(12 * 1024)
    }
  })
})
