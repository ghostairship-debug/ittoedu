// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { captureGenerationSnapshot } from '@/renderer/authoring/generation/generationSnapshot'
import { createGenerationImageSourceInspector } from '@/renderer/authoring/generation/generationImageDiagnostics'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createImageNode } from '@/renderer/project/nativeNodeFactories'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { encodeImageTransformPng } from '@/renderer/project/imageTransform'
import { buildGenerationPrompt } from '@/main/localAgent/profile'
import type { GenerationRequest } from '@/shared/generationContract'

function fixture(bytes = encodeImageTransformPng({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) }), mimeType = 'image/png') {
  const document = createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), surface = document.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Slide required')
  surface.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createImageNode({ id: 'image', assetId: 'red' }), 0))
  document.assets.red = { id: 'red', kind: 'image', filename: 'red.png', mimeType, path: 'assets/red.png', byteLength: bytes.byteLength, width: 1, height: 1 }
  const observation: NonNullable<GenerationRequest['observation']> = { documentRevision: document.revision, sessionGeneration: 1,
    draftEpoch: 0, viewEpoch: 1, runtime: null, surfaceId: surface.id, locationId: document.startLocationId,
    stateId: null, source: 'authoring', capturedAt: 1, files: [] }
  const imageFile = { fileId: 'original-red', relativePath: 'observation/images/red.png', mediaType: mimeType, byteLength: bytes.byteLength, role: 'image' as const }
  function capture(attachment: 'attached' | 'failed' | 'unknown' | 'missing-resource' | 'stale' | 'derived' = 'unknown') {
    const frame = encodeImageTransformPng({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) })
    const resourceFiles: NonNullable<GenerationRequest['resourceFiles']> = [{ path: 'observation/current-frame.png',
      encoding: 'base64', content: Buffer.from(frame).toString('base64'), mediaType: 'image/png', role: 'image' }]
    observation.files = [{ fileId: 'current-frame', relativePath: 'observation/current-frame.png', mediaType: 'image/png', byteLength: frame.byteLength, role: 'image' }]
    if (attachment !== 'unknown') {
      const evidence = { canonicalDocumentRevision: attachment === 'stale' ? document.revision + 1 : document.revision,
        source: 'authoring', locationId: document.startLocationId, surfaceId: surface.id, stateId: null,
        originalImages: attachment === 'failed' ? [] : [{ assetId: 'red', ...imageFile, attachmentRole: attachment === 'derived' ? 'structure' : 'image' }],
        derivedImages: attachment === 'derived' ? [{ assetId: 'red', ...imageFile, derivedFrom: 'original-red-svg' }] : [],
        unavailableOriginalImages: attachment === 'failed' ? [{ assetId: 'red', code: 'image-decode-failed', message: '浏览器未解码，未附原图' }] : [],
        unavailableDerivedImages: [] }
      const content = JSON.stringify(evidence)
      observation.files.push({ fileId: 'current-structure', relativePath: 'observation/current-structure.json', mediaType: 'application/json', byteLength: Buffer.byteLength(content), role: 'structure' })
      resourceFiles.push({ path: 'observation/current-structure.json', content, encoding: 'utf8', mediaType: 'application/json', role: 'structure' })
      if (attachment !== 'failed') {
        observation.files.push(imageFile)
        if (attachment !== 'missing-resource') resourceFiles.push({ path: imageFile.relativePath, content: Buffer.from(bytes).toString('base64'), encoding: 'base64', mediaType: mimeType, role: 'image' })
      }
    }
    const request = captureGenerationSnapshot({ document, workspace: { version: 1, projectId: document.id, normalizedPath: '/images.h5lesson' },
      sessionToken: { locationId: document.startLocationId, surfaceType: 'slide', revision: document.revision, generation: 1 },
      projection: projectEffectiveLayers({ project: document, locationId: document.startLocationId }), selectedIds: ['image'], scope: 'selection',
      instruction: '把红色改成绿色', purpose: 'local-edit', observation, observationResourceFiles: resourceFiles })
    request.resourceFiles!.push(...resourceFiles)
    return request
  }
  return { document, bytes, capture }
}
const image = (request: GenerationRequest) => (request.context as any).imageDiagnostics[0]

describe('first-candidate image diagnostics', () => {
  it('keeps a real attachment failure separate from a successful transform-source decode on the initial wire', async () => {
    const f = fixture(), request = f.capture('failed'), before = structuredClone(request)
    const inspected = await createGenerationImageSourceInspector()(request, f.document.assets, { red: f.bytes })
    expect(request).toEqual(before)
    expect(image(inspected)).toMatchObject({ assetId: 'red', selected: true,
      attachment: { status: 'unavailable', code: 'image-decode-failed' }, transformSource: { status: 'ready', width: 1, height: 1 } })
    for (const adapter of ['codex', 'claude', 'opencode'] as const) {
      const prompt = buildGenerationPrompt(adapter, inspected, 'C:/candidate')
      const wire = JSON.parse(prompt.split('\n').at(-1)!)
      expect(wire.context.imageDiagnostics).toEqual((inspected.context as any).imageDiagnostics)
      expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(12 * 1024)
      expect(wire.context).not.toHaveProperty('assets')
    }
  })

  it('reports a damaged IDAT source despite an existing visual attachment and preserves exact targets', async () => {
    const f = fixture(), damaged = f.bytes.slice(), idat = Buffer.from(damaged).indexOf('IDAT')
    expect(idat).toBeGreaterThan(0)
    damaged[idat + 4] = damaged[idat + 4]! ^ 1
    const bad = fixture(damaged), request = bad.capture('attached')
    const inspected = await createGenerationImageSourceInspector()(request, bad.document.assets, { red: damaged })
    expect(image(inspected).attachment).toEqual({ status: 'attached', kind: 'original', path: 'resources/observation/images/red.png' })
    expect(image(inspected).transformSource).toMatchObject({ status: 'failed', code: 'image-source-decode-failed' })
    expect(image(inspected).transformSource.message).toContain('IDAT')
    expect(inspected.destinations).toEqual(request.destinations)
  })

  it('distinguishes unsupported source formats, absent bytes and unknown evidence without claiming decode from filenames', async () => {
    const unsupported = fixture(new Uint8Array([71, 73, 70, 56, 57, 97]), 'image/gif')
    const inspected = await createGenerationImageSourceInspector()(unsupported.capture(), unsupported.document.assets, { red: unsupported.bytes })
    expect(image(inspected)).toMatchObject({ attachment: { status: 'unknown' }, transformSource: { status: 'unsupported', code: 'image-source-unsupported' } })
    const f = fixture(), missing = await createGenerationImageSourceInspector()(f.capture(), f.document.assets, {})
    expect(image(missing).transformSource).toMatchObject({ status: 'failed', code: 'image-bytes-missing' })
    expect(image(f.capture('unknown')).transformSource).toEqual({ status: 'unknown', code: 'image-source-not-inspected' })
    for (const mode of ['missing-resource', 'stale'] as const) expect(image(f.capture(mode)).attachment.status).toBe('unknown')
    expect(image(f.capture('derived')).attachment).toMatchObject({ status: 'attached', kind: 'derived' })
  })

  it('reuses source evidence only for the same immutable bytes and MIME and leaves unfocused source inspection unknown', async () => {
    const inspect = vi.fn(async () => ({ status: 'ready' as const, width: 1, height: 1 })), run = createGenerationImageSourceInspector(inspect)
    const f = fixture(), request = f.capture()
    ;(request.context as any).imageDiagnostics.push({ ...image(request), target: 'unselected-sibling', assetId: 'other', selected: false })
    const first = await run(request, f.document.assets, { red: f.bytes })
    expect((first.context as any).imageDiagnostics[1].transformSource.status).toBe('unknown')
    await run(request, f.document.assets, { red: f.bytes }); expect(inspect).toHaveBeenCalledTimes(1)
    await run(request, f.document.assets, { red: f.bytes.slice() }); expect(inspect).toHaveBeenCalledTimes(2)
    f.document.assets.red!.mimeType = 'image/webp'
    await run(request, f.document.assets, { red: f.bytes }); expect(inspect).toHaveBeenCalledTimes(3)
  })
})
