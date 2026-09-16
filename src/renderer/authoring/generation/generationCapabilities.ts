import { z } from 'zod'
import { componentManifestSchema } from '../../../shared/componentSchema'
import componentTypes from '../../../shared/contracts/component-v4/types.ts?raw'
import runtimeTypes from '../../../shared/contracts/runtime/types.ts?raw'
import surfaceRuntimeTypes from '../../../shared/contracts/runtime/surface.ts?raw'
import generatedCapabilities from '../../../shared/generated/courseAgentCapabilities.json'
import { queryCourseAgentCapabilities, readCourseAgentCapability, type CourseAgentCapabilityData, type CourseAgentCapabilityQuery } from '../../../shared/courseAgentCapabilities'
import { generationApplicabilityProjection } from '../../../shared/courseAgentApplicability'
import type { GenerationRequest } from '../../../shared/generationContract'
import { selectionActionIntents } from './selectionActionTargets'

export const generationCapabilityData = generatedCapabilities as CourseAgentCapabilityData

/** Relevant full schema branches are cheap enough to use without a discovery round trip. */
export function generationCapabilityContext(pages: readonly unknown[], purpose: string, data = generationCapabilityData, instruction = '',
  formal: Pick<GenerationRequest, 'destinations' | 'allowedCarriers'> = { destinations: [], allowedCarriers: [] }) {
  const desired = new Map<string, { id: string; operation?: string; nativeType?: string }>()
  const add = (id: string, operation?: string, nativeType?: string) => desired.set(`${id}:${operation ?? ''}:${nativeType ?? ''}`, { id, operation, nativeType })
  const layerActions = selectionActionIntents(instruction)
  if (layerActions.reorder) add('layer.edit', 'reorder')
  if (layerActions.duplicate) add('layer.edit', 'duplicate')
  const shapeTask = /图形|圆|方形|矩形|三角|\b(shape|circle|rectangle|square|triangle)\b/i.test(instruction)
  if (shapeTask) { add('native.content', 'edit-shape'); add('native.content', 'insert', 'shape') }
  // This only prioritizes discovery; it never changes authorization. A requested
  // image is discoverable even when the original target has another carrier.
  const mediaTask = /图片|插图|配图|照片|背景|\b(image|picture|photo|illustration|background)\b/i.test(instruction)
  const mixedLayoutTask = mediaTask && /文案|文字|标题|布局|排版|重构|重排|\b(text|copy|layout|redesign)\b/i.test(instruction)
  if (mediaTask) add('media.apply')
  if (mixedLayoutTask) { add('native.content', 'edit-text'); add('native.content', 'properties'); add('native.content', 'insert', 'text') }
  if (mediaTask) add('asset.media.import')
  if (/背景|\bbackground\b/i.test(instruction)) add('owner.background')
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const node = value as Record<string, any>
    if (node.kind === 'native' && node.content?.nativeType) {
      if (node.content.nativeType === 'text') add('native.content', 'edit-text')
      else if (node.content.nativeType === 'formula') add('native.content', 'edit-formula')
      else if (node.content.nativeType === 'image') {
        add('asset.image.transform')
        add('media.apply')
        add('native.content', 'properties')
        add('native.content', 'content', 'image')
      } else {
        if (node.content.nativeType === 'shape') { add('native.content', 'edit-shape'); add('native.content', 'insert', 'shape'); add('media.apply') }
        add('native.content', 'properties')
        add('native.content', 'content', node.content.nativeType)
      }
    }
    if (node.kind === 'component' || node.type === 'component') add('component.configure')
    if (node.type === 'media' && node.mediaKind === 'image') { add('asset.image.transform'); add('media.apply') }
    if (node.kind === 'runtime') { add('runtime.configure'); add('runtime.source') }
    if (node.surfaceType === 'flow') add('flow.content')
    if (Array.isArray(node.backgrounds) && node.backgrounds.length) add('owner.background')
    Object.values(node).forEach(visit)
  }
  // Selection is an observation focus, not a narrower authorization or a new
  // page order. Expand its necessary contracts before unrelated sibling cards.
  for (const page of pages) {
    if (!page || typeof page !== 'object') continue
    const { items, blocks } = page as { items?: unknown[]; blocks?: unknown[] }
    for (const row of [...(items ?? []), ...(blocks ?? [])]) {
      if (row && typeof row === 'object' && (row as { selected?: boolean }).selected === true) visit(row)
    }
  }
  pages.forEach(visit)
  if (purpose !== 'local-edit' || !desired.size) add('native.content', 'insert', 'text')
  // These are compact discovery results, not a new authorization list. A CLI
  // must still use one of the formal destinations and read the full card before
  // it submits a candidate. course-locations creates navigation only; it is
  // never a content carrier. Native and Recipe remain with their existing
  // static cards because task:create is a discovery intent, not a strict
  // assertion that every matching tool creates content.
  const createRecommendations = new Map<string, {
    destinationIndexes: number[]
    query: Required<Pick<CourseAgentCapabilityQuery, 'task' | 'kind' | 'surface' | 'owner' | 'carrier' | 'limit'>>
    entries: ReturnType<typeof queryCourseAgentCapabilities>['entries']
  }>()
  for (const [index, destination] of formal.destinations.entries()) {
    if (destination.kind !== 'create' || destination.scope.parent.kind === 'course-locations') continue
    for (const carrier of formal.allowedCarriers) {
      if (carrier === 'native' || carrier === 'recipe') continue
      const query = { task: 'create' as const, kind: 'tool' as const,
        surface: destination.scope.surfaceType, owner: destination.scope.owner, carrier, limit: 3 }
      const result = queryCourseAgentCapabilities(data, query)
      if (!result.entries.length) continue
      const key = JSON.stringify({ ...query, parent: destination.scope.parent.kind })
      const previous = createRecommendations.get(key)
      if (previous) previous.destinationIndexes.push(index)
      else createRecommendations.set(key, { destinationIndexes: [index], query, entries: result.entries })
    }
  }
  const cards: ReturnType<typeof readCourseAgentCapability>[] = []
  const deferred: { id: string; operation?: string; nativeType?: string; path: string }[] = []
  for (const { id, ...options } of desired.values()) {
    const selection = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
    // media.apply already performs the dependency and replacement branches.
    // Additional low-level edits remain discoverable when this task needs them.
    if (mediaTask && id !== 'media.apply' && !(shapeTask && id === 'native.content' && ['edit-shape', 'insert'].includes(options.operation ?? '')) && !(mixedLayoutTask && id === 'native.content' && ['edit-text', 'properties', 'insert'].includes(options.operation ?? ''))) {
      const entry = data.entries.find(entry => entry.id === id)!
      deferred.push({ id, ...selection, path: `capabilities/${entry.path}` })
      continue
    }
    const complete = readCourseAgentCapability(data, id, selection)
    // Search vocabulary is useful in discovery, but adds no tool input semantics.
    const { keywords: _keywords, variants: _variants, ...entry } = complete.entry
    const card = { ...complete, entry }
    // Multiple branches share one tool summary. Retain it once alongside all
    // complete input schemas and branch conditions, rather than repeat prose.
    if ('content' in card) {
      if (card.content?.description === entry.summary) delete card.content.description
      // The selected strict schema and entry.scopes already express these facts.
      // Keep invocation, examples, recovery and the complete reference closure.
      if (Array.isArray(card.content.variants) && card.content.variants.every((variant: { scopes: string[]; target?: string }) =>
        !variant.target && JSON.stringify(variant.scopes) === JSON.stringify(entry.scopes))) delete card.content.variants
      if (JSON.stringify(card.content.supportedScopes) === JSON.stringify(entry.scopes)) delete card.content.supportedScopes
    }
    if (cards.some(previous => previous.entry.id === id)) Reflect.deleteProperty(card.entry, 'summary')
    if (new TextEncoder().encode(JSON.stringify([...cards, card])).byteLength <= (mixedLayoutTask || shapeTask ? 16_000 : 5_200)) cards.push(card)
    else deferred.push({ id, ...selection, path: `capabilities/${card.entry.path}` })
  }
  return { version: 1, semanticVersion: data.semanticVersion, discovery: 'capabilities/discovery.json',
    query: 'capabilities/query.mjs', toolIds: [...new Set([...desired.values()].map(value => value.id))], cards, deferred,
    createRecommendations: [...createRecommendations.values()],
    applicability: generationApplicabilityProjection(),
    instruction: 'cards和toolIds是本任务入口，不是工具白名单；createRecommendations按当前正式 create destination 与允许 carrier 给出紧凑入口，destinationIndexes 指向本请求 destinations；先读取完整卡再提交候选。其余能力从discovery/query查询完整卡。图片优先media.apply；失败后允许读取asset.media.import和owner.background等正式基础命令，在同一授权目标内组合候选，复用有效图片，不重复已提交步骤。背景目标取pages.backgrounds，支持范围由正式背景Owner解析。Native content遵循references。applicability给出首次选路规则与当前Published不会执行的排除分支及替代，选路、预检与执行使用同一判定。路径相对profile.workspace.root。' }
}

/** Shipped contract sources, not a second hand-written API registry. */
export function generationDynamicCapabilities() {
  return {
    component: { manifest: z.toJSONSchema(componentManifestSchema, { io: 'input', reused: 'ref' }), types: componentTypes,
      registration: 'window.CoursewareComponent.define({id: manifest.id, runtimeApiVersion:4, create(ctx){...return {destroy(){...}}}})。files 包含 manifest.json 和该 manifest.entry 指定的 JS。文本文件优先直接给 {encoding:"utf8",text:"完整文件原文"}，不需要CLI编码；二进制文件用base64字符串。可见文字来自 props.content，更新通过 updateProps。先使用当前工程已有组件；新包必须提供 staticFallbackAssetId。' },
    runtime: { api2: runtimeTypes, api3: surfaceRuntimeTypes,
      registration: 'CoursewareRuntime.define({runtimeApiVersion:3,create(ctx){...return {destroy(){...}}}})。优先 API3 DOM：Slide scene-local、Flow surface-local；Spatial Runtime 当前未支持，使用 Component。API2 只用于已支持的 Slide scene/global。source 是普通 JS 字符串，运行时只能调用当前协议提供的接口。后备图片必须是工程中已存在或前序 asset.media.import 新建的图片；不能伪造 assetId。' },
    navigation: {
      goToScene: 'component/runtime 的 goToScene 只接受 Slide sceneId，不得用于 Flow 或 Spatial。',
      nextPrevious: 'Flow/Spatial 使用 nextScene/previousScene，按 scene 出现顺序并受导航守卫前进/后退。',
      replayScene: 'replayScene 同当前 location，从当前 scene 第一步重新播放，不受导航守卫限制。',
      restartCourse: 'restartCourse 绕过导航守卫，并将课程状态重置为声明默认值。',
    },
  }
}
