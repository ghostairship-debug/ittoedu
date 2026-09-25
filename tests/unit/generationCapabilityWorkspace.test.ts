import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs, type PathLike } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generationRequestSchema } from '../../src/shared/generationContract'
import { GENERATION_RESULT_OPEN, GENERATION_RESULT_CLOSE, readGenerationResult } from '../../src/shared/generationResult'
import { checkGenerationStaticPrecheck } from '../../src/shared/generationStaticPrecheck'
import { courseAgentCapabilityCacheKey, queryCourseAgentCapabilities, readCourseAgentCapability, runCourseAgentCapabilityQuery } from '../../src/shared/courseAgentCapabilities'
import { generationCapabilityContext, generationCapabilityData } from '../../src/renderer/authoring/generation/generationCapabilities'
import { captureGenerationFixture as captureGenerationSnapshot } from '../fixtures/generationSnapshot'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { projectEffectiveLayers } from '../../src/renderer/course/effectiveLayerProjection'
import { attachGenerationBehaviorEvidence } from '../../src/renderer/authoring/generation/generationBehaviorResources'
import { encodeImageTransformPng } from '../../src/renderer/project/imageTransform'
import type { DynamicBehaviorObservation } from '../../src/shared/dynamicBehaviorObservation'
import { createImageNode, createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { componentPackageTool } from '../../src/renderer/authoring/tools/componentPackageTool'
import { imageTransformInputSchema } from '../../src/shared/imageTransformContract'
import { withDefaultComponentController } from '../../src/renderer/components/teacherControllerComponent'

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(process, 'platform', platformDescriptor)
})

const renameLockError = () => Object.assign(new Error('rename failed'), { code: 'EPERM', syscall: 'rename' })
function stringPath(value: PathLike): string {
  if (typeof value !== 'string') throw new Error('能力工作区发布必须传入字符串路径')
  return value
}

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
  

  

  

  
  
  
  
  
  
  
  

  it('supplies complete image, text and layout branches together for a mixed redesign', () => {
    const context = generationCapabilityContext([{ items: [{ item: { kind: 'native', content: { nativeType: 'text' } } }] }],
      'local-edit', generationCapabilityData, '重构本页，将红色图片改为秦始皇的图片，背景改为战国地图，文案、布局也要重新适配')
    expect(context.cards.map(card => card.entry.id)).toEqual(['media.apply', 'native.content', 'native.content', 'native.content'])
    expect(context.deferred.filter(card => card.id === 'native.content')).toEqual([])
    expect(Buffer.byteLength(JSON.stringify(context.cards))).toBeLessThanOrEqual(16_000)
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
    expect(card.content.examples).toEqual([
      expect.objectContaining({ operation: 'content' }),
      expect.objectContaining({ operation: 'content' }),
    ])
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

  

  

  
})






it('prechecks frozen Component targets and the final changed manifest with the formal shared schema', () => {
  const { project: document, componentPackages } = withDefaultComponentController(createBlankCourseProject())
  const request = captureGenerationSnapshot({ document, componentPackages, workspace: { version: 1, projectId: document.id, normalizedPath: '/static-precheck.h5lesson' },
    sessionToken: { locationId: document.startLocationId, surfaceType: 'slide', revision: document.revision, generation: 1 },
    projection: projectEffectiveLayers({ project: document, locationId: document.startLocationId, owner: 'global' }),
    selectedIds: [document.globalLayerItems[0]!.item.layerItemId], scope: 'selection', instruction: '修改控制台', purpose: 'single-page' })
  const target = request.destinations.find((destination) => destination.kind === 'update' && destination.target.itemId === document.globalLayerItems[0]!.item.layerItemId)!
  const candidate = (step: any) => ({ version: 1 as const, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '静态反例', afterCommit: { version: 1 as const, action: 'finish' as const }, steps: [step] })
  expect(checkGenerationStaticPrecheck(candidate({ id: 'native-on-component', tool: 'native.content', carrier: 'native', destination: target, input: { operation: 'properties', properties: { frame: { x: 10 } } } }), request))
    .toMatchObject([{ code: 'static-target-carrier-mismatch' }])

  const source = (request.context as any).componentSources[0], manifest = structuredClone(componentPackages[source.packageId]!.manifest) as any
  manifest.editor = { ...(manifest.editor ?? {}), properties: [...(manifest.editor?.properties ?? []), { key: 'mode', label: '模式', type: 'select', options: ['slide', 'flow'] }] }
  const invalid = candidate({ id: 'bad-manifest', tool: 'component.package', carrier: 'generated-component', destination: target,
    input: { operation: 'patch', changedFiles: { 'manifest.json': { encoding: 'utf8', text: JSON.stringify(manifest) } } } })
  expect(checkGenerationStaticPrecheck(invalid, request)).toMatchObject([{ code: 'component-manifest-invalid' }])

  manifest.editor.properties[manifest.editor.properties.length - 1].options = [{ value: 'slide', label: '演示页' }, { value: 'flow', label: '流式讲义' }]
  const valid = candidate({ id: 'good-manifest', tool: 'component.package', carrier: 'generated-component', destination: target,
    input: { operation: 'patch', changedFiles: { 'manifest.json': { encoding: 'utf8', text: JSON.stringify(manifest) } } } })
  expect(checkGenerationStaticPrecheck(valid, request)).toEqual([])
})
