import { z } from 'zod'
import { componentManifestSchema } from '../../../shared/componentSchema'
import componentTypes from '../../../shared/contracts/component-v4/types.ts?raw'
import runtimeTypes from '../../../shared/contracts/runtime/types.ts?raw'
import surfaceRuntimeTypes from '../../../shared/contracts/runtime/surface.ts?raw'
import generatedCapabilities from '../../../shared/generated/courseAgentCapabilities.json'
import { readCourseAgentCapability, type CourseAgentCapabilityData } from '../../../shared/courseAgentCapabilities'

export const generationCapabilityData = generatedCapabilities as CourseAgentCapabilityData

/** Relevant full schema branches are cheap enough to use without a discovery round trip. */
export function generationCapabilityContext(pages: readonly unknown[], purpose: string) {
  const desired = new Map<string, { id: string; operation?: string; nativeType?: string }>()
  const add = (id: string, operation?: string, nativeType?: string) => desired.set(`${id}:${operation ?? ''}:${nativeType ?? ''}`, { id, operation, nativeType })
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const node = value as Record<string, any>
    if (node.kind === 'native' && node.content?.nativeType) {
      if (node.content.nativeType === 'text') add('native.content', 'edit')
      else if (node.content.nativeType === 'image') {
        add('asset.image.transform')
        add('native.content', 'properties')
        add('native.content', 'content', 'image')
      } else {
        add('native.content', 'properties')
        add('native.content', 'content', node.content.nativeType)
      }
    }
    if (node.kind === 'component' || node.type === 'component') add('component.configure')
    if (node.type === 'media' && node.mediaKind === 'image') add('asset.image.transform')
    if (node.kind === 'runtime') { add('runtime.configure'); add('runtime.source') }
    if (node.surfaceType === 'flow') add('flow.content')
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
  const cards: ReturnType<typeof readCourseAgentCapability>[] = []
  const deferred: { id: string; operation?: string; nativeType?: string; path: string }[] = []
  for (const { id, ...options } of desired.values()) {
    const selection = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
    const complete = readCourseAgentCapability(generationCapabilityData, id, selection)
    // Search vocabulary is useful in discovery, but adds no tool input semantics.
    const { keywords: _keywords, variants: _variants, ...entry } = complete.entry
    const card = { ...complete, entry }
    if ('content' in card) {
      if (card.content?.description === entry.summary) delete card.content.description
      // The selected strict schema and entry.scopes already express these facts.
      // Keep invocation, examples, recovery and the complete reference closure.
      if (Array.isArray(card.content.variants) && card.content.variants.every((variant: { scopes: string[]; target?: string }) =>
        !variant.target && JSON.stringify(variant.scopes) === JSON.stringify(entry.scopes))) delete card.content.variants
      if (JSON.stringify(card.content.supportedScopes) === JSON.stringify(entry.scopes)) delete card.content.supportedScopes
    }
    if (new TextEncoder().encode(JSON.stringify([...cards, card])).byteLength <= 5_200) cards.push(card)
    else deferred.push({ id, ...options, path: `capabilities/${card.entry.path}` })
  }
  return { version: 1, semanticVersion: generationCapabilityData.semanticVersion, discovery: 'capabilities/discovery.json',
    query: 'capabilities/query.mjs', toolIds: generationCapabilityData.entries.filter(entry => entry.kind === 'tool' && entry.available !== false).map(entry => entry.id), cards, deferred,
    instruction: 'cards只是预展开子集，不是能力白名单。完整工具ID见toolIds；缺卡先查询discovery/query，不能直接判断不支持。适用Surface及完整输入Schema以卡为准；Native content遵循references，参数修改无需读源码。路径相对profile.workspace.root。' }
}

/** Shipped contract sources, not a second hand-written API registry. */
export function generationDynamicCapabilities() {
  return {
    component: { manifest: z.toJSONSchema(componentManifestSchema, { io: 'input', reused: 'ref' }), types: componentTypes,
      registration: 'window.CoursewareComponent.define({id: manifest.id, runtimeApiVersion:4, create(ctx){...return {destroy(){...}}}})。files 包含 manifest.json 和该 manifest.entry 指定的 JS。文本文件优先直接给 {encoding:"utf8",text:"完整文件原文"}，不需要CLI编码；二进制文件用base64字符串。可见文字来自 props.content，更新通过 updateProps。先使用当前工程已有组件；新包必须提供 staticFallbackAssetId。' },
    runtime: { api2: runtimeTypes, api3: surfaceRuntimeTypes,
      registration: 'CoursewareRuntime.define({runtimeApiVersion:3,create(ctx){...return {destroy(){...}}}})。优先 API3 DOM：Slide scene-local、Flow surface-local；Spatial Runtime 当前未支持，使用 Component。API2 只用于已支持的 Slide scene/global。source 是普通 JS 字符串，运行时只能调用当前协议提供的接口。后备图片必须是工程中已存在或前序 asset.media.import 新建的图片；不能伪造 assetId。' },
  }
}
