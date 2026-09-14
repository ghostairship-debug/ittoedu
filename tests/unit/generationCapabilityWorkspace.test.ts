import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CandidateStaging } from '../../src/main/localAgent/candidateStaging'
import { generationCapabilityDirectory } from '../../src/main/localAgent/capabilityWorkspace'
import { buildGenerationPrompt, createGenerationProfile, generationInitialRequestForPrompt, generationProfileForPrompt, generationRequestForPrompt } from '../../src/main/localAgent/profile'
import { generationRequestSchema } from '../../src/shared/generationContract'
import { GENERATION_RESULT_OPEN, GENERATION_RESULT_CLOSE, readGenerationResult } from '../../src/shared/generationResult'
import { courseAgentCapabilityCacheKey, queryCourseAgentCapabilities, readCourseAgentCapability, runCourseAgentCapabilityQuery } from '../../src/shared/courseAgentCapabilities'
import { generationCapabilityContext, generationCapabilityData } from '../../src/renderer/authoring/generation/generationCapabilities'
import { captureGenerationSnapshot } from '../../src/renderer/authoring/generation/generationSnapshot'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { projectEffectiveLayers } from '../../src/renderer/course/effectiveLayerProjection'
import { attachGenerationBehaviorEvidence } from '../../src/renderer/authoring/generation/generationBehaviorResources'
import { encodeImageTransformPng } from '../../src/renderer/project/imageTransform'
import type { DynamicBehaviorObservation } from '../../src/shared/dynamicBehaviorObservation'
import { createImageNode, createTextNode } from '../../src/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { componentPackageTool } from '../../src/renderer/authoring/tools/componentPackageTool'
import { imageTransformInputSchema } from '../../src/shared/imageTransformContract'
import { withDefaultComponentController } from '../../src/renderer/components/teacherControllerComponent'

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
  it('discovers a compact file transport while keeping the strict document schema available on demand', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'file-contract-'))
    try {
      const root = await new CandidateStaging(directory).create(requestFixture())
      const caps = generationCapabilityDirectory(root)
      const raw = await readFile(path.join(caps, 'tools/project.document.json'), 'utf8'), card = JSON.parse(raw)
      expect(Buffer.byteLength(raw)).toBeLessThan(4096)
      expect(card.inputSchema.properties.artifact.required).toEqual(['$candidateFile'])
      const canonical = JSON.parse(await readFile(path.join(caps, card.artifactSchema), 'utf8'))
      expect(canonical.required).toContain('document')
      expect(canonical.required).not.toContain('artifact')
      expect(canonical.properties.document).toBeDefined()
      expect(canonical.additionalProperties).toBe(false)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('reads exact staged image, source, skill and query paths from one request anchor without changing the native cwd', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), '课件 路径入口-'))
    try {
      const request = requestFixture(), staging = new CandidateStaging(directory)
      const image = Buffer.from(encodeImageTransformPng({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) }))
      request.resourceFiles!.push(
        { path: 'images/原始 图片.png', encoding: 'base64', content: image.toString('base64'), role: 'image', mediaType: 'image/png' },
        { path: 'runtimes/当前 互动.js', encoding: 'utf8', content: 'const answer = "点击后显示";', role: 'source' },
      )
      const before = JSON.stringify(request), root = await staging.create(request)
      const profile = createGenerationProfile('opencode', request, undefined, root)
      const prompt = buildGenerationPrompt('opencode', request, root)
      const initialProfile = JSON.parse(prompt.split('\n').find(line => line.startsWith('{"profile":'))!).profile
      expect(initialProfile.workspace).toEqual({ rootEnvironment: 'COURSEWARE_CANDIDATE_ROOT', request: path.join(root, 'request.json') })
      const initial = JSON.parse(prompt.split('\n').at(-1)!)
      const details = JSON.parse((await promisify(execFile)(process.execPath, ['-e', "process.stdout.write(require('node:fs').readFileSync(require('node:path').join(process.env.COURSEWARE_CANDIDATE_ROOT,'request.json'),'utf8'))"], {
        cwd: directory, env: { ...process.env, COURSEWARE_CANDIDATE_ROOT: root }, windowsHide: true,
      })).stdout)
      expect(prompt).not.toContain(root)
      expect(details.fileAccess).toMatchObject({ root, resources: path.join(root, 'resources'), query: profile.workspace.query, capabilities: profile.workspace.capabilities })
      expect(JSON.parse(await readFile(details.fileAccess.discovery, 'utf8'))).toHaveProperty('tools')
      for (const skill of profile.skills) {
        expect(details.fileAccess.skills[skill.name]).toBe(skill.path)
        expect(await readFile(details.fileAccess.skills[skill.name], 'utf8')).not.toHaveLength(0)
      }
      for (const file of request.resourceFiles!) {
        const reference = details.resourceIndex.find((entry: { path: string }) => entry.path === `resources/${file.path}`)
        expect(path.isAbsolute(reference.localPath)).toBe(true)
        expect(path.relative(root, reference.localPath).split(path.sep).join('/')).toBe(reference.path)
        expect(await readFile(reference.localPath)).toEqual(Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8'))
      }
      const query = await promisify(execFile)(process.execPath,
        [details.fileAccess.query, '--id', 'native.content', '--operation', 'properties'], { cwd: directory, windowsHide: true })
      expect(JSON.parse(query.stdout).content.inputSchema.oneOf[0].properties.operation.const).toBe('properties')
      expect(initial.context.capabilities.semanticVersion).toBe((request.context as any).capabilities.semanticVersion)
      expect(initial.context.capabilities.cards.map((card: any) => ({ ...card,
        semanticVersion: card.semanticVersion ?? initial.context.capabilities.semanticVersion,
      }))).toEqual((request.context as any).capabilities.cards)
      expect(initial).not.toHaveProperty('fileAccess')
      expect(initial.resourceIndex.every((file: object) => !('localPath' in file))).toBe(true)
      expect(prompt).not.toContain(details.fileAccess.capabilities)
      expect(JSON.stringify(request)).toBe(before)

      const next = { ...request, requestId: crypto.randomUUID(), resourceFiles: [{ path: 'images/原始 图片.png', encoding: 'utf8' as const, content: 'new request bytes', role: 'image' as const }] }
      const nextRoot = await staging.create(next), nextDetails = JSON.parse(await readFile(path.join(nextRoot, 'request.json'), 'utf8'))
      expect(nextDetails.fileAccess.capabilities).toBe(details.fileAccess.capabilities)
      expect(nextDetails.resourceIndex[0].localPath).not.toBe(details.resourceIndex.find((file: { path: string }) => file.path === 'resources/images/原始 图片.png').localPath)
      expect(await readFile(nextDetails.resourceIndex[0].localPath, 'utf8')).toBe('new request bytes')
      await staging.remove(request.requestId)
      await expect(readFile(details.resourceIndex[0].localPath)).rejects.toThrow()
      expect(await readFile(nextDetails.resourceIndex[0].localPath, 'utf8')).toBe('new request bytes')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
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
      expect(wire).not.toHaveProperty('destinations')
      expect(Object.values(wire.destinationAliases)).toEqual(request.destinations)
      expect(wire.context.capabilities.cards.map((card: any) => ({ semanticVersion: wire.context.capabilities.semanticVersion, ...card }))).toEqual(details.context.capabilities.cards)
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
    const example = `${GENERATION_RESULT_OPEN}${JSON.stringify({ version: 1, requestId: request.requestId, kind: 'answer' })}${GENERATION_RESULT_CLOSE}`
    expect(prompt).toContain('将kind改为answer')
    expect(readGenerationResult(`已核对宿主回执，修改完成。${example}`, request)).toEqual({ kind: 'answer', requestId: request.requestId })
    expect(readGenerationResult(example, { ...request, expectedResult: 'candidate' })).toMatchObject({ kind: 'candidate-format-error' })
  })
  it('classifies explicit file delivery without a received candidate as a format failure while an unsupported edit remains a plain reply', () => {
    const request = { ...requestFixture(), expectedResult: 'auto' as const }
    for (const adapter of ['claude', 'opencode'] as const) {
      const prompt = buildGenerationPrompt(adapter, request, path.resolve('candidate-root'))
      const delivered = `${GENERATION_RESULT_OPEN}${JSON.stringify({ version: 1, requestId: request.requestId, kind: 'edit' })}${GENERATION_RESULT_CLOSE}`
      expect(prompt).toContain(delivered)
      expect(readGenerationResult(`已写候选。${delivered}`, request)).toMatchObject({ kind: 'candidate-format-error', requestId: request.requestId })
      expect(readGenerationResult('当前无法完成修改，需要核对素材。', request)).toEqual({ kind: 'answer', requestId: request.requestId })
    }
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

  it('supplies complete image, text and layout branches together for a mixed redesign', () => {
    const context = generationCapabilityContext([{ items: [{ item: { kind: 'native', content: { nativeType: 'text' } } }] }],
      'local-edit', generationCapabilityData, '重构本页，将红色图片改为秦始皇的图片，背景改为战国地图，文案、布局也要重新适配')
    expect(context.cards.map(card => card.entry.id)).toEqual(['media.apply', 'native.content', 'native.content', 'native.content'])
    expect(context.deferred.filter(card => card.id === 'native.content')).toEqual([])
    expect(Buffer.byteLength(JSON.stringify(context.cards))).toBeLessThanOrEqual(16_000)
  })

  it('keeps a fixed shape-to-image request unchanged when unrelated capability families grow', () => {
    const pages = [{ items: [{ selected: true, item: { kind: 'native', content: { nativeType: 'shape' } } }] }]
    const instruction = '帮我将这个形状替换为卡通小狗图片'
    const context = generationCapabilityContext(pages, 'local-edit', generationCapabilityData, instruction)
    expect(context.cards[0]!.entry.id).toBe('media.apply')
    const source = context.cards[0]!
    expect('content' in source && source.content.inputSchema.properties.source).toBeDefined()
    const unrelated = { id: 'unrelated.future-family', kind: 'tool' as const, label: 'Independent family',
      path: 'tools/unrelated.future-family.json', scopes: ['slide:scene'], carriers: ['native'], summary: 'Unrelated operation' }
    const grown = { ...generationCapabilityData, entries: [...generationCapabilityData.entries, unrelated],
      files: { ...generationCapabilityData.files, [unrelated.path]: JSON.stringify({ inputSchema: { description: 'unrelated'.repeat(10_000) } }) } }
    const after = generationCapabilityContext(pages, 'local-edit', grown, instruction)
    expect(after).toEqual(context)
    const request = generationRequestSchema.parse({ ...requestFixture(), instruction, context: { pages, capabilities: context } })
    const root = path.resolve('C:/teacher/current-candidate')
    for (const adapter of ['codex', 'claude', 'opencode'] as const) {
      const beforePrompt = buildGenerationPrompt(adapter, request, root)
      const afterPrompt = buildGenerationPrompt(adapter, generationRequestSchema.parse({ ...request, context: { pages, capabilities: after } }), root)
      expect(afterPrompt).toBe(beforePrompt)
      expect(Buffer.byteLength(afterPrompt)).toBeLessThanOrEqual(12 * 1024)
    }
  })

  it('projects only explicit frozen media asset references and keeps the complete alias inventory on demand', () => {
    const request = requestFixture()
    const asset = (id: string) => ({ id, kind: 'image', filename: `${id}.png`, mimeType: 'image/png', path: `assets/${id}.png`, byteLength: 10 })
    request.context = { assets: { 'a-hidden': asset('a-hidden'), 'b-image': asset('b-image'), 'c-flow-media': asset('c-flow-media'), invalid: { id: 'another-id' } },
      pages: [{ items: [
        { item: { kind: 'native', content: { nativeType: 'text', data: { text: 'a-hidden' } } } },
        { item: { kind: 'native', content: { nativeType: 'image', data: { assetId: 'b-image' } } } },
      ], blocks: [{ block: { type: 'media', assetId: 'c-flow-media' } }] }], arbitraryText: 'a-hidden' }
    expect(generationRequestForPrompt(request).assetAliases).toEqual({ a1: 'a-hidden', a2: 'b-image', a3: 'c-flow-media' })
    expect(generationInitialRequestForPrompt(request).assetAliases).toEqual({ a2: 'b-image', a3: 'c-flow-media' })
    expect(generationInitialRequestForPrompt(request).requestDetails.fields).toContain('assetAliases')
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
    const startedAt = Date.now()
    request.execution = { version: 1, startedAt, deadlineAt: startedAt + 20 * 60 * 1000 }
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
      const initial = JSON.parse(prompt.split('\n').at(-1)!)
      if (nativeType === 'image') expect(initial.assetAliases).toEqual({ a1: 'red-artwork' })
      else expect(initial).not.toHaveProperty('assetAliases')
      if (adapter !== 'codex') {
        expect(prompt).toContain(JSON.stringify(path.join(root, 'request.json')))
        expect(prompt).toContain('勿手抄路径/UUID/base64')
        expect(prompt).not.toContain('写 candidate.json 不算交付')
      }
      const profile = createGenerationProfile(adapter, request, undefined, root), projected = generationProfileForPrompt(profile)
      expect(projected.skills).toEqual(profile.skills.map(skill => skill.name))
      expect(projected.workspace).toEqual({ rootEnvironment: 'COURSEWARE_CANDIDATE_ROOT', request: path.join(root, 'request.json') })
      if (nativeType === 'image') expect(context.capabilities.cards[0]!.entry.id).toBe('asset.image.transform')
    }
  })

  it('discovers component patch modes by their exact destination domain and returns one complete directed card', () => {
    const instance = queryCourseAgentCapabilities(generationCapabilityData, { ids: ['component.package'], operation: 'patch', mode: 'instance', surface: 'flow', owner: 'surface', detail: 'full' })
    expect(instance.total).toBe(1)
    expect(instance.entries[0]!.variants).toEqual([expect.objectContaining({ operation: 'patch', mode: 'instance', target: expect.stringContaining('只重绑此实例') })])
    const card = instance.cards![0]!
    expect(card.content.inputSchema.oneOf).toHaveLength(1)
    expect(card.content.inputSchema.oneOf[0].properties.mode).toEqual({ type: 'string', const: 'instance' })
    expect(card.content.inputSchema.oneOf[0].required).toEqual(expect.arrayContaining(['operation', 'mode', 'basePackageId', 'baseVersion', 'baseContentIdentity', 'changedFiles', 'deleteFiles']))
    expect(card.content.examples).toHaveLength(1)
    expect(card.content.examples[0]).toMatchObject({ operation: 'patch', mode: 'instance', code: expect.stringContaining('session.execute') })
    expect(card.content.recovery).toContain('revision-conflict')
    const scoped = readCourseAgentCapability(generationCapabilityData, 'component.package', { surface: 'flow', owner: 'surface' })
    expect(scoped.content.inputSchema).toEqual(card.content.inputSchema)
    expect(scoped.content.examples).toEqual(card.content.examples)
    expect(queryCourseAgentCapabilities(generationCapabilityData, { ids: ['component.package'], operation: 'patch', mode: 'shared', surface: 'flow', owner: 'surface' }).total).toBe(0)
    expect(readCourseAgentCapability(generationCapabilityData, 'component.package', { operation: 'patch', mode: 'shared', surface: 'slide', owner: 'global' }).content.variants).toEqual([expect.objectContaining({ mode: 'shared', target: expect.stringContaining('所有实例') })])
    expect(() => readCourseAgentCapability(generationCapabilityData, 'component.package', { operation: 'replace', mode: 'instance' })).toThrow('不支持')
    expect(() => readCourseAgentCapability(generationCapabilityData, 'component.package', { operation: 'patch', mode: 'shared', surface: 'slide', owner: 'scene' })).toThrow('不支持')
    expect(queryCourseAgentCapabilities(generationCapabilityData, { ids: ['component.insert'], operation: 'existing', carrier: 'generated-component' }).total).toBe(0)
    const generated = queryCourseAgentCapabilities(generationCapabilityData, { ids: ['component.insert'], carrier: 'generated-component', detail: 'full' })
    expect(generated.cards![0]!.content.inputSchema.oneOf).toHaveLength(1)
    expect(generated.cards![0]!.content.inputSchema.oneOf[0].properties.operation.const).toBe('candidate')
  })

  it('binds mode and image examples to current resource values accepted by the formal tool schemas', async () => {
    const baseline = { packageId: 'observed-package', baseVersion: '1.0.0', baseContentIdentity: 'a'.repeat(64) }
    const changedFiles = { 'index.js': { encoding: 'utf8', text: '/* changed current source */' } }
    const target = { itemId: 'observed-instance' }
    for (const mode of ['shared', 'instance']) {
      const card = readCourseAgentCapability(generationCapabilityData, 'component.package', { operation: 'patch', mode })
      const calls: any[] = []
      const session = { execute: async (...args: any[]) => { calls.push(args); return { status: 'committed' } } }
      const invoke = new Function('session', 'baseline', 'changedFiles', 'target', `return (async()=>{${card.content.examples[0].code}})()`)
      await invoke(session, baseline, changedFiles, target)
      expect(calls).toHaveLength(1)
      expect(componentPackageTool.inputSchema.parse(calls[0][1])).toMatchObject({ operation: 'patch', mode, basePackageId: baseline.packageId, changedFiles })
      expect(calls[0][2].target).toBe(target)
    }
    const card = readCourseAgentCapability(generationCapabilityData, 'asset.image.transform')
    const calls: any[] = []
    const invoke = new Function('session', 'sourceAssetId', 'sourceColor', 'target', `return (async()=>{${card.content.examples[0].code}})()`)
    await invoke({ execute: async (...args: any[]) => calls.push(args) }, 'observed-image', '#dd3322', target)
    expect(imageTransformInputSchema.parse(calls[0][1])).toMatchObject({ sourceAssetId: 'observed-image', operations: [{ kind: 'replace-color', sourceColor: '#dd3322', targetColor: '#22c55e' }] })
  })

  it('returns help and compact no-argument discovery while directed CLI queries include complete schemas and references', () => {
    expect(runCourseAgentCapabilityQuery(generationCapabilityData, ['--help'])).toContain('--mode')
    expect(runCourseAgentCapabilityQuery(generationCapabilityData, [])).toMatchObject({ tools: expect.any(Array), query: 'query.mjs' })
    const args = ['--id', 'native.content', '--operation', 'content', '--nativeType', 'image']
    const card = runCourseAgentCapabilityQuery(generationCapabilityData, args) as any
    expect(card).toEqual(readCourseAgentCapability(generationCapabilityData, 'native.content', { operation: 'content', nativeType: 'image' }))
    expect(card.content.references.image).toBeDefined()
    expect(Object.keys(card.content.references)).toEqual(['image'])
    expect(card.content.examples).toEqual([expect.objectContaining({ operation: 'content' })])
    const query = runCourseAgentCapabilityQuery(generationCapabilityData, ['--query', 'component.package', '--operation', 'patch', '--mode', 'instance', '--owner', 'scene', '--surface', 'slide']) as any
    expect(query.cards[0].content.inputSchema.oneOf[0].properties.mode.const).toBe('instance')
    expect(runCourseAgentCapabilityQuery(generationCapabilityData, [...args, '--summary'])).not.toHaveProperty('cards')
    expect(() => runCourseAgentCapabilityQuery(generationCapabilityData, ['--id'])).toThrow('缺少')
    expect(() => runCourseAgentCapabilityQuery(generationCapabilityData, ['--nope'])).toThrow('未知')
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


it('QP06 bundled helper writes a valid candidate in an unrelated Chinese path and rejects an operation-target mismatch', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), '候选 helper 无仓库 '))
  try {
    const request = requestFixture(), root = await new CandidateStaging(directory).create(request)
    const details = JSON.parse(await readFile(path.join(root, 'request.json'), 'utf8'))
    const create = Object.entries(details.destinationAliases).find(([,d]: any) => d.kind === 'create' && d.scope.owner === 'scene' && d.scope.parent.kind === 'owner')![0]
    const input = path.join(directory, '草稿.json')
    await writeFile(input, JSON.stringify({ summary: '创建独立图形', steps: [{ id: 'shape', tool: 'native.content', destination: create, input: { operation: 'insert', template: { nativeType: 'shape', shapeType: 'ellipse', style: { fillColor: '#ffff00' } } } }] }))
    const args = [details.fileAccess.candidateHelper, '--request', path.join(root, 'request.json'), '--input', input]
    const result = await promisify(execFile)(process.execPath, args, { cwd: directory, windowsHide: true })
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'prechecked', candidateFile: 'candidate.json' })
    const candidate = JSON.parse(await readFile(path.join(root, 'candidate.json'), 'utf8'))
    expect(candidate).toMatchObject({ version: 1, requestId: request.requestId, steps: [{ id: 'shape' }] })
    await writeFile(input, JSON.stringify({ summary: '错误目标', steps: [{ id: 'bad', tool: 'native.content', destination: create, input: { operation: 'content', content: {} } }] }))
    await expect(promisify(execFile)(process.execPath, args, { cwd: directory, windowsHide: true })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('operation-target-mismatch') })
    expect(JSON.parse(await readFile(path.join(root, 'candidate.json'), 'utf8'))).toEqual(candidate)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('prechecks tool shape and prepares a source patch without copying baseline metadata by hand', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), '源码 helper '))
  try {
    const { project: document, componentPackages } = withDefaultComponentController(createBlankCourseProject())
    const request = captureGenerationSnapshot({ document, componentPackages, workspace: { version: 1, projectId: document.id, normalizedPath: '/helper.h5lesson' },
      sessionToken: { locationId: document.startLocationId, surfaceType: 'slide', revision: document.revision, generation: 1 },
      projection: projectEffectiveLayers({ project: document, locationId: document.startLocationId, owner: 'global' }),
      selectedIds: [document.globalLayerItems[0]!.item.layerItemId], scope: 'selection', instruction: '修改控制台源码', purpose: 'single-page' })
    const root = await new CandidateStaging(directory).create(request), details = JSON.parse(await readFile(path.join(root, 'request.json'), 'utf8'))
    const alias = Object.entries(details.destinationAliases).find(([, d]: any) => d.kind === 'update' && d.target.itemId === document.globalLayerItems[0]!.item.layerItemId)![0]
    const baseArgs = [details.fileAccess.candidateHelper, '--request', path.join(root, 'request.json')]
    const draft = path.join(directory, 'draft.json')
    await writeFile(draft, JSON.stringify({ summary: '错误参数', steps: [{ id: 'bad', tool: 'component.configure', destination: alias, input: { props: 123 } }] }))
    await expect(promisify(execFile)(process.execPath, [...baseArgs, '--input', draft], { cwd: directory, windowsHide: true })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('invalid-input') })
    const work = path.join(root, 'component-work'), patchArgs = [...baseArgs, '--component-target', alias, '--work-dir', work]
    await promisify(execFile)(process.execPath, [...patchArgs, '--init'], { cwd: directory, windowsHide: true })
    const source = (request.context as any).componentSources[0], original = await readFile(path.join(root, source.files['runtime.js'].path), 'utf8')
    await writeFile(path.join(work, 'runtime.js'), original + '\n// teacher custom text')
    await writeFile(path.join(work, 'new.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await promisify(execFile)(process.execPath, [...patchArgs, '--summary', '定制控制台'], { cwd: directory, windowsHide: true })
    const candidate = JSON.parse(await readFile(path.join(root, 'candidate.json'), 'utf8'))
    expect(candidate.steps[0].input).toMatchObject({ operation: 'patch', mode: 'instance', basePackageId: source.packageId, baseVersion: source.baseVersion, baseContentIdentity: source.baseContentIdentity, deleteFiles: [] })
    expect(Object.keys(candidate.steps[0].input.changedFiles).sort()).toEqual(['new.svg', 'runtime.js'])
    expect(candidate.steps[0]).not.toHaveProperty('lowerCarrierReason')
    expect(await readFile(path.join(root, source.files['runtime.js'].path), 'utf8')).toBe(original)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
