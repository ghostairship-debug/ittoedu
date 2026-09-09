import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CandidateStaging } from '../../src/main/localAgent/candidateStaging'
import { generationCapabilityDirectory } from '../../src/main/localAgent/capabilityWorkspace'
import { buildGenerationPrompt, createGenerationProfile, generationProfileForPrompt, generationRequestForPrompt } from '../../src/main/localAgent/profile'
import { generationRequestSchema } from '../../src/shared/generationContract'
import { GENERATION_RESULT_OPEN, GENERATION_RESULT_CLOSE, readGenerationResult } from '../../src/shared/generationResult'
import { courseAgentCapabilityCacheKey, queryCourseAgentCapabilities, readCourseAgentCapability } from '../../src/shared/courseAgentCapabilities'
import { generationCapabilityContext, generationCapabilityData } from '../../src/renderer/authoring/generation/generationCapabilities'
import { captureGenerationSnapshot } from '../../src/renderer/authoring/generation/generationSnapshot'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { projectEffectiveLayers } from '../../src/renderer/course/effectiveLayerProjection'
import { attachGenerationBehaviorEvidence } from '../../src/renderer/authoring/generation/generationBehaviorResources'
import { encodeImageTransformPng } from '../../src/renderer/project/imageTransform'
import type { DynamicBehaviorObservation } from '../../src/shared/dynamicBehaviorObservation'
import { createImageNode, createTextNode } from '../../src/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'

function requestFixture(materialText?: string) {
  const document = createBlankCourseProject({ title: '能力发现' })
  const workspace = { version: 1 as const, projectId: document.id, normalizedPath: '/capability.h5lesson' }
  return captureGenerationSnapshot({ document, workspace,
    sessionToken: { locationId: document.startLocationId, surfaceType: 'slide', revision: document.revision, generation: 1 },
    projection: projectEffectiveLayers({ project: document, locationId: document.startLocationId }), selectedIds: [], scope: 'page',
    instruction: '添加标题', purpose: 'single-page', materials: materialText ? [{ version: 1, id: crypto.randomUUID(), workspace,
      title: '已引用教材', text: materialText, source: { kind: 'text', locator: '教材第12页' }, createdAt: 1 }] : undefined })
}

describe('offline capability workspace', () => {
  it('keeps deferred observation and source inventories readable from the staged request without losing initial image paths or targets', async () => {
    const request = requestFixture()
    const png = Buffer.from(encodeImageTransformPng({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) }))
    const files = ['current-frame', 'motion/frame-1', 'images/derived'].map((name, index) => ({
      fileId: `frame-${index}`, relativePath: `observation/${name}.png`, mediaType: 'image/png', byteLength: png.length, role: 'image' as const,
    }))
    const destination = request.destinations[0]!
    const scope = destination.kind === 'create' ? destination.scope : destination.target
    request.observation = { documentRevision: request.documentRevision, sessionGeneration: request.sessionGeneration,
      draftEpoch: 1, viewEpoch: 1, runtime: null, surfaceId: scope.surfaceId, locationId: scope.locationId,
      stateId: null, source: 'authoring', capturedAt: 100, files }
    request.context = { ...request.context as object, assets: { original: { mimeType: 'image/svg+xml' } },
      runtimeSources: [{ path: 'resources/runtimes/current.js', target: destination }] }
    request.resourceFiles!.push(...files.map(file => ({ path: file.relativePath, encoding: 'base64' as const,
      content: png.toString('base64'), mediaType: file.mediaType, role: file.role })),
      { path: 'runtimes/current.js', encoding: 'utf8', content: '/* complete current source */', role: 'source' })
    const before = JSON.stringify(request), directory = await mkdtemp(path.join(os.tmpdir(), 'initial-request-details-'))
    try {
      const root = await new CandidateStaging(directory).create(request)
      const wire = JSON.parse(buildGenerationPrompt('codex', request, root).split('\n').at(-1)!)
      const details = JSON.parse(await readFile(path.join(root, wire.requestDetails.path), 'utf8'))
      expect(wire.destinations).toEqual(request.destinations)
      expect(wire.context.capabilities.cards).toEqual(details.context.capabilities.cards)
      expect(details.observation).toEqual(request.observation)
      expect(details.context.assets).toEqual((request.context as any).assets)
      expect(details.context.runtimeSources).toEqual((request.context as any).runtimeSources)
      for (const file of files) {
        expect(wire.resourceIndex).toContainEqual({ path: `resources/${file.relativePath}`, mediaType: 'image/png', role: 'image' })
        expect(await readFile(path.join(root, 'resources', file.relativePath))).toEqual(png)
      }
      expect(await readFile(path.join(root, details.context.runtimeSources[0].path), 'utf8')).toBe('/* complete current source */')
      expect(JSON.stringify(request)).toBe(before)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('gives Claude a valid reply terminator after a committed edit without demanding another candidate', () => {
    const request = { ...requestFixture(), expectedResult: 'auto' as const }
    const prompt = buildGenerationPrompt('claude', request, path.resolve('candidate-root'))
    const start = prompt.indexOf(GENERATION_RESULT_OPEN), end = prompt.indexOf(GENERATION_RESULT_CLOSE, start)
    const example = prompt.slice(start, end + GENERATION_RESULT_CLOSE.length)
    expect(start).toBeGreaterThan(-1)
    expect(readGenerationResult(`已核对宿主回执，修改完成。${example}`, request)).toEqual({ kind: 'answer', requestId: request.requestId })
    expect(readGenerationResult(example, { ...request, expectedResult: 'candidate' })).toMatchObject({ kind: 'candidate-format-error' })
  })
  it('keeps complete selected material text and provenance in an on-demand file instead of overflowing the technical prompt', async () => {
    const material = '分母表示平均分的份数。\n'.repeat(20_000)
    const request = requestFixture(material)
    expect(JSON.stringify(generationRequestForPrompt(request))).not.toContain(material.slice(0, 500))
    const reference = (request.context as { materials: { textFile: string; source: { locator: string }; textByteLength: number }[] }).materials[0]!
    expect(reference.source.locator).toBe('教材第12页')
    expect(reference.textByteLength).toBe(Buffer.byteLength(material))
    const directory = await mkdtemp(path.join(os.tmpdir(), 'material-prompt-'))
    try {
      const root = await new CandidateStaging(directory).create(request)
      expect(await readFile(path.join(root, reference.textFile), 'utf8')).toBe(material)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('returns continuous host frames as immutable files with timing and source identity, without claiming semantic success', async () => {
    const request = requestFixture(), destination = request.destinations[0]!
    const scope = destination.kind === 'create' ? destination.scope : destination.target
    request.observation = { documentRevision: request.documentRevision, sessionGeneration: request.sessionGeneration,
      draftEpoch: 1, viewEpoch: 1, runtime: null, surfaceId: scope.surfaceId, locationId: scope.locationId,
      stateId: null, source: 'authoring', capturedAt: 100, files: [] }
    const png = Buffer.from(encodeImageTransformPng({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) }))
    const evidence: DynamicBehaviorObservation = { version: 1, status: 'observed', mode: 'full-admission', projectId: request.workspace.projectId,
      documentRevision: request.documentRevision, locationId: scope.locationId, stateId: null, instanceIds: ['runtime'], sourceIdentities: { runtime: 'source-identity' },
      actions: ['suspend', 'resume'], elapsedMs: 900, semanticVerdict: 'requires-review',
      frames: ['running', 'paused', 'resumed'].map((phase, index) => ({ phase: phase as 'running' | 'paused' | 'resumed', elapsedMs: index * 300,
        capturedAt: 100 + index * 300, stateVersion: index, publicState: { answer: 'current' }, width: 1, height: 1, dataUrl: `data:image/png;base64,${png.toString('base64')}` })) }
    const before = JSON.stringify(request), enriched = attachGenerationBehaviorEvidence(request, [evidence])
    expect(JSON.stringify(request)).toBe(before)
    const frames = enriched.observation!.files.filter(file => file.role === 'image')
    expect(frames).toHaveLength(3)
    const directory = await mkdtemp(path.join(os.tmpdir(), 'course-behavior-files-'))
    try {
      const staging = new CandidateStaging(directory), root = await staging.create(enriched)
      for (const frame of frames) expect(await readFile(path.join(root, 'resources', frame.relativePath))).toEqual(png)
      const index = JSON.parse(await readFile(path.join(root, 'resources/observation/dynamic/behavior.json'), 'utf8'))
      expect(index.semanticVerdict).toBe('requires-review')
      expect(index.observations[0].sourceIdentities).toEqual(evidence.sourceIdentities)
      expect(index.observations[0].frames.map((frame: { elapsedMs: number }) => frame.elapsedMs)).toEqual([0, 300, 600])
      expect(JSON.stringify(generationRequestForPrompt(enriched))).not.toContain(png.toString('base64'))
      expect(() => attachGenerationBehaviorEvidence(request, [{ ...evidence, projectId: 'another-project' }])).toThrow('不属于当前工程')
      await staging.remove(enriched.requestId)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('directly supplies complete title, style and position contracts under the initial technical budget', () => {
    const context = generationCapabilityContext([{ items: [{ item: { kind: 'native', content: { nativeType: 'text' } } }] }], 'local-edit')
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(12 * 1024)
    expect(context.deferred).toEqual([])
    expect(Buffer.byteLength(generationCapabilityData.files['discovery.json']!)).toBeLessThan(8 * 1024)
    const text = context.cards.find(card => 'content' in card && card.content.inputSchema.oneOf[0].properties.textStyle)!
    expect('content' in text && text.content.inputSchema.oneOf).toHaveLength(1)
    expect(JSON.stringify(text)).toContain('fontSize')
    const fullContent = readCourseAgentCapability(generationCapabilityData, 'native.content', { operation: 'content', nativeType: 'text' })
    expect('content' in fullContent && fullContent.content.references.text.required).toEqual(expect.arrayContaining(['text', 'runs', 'style']))
    expect(JSON.stringify(text)).toContain('frame')
    expect(context.cards).toHaveLength(1)
    const prompt = generationRequestForPrompt(requestFixture())
    expect(prompt).not.toHaveProperty('resourceFiles')
    expect(prompt.context).not.toHaveProperty('tools')
    expect(prompt.context).not.toHaveProperty('dynamicCapabilities')
  })

  it.each([
    ['text', 'edit'], ['image', 'edit'], ['text', 'plan'], ['image', 'plan'],
  ] as const)('keeps the entire %s selection %s wire prompt under 12 KiB with current observation and native paths', (nativeType, intent) => {
    const document = createBlankCourseProject({ title: '自然语言编辑验收', includeDefaultController: false, controls: 'none' })
    const surface = document.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Expected default Slide')
    const node = nativeType === 'text'
      ? createTextNode({ id: 'native-title', name: '课程标题', text: '振动的世界', x: 86, y: 72, width: 760, height: 78, style: { fontSize: 32, align: 'left' } })
      : createImageNode({ id: 'native-red-image', name: '红色图片', assetId: 'red-artwork', x: 150, y: 265, width: 360, height: 240 })
    surface.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(node, 0))
    document.assets['red-artwork'] = { id: 'red-artwork', kind: 'image', filename: 'red-artwork.png', mimeType: 'image/png',
      path: 'assets/red-artwork.png', byteLength: 31640, width: 240, height: 160 }
    const request = captureGenerationSnapshot({ document,
      workspace: { version: 1, projectId: document.id, normalizedPath: 'c:/users/teacher/documents/lessons/自然语言编辑验收.h5lesson' },
      sessionToken: { locationId: document.startLocationId, surfaceType: 'slide', revision: document.revision, generation: 1 },
      projection: projectEffectiveLayers({ project: document, locationId: document.startLocationId }), selectedIds: [node.id], scope: 'selection',
      instruction: intent === 'plan' ? '先给我调整方案，不改课件' : nativeType === 'image' ? '帮我把颜色改为绿色。' : '把这个标题改成简谐运动，放大一点并居中。', purpose: 'local-edit', expectedResult: 'auto', intent })
    const context = request.context as unknown as { pages: unknown[]; capabilities: ReturnType<typeof generationCapabilityContext> }
    request.observation = { documentRevision: document.revision, sessionGeneration: 1, draftEpoch: 1, viewEpoch: 1, runtime: null,
      surfaceId: surface.id, locationId: document.startLocationId, stateId: null, source: 'authoring', capturedAt: Date.now(),
      files: ['current-frame.png', 'images/0.png'].map((name, index) => ({ fileId: `image-${index}`, relativePath: `observation/${name}`, mediaType: 'image/png', byteLength: 31640, role: 'image' })) }
    request.resourceFiles!.push(...request.observation.files.map(file => ({ path: file.relativePath, encoding: 'base64' as const,
      content: Buffer.alloc(file.byteLength).toString('base64'), mediaType: file.mediaType, role: file.role })),
    { path: 'observation/current-structure.json', encoding: 'utf8', content: JSON.stringify(context.pages), mediaType: 'application/json', role: 'structure' })
    const root = path.resolve('C:/Users/teacher/AppData/Roaming/courseware/local-agent/v2/' + 'a'.repeat(64) + '/34190d74-0ac1-46f0-a8f9-08e6c441c03e/staging/candidates/' + request.requestId)
    for (const adapter of ['codex', 'claude', 'opencode'] as const) {
      const prompt = buildGenerationPrompt(adapter, request, root)
      expect(Buffer.byteLength(prompt), `${adapter} full prompt`).toBeLessThanOrEqual(12 * 1024)
      expect(prompt).not.toContain(Buffer.alloc(100).toString('base64'))
      expect(prompt).toContain('resources/observation/images/0.png')
      if (adapter !== 'codex') {
        expect(prompt).toContain('workspace.root 下的 candidate.json')
        expect(prompt).toContain('勿手工转抄base64')
        expect(prompt).not.toContain('写 candidate.json 不算交付')
      }
      const profile = createGenerationProfile(adapter, request, undefined, root), projected = generationProfileForPrompt(profile)
      for (const skill of projected.skills) expect(path.resolve(projected.workspace.capabilities, skill.path)).toBe(profile.skills.find(value => value.name === skill.name)!.path)
      if (nativeType === 'image') expect(context.capabilities.cards[0]!.entry.id).toBe('asset.image.transform')
    }
  })

  it('filters supported destinations and rejects stale versions and unknown queries without losing complete resources', () => {
    expect(queryCourseAgentCapabilities(generationCapabilityData, { surface: 'spatial-2d', carrier: 'runtime', kind: 'tool' }).entries).toEqual([])
    expect(() => queryCourseAgentCapabilities(generationCapabilityData, { surface: 'flow', owner: 'scene' })).toThrow('不匹配')
    expect(() => queryCourseAgentCapabilities(generationCapabilityData, { semanticVersion: 'old' })).toThrow('版本')
    expect(() => queryCourseAgentCapabilities(generationCapabilityData, { ids: ['missing'] })).toThrow('未知')
    expect(() => readCourseAgentCapability(generationCapabilityData, 'missing')).toThrow('未知')
    expect(() => readCourseAgentCapability(generationCapabilityData, 'native.content', { operation: 'invented' })).toThrow('不支持')
    expect(courseAgentCapabilityCacheKey(generationCapabilityData, { surface: 'flow', kind: 'tool' })).toBe(courseAgentCapabilityCacheKey(generationCapabilityData, { kind: 'tool', surface: 'flow' }))
    expect(readCourseAgentCapability(generationCapabilityData, 'component-api4')).toMatchObject({ content: { types: expect.any(String) } })
    expect(readCourseAgentCapability(generationCapabilityData, 'skill:build-courseware-project')).toHaveProperty('text')
  })

  it('stages complete attachments and runs a deep absolute query from the original short native cwd', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'course-capability-'))
    try {
      const request = requestFixture()
      request.resourceFiles!.push({ path: 'sources/large.js', encoding: 'utf8', content: 'x'.repeat(180000), role: 'source' },
        { path: 'images/test.png', encoding: 'base64', content: Buffer.from([0, 1, 128, 255]).toString('base64'), role: 'image', mediaType: 'image/png' })
      const sessionDirectory = path.join(directory, ...Array.from({ length: 36 }, (_, index) => `level-${index}`))
      await mkdir(sessionDirectory, { recursive: true })
      const staging = new CandidateStaging(sessionDirectory)
      const root = await staging.create(request)
      const profile = createGenerationProfile('claude', request, 'structured-stdout', root)
      expect(profile.workspace.query.length).toBeGreaterThan(300)
      expect(profile.skills.every(skill => path.isAbsolute(skill.path) && !('markdown' in skill))).toBe(true)
      expect(await readFile(profile.skills[0]!.path, 'utf8')).toContain('原生文件')
      expect(await readFile(path.join(profile.workspace.capabilities, 'skills/build-courseware-project/references/main-progression.md'), 'utf8')).toContain('正文')
      expect(await readFile(path.join(root, 'resources/sources/large.js'), 'utf8')).toHaveLength(180000)
      expect([...await readFile(path.join(root, 'resources/images/test.png'))]).toEqual([0, 1, 128, 255])
      expect(await readFile(path.join(root, 'request.json'), 'utf8')).not.toContain('x'.repeat(1000))
      const output = await promisify(execFile)(process.execPath, [profile.workspace.query, '--id', 'native.content', '--operation', 'properties'], { cwd: directory, windowsHide: true })
      expect(JSON.parse(output.stdout)).toMatchObject({ entry: { id: 'native.content' }, content: { inputSchema: { oneOf: [{ properties: { operation: { const: 'properties' } } }] } } })
      await staging.remove(request.requestId)
      await expect(readFile(path.join(root, 'request.json'))).rejects.toThrow()
      // The actual native query path from turn A remains usable after its
      // candidate root is gone, including when a fresh request B is staged.
      const next = { ...request, requestId: crypto.randomUUID() }
      const nextRoot = await staging.create(next)
      expect(createGenerationProfile('claude', next, 'structured-stdout', nextRoot).workspace.capabilities).toBe(profile.workspace.capabilities)
      const afterCleanup = await promisify(execFile)(process.execPath, [profile.workspace.query, '--id', 'reference:runtime-api2/authoring'], { cwd: directory, windowsHide: true })
      expect(JSON.parse(afterCleanup.stdout).text).toContain('pointer-events')
      expect(await staging.readText(next.requestId)).toBeNull()
      await expect(staging.readText(request.requestId)).rejects.toThrow()
      const projected = JSON.parse(await readFile(path.join(nextRoot, 'request.json'), 'utf8'))
      expect(path.resolve(profile.workspace.capabilities, projected.context.capabilities.query)).toBe(profile.workspace.query)
      await staging.remove(next.requestId)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('isolates capability versions and refuses to overwrite changed same-version files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'course-capability-identity-'))
    try {
      const request = requestFixture(), staging = new CandidateStaging(directory), root = await staging.create(request)
      const current = generationCapabilityDirectory(root)
      const prior = generationCapabilityDirectory(root, '0'.repeat(64))
      await mkdir(prior, { recursive: true })
      await writeFile(path.join(prior, 'historical.txt'), 'older semantic version')
      expect(prior).not.toBe(current)
      await staging.remove(request.requestId)
      await writeFile(path.join(current, 'discovery.json'), 'changed outside the capability owner')
      await expect(staging.create({ ...request, requestId: crypto.randomUUID() })).rejects.toThrow('语义版本不一致')
      expect(await readFile(path.join(current, 'discovery.json'), 'utf8')).toBe('changed outside the capability owner')
      expect(await readFile(path.join(prior, 'historical.txt'), 'utf8')).toBe('older semantic version')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('rejects traversal, duplicate resource paths, malformed base64 and oversize attachments', async () => {
    const request = requestFixture()
    expect(() => generationRequestSchema.parse({ ...request, resourceFiles: [{ path: '../escape', encoding: 'utf8', content: '' }] })).toThrow()
    expect(() => generationRequestSchema.parse({ ...request, resourceFiles: ['A.js', 'a.js'].map(path => ({ path, encoding: 'utf8', content: '' })) })).toThrow('重复')
    expect(() => generationRequestSchema.parse({ ...request, resourceFiles: [{ path: 'large', encoding: 'utf8', content: 'x'.repeat(13 * 1024 * 1024) }] })).toThrow()
    const directory = await mkdtemp(path.join(os.tmpdir(), 'course-capability-'))
    try {
      await expect(new CandidateStaging(directory).create({ ...request, resourceFiles: [{ path: 'bad.png', encoding: 'base64', content: '??' }] })).rejects.toThrow('base64')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
