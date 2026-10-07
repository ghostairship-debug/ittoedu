import { z } from 'zod'
import { documentTextContentSchema } from '../../document/content'
import { courseStateDeclarationSchema, courseStateConditionSchema } from '../course-state/schema'
import { courseProjectDesignTokensSchema, courseThemeSchema } from '../design-v1/schema'
import { projectPlaybackSettingsSchema } from '../playback-v1/schema'
import { assetRemoteDeliveryUrlSchema, assetSourceSchema, projectMediaSettingsSchema } from '../media-v1/schema'
import type { ComponentImplementation, CourseProjectV10, JsonValue } from './project'
import type { ComponentOperationBatch } from './operations'
import type { ComponentAuthorRecord } from './runtime'

const id = z.string().min(1)
const finite = z.number().finite()
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), finite, z.string(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema),
]))
const authorBindingStepSchema = z.object({ tag: z.string().min(1), index: z.number().int().nonnegative(),
  attributes: z.record(z.string(), z.string()).optional() }).strict()
export const componentAuthorRecordSchema = z.object({ kind: z.enum(['text', 'image']),
  scope: z.record(z.string(), z.string()).optional(),
  binding: z.object({ kind: z.literal('dom'), path: z.array(authorBindingStepSchema), textIndex: z.number().int().nonnegative().optional(),
    baseline: z.string(), context: z.array(z.object({ path: z.array(authorBindingStepSchema), value: z.string() }).strict()).optional() }).strict(),
  overrides: z.object({ text: z.string().optional(), src: z.string().optional(), style: z.record(z.string(), z.string()).optional(),
    geometry: z.object({ translateX: z.number().finite().optional(), translateY: z.number().finite().optional(),
      scaleX: z.number().finite().positive().optional(), scaleY: z.number().finite().positive().optional(),
      width: z.number().finite().positive().optional(), height: z.number().finite().positive().optional(),
      rotation: z.number().finite().optional() }).strict().optional() }).strict(),
}).strict() satisfies z.ZodType<ComponentAuthorRecord>
export const componentAuthorRecordsSchema = z.record(z.string().min(1), componentAuthorRecordSchema)

export const componentFrameSchema = z.object({
  width: finite.positive(), height: finite.positive(),
  transform: z.tuple([finite, finite, finite, finite, finite, finite]),
}).strict()
export const componentAuthorGeometryObservationSchema = z.object({ frame: componentFrameSchema,
  parentToInstance: componentFrameSchema.shape.transform,
  author: componentAuthorRecordSchema.shape.overrides.shape.geometry.unwrap(),
  boxInsets: z.object({ width: finite.nonnegative(), height: finite.nonnegative() }).strict(),
}).strict()
export const componentBuiltinImplementationSchema = z.object({ kind: z.literal('builtin'), key: id }).strict()
export const componentSourceImplementationSchema = z.object({ kind: z.literal('source'), source: z.string().optional(), language: z.enum(['javascript', 'typescript']), dependencies: z.array(id).optional(),
    workspace: z.object({ ownerId: id, entry: id }).strict().optional(), moduleBindings: z.record(id, id).optional(),
    resourceBindings: z.record(z.string(), id).optional() }).strict().refine(value => (value.source !== undefined) !== (value.workspace !== undefined),
      '组件源码必须来自单文件 source 或正式 workspace 之一')
export const componentImplementationSchema: z.ZodType<ComponentImplementation> = z.discriminatedUnion('kind', [
  componentBuiltinImplementationSchema, componentSourceImplementationSchema,
]) as z.ZodType<ComponentImplementation>
export const componentTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('instance'), instanceId: id }).strict(),
  z.object({ kind: z.literal('surface'), surfaceId: id }).strict(),
  z.object({ kind: z.literal('project') }).strict(),
])
export const behaviorAttachmentSchema = z.object({ instanceId: id, target: componentTargetSchema }).strict()
export const componentBackgroundSchema = z.object({
  mode: z.enum(['inherit', 'own']).optional(), color: z.string().optional(), assetId: id.nullable().optional(),
  fit: z.enum(['cover', 'contain', 'fill']).optional(),
}).strict()
export const componentFlowBodyLayoutSchema = z.object({ width: z.enum(['content-width', 'wide', 'full-width']), wrap: z.enum(['none', 'left', 'right']).optional(), caption: documentTextContentSchema.optional() }).strict()
export const componentFlowPlacementSchema = z.object({
  space: z.enum(['paper', 'viewport']), plane: z.enum(['overlay', 'underlay']),
  paragraphAnchor: z.object({ blockId: id, offsetY: finite, xRatio: finite }).strict().optional(),
}).strict()
export const componentFlowAuthoringSchema = z.object({ layout: z.object({
  widthMode: z.enum(['fluid', 'reading']).optional(), readingWidth: finite.positive(), wideContentWidth: finite.positive(), paperBackgroundColor: z.string().optional(),
}).strict() }).strict()
export const componentPresentationSchema = z.object({
  states: z.array(z.object({ id, title: z.string(), overrides: z.record(z.string(), z.object({
    data: jsonValueSchema.optional(), style: z.record(z.string(), jsonValueSchema).optional(),
    frame: componentFrameSchema.nullable().optional(), visible: z.boolean().optional(),
  }).strict()), order: z.array(id).optional(), background: componentBackgroundSchema.optional() }).strict()),
  initialStateId: id.nullable().optional(), thumbnailStateId: id.nullable().optional(),
}).strict().superRefine((presentation, context) => {
  const ids = new Set(presentation.states.map(state => state.id))
  if (ids.size !== presentation.states.length) context.addIssue({ code: 'custom', message: '展示状态身份重复' })
  for (const selected of [presentation.initialStateId, presentation.thumbnailStateId]) if (selected && !ids.has(selected)) context.addIssue({ code: 'custom', message: '展示状态引用已不存在' })
})
export const courseProjectLogicSchema = z.object({
  courseState: z.array(courseStateDeclarationSchema),
  navigationGuards: z.array(z.object({ id, effect: z.literal('block'), fromSurfaceIds: z.array(id).optional(), toSurfaceIds: z.array(id),
    match: z.enum(['all', 'any']), conditions: z.array(courseStateConditionSchema), message: z.string(),
  }).strict()),
  network: z.object({ connectOrigins: z.array(z.string()).optional() }).strict().optional(),
}).strict()
export const componentVisibilitySchema = z.object({ mode: z.enum(['all', 'include', 'exclude']), surfaceIds: z.array(id) }).strict()
export const componentInstanceSchema = z.object({
  id, definitionId: id, data: jsonValueSchema,
  name: z.string().optional(), visible: z.boolean().optional(), locked: z.boolean().optional(),
  visibility: componentVisibilitySchema.optional(),
  playbackInitialVisibility: z.enum(['inherit', 'hidden']).optional(), flowPlacement: componentFlowPlacementSchema.optional(), flowLayout: componentFlowBodyLayoutSchema.optional(),
  style: z.record(z.string(), jsonValueSchema).optional(), frame: componentFrameSchema.optional(),
  childIds: z.array(id).optional(), attachments: z.array(behaviorAttachmentSchema).optional(),
  implementationOverride: componentImplementationSchema.optional(),
}).strict()
export const componentDefinitionSchema = z.object({
  id, role: z.enum(['content', 'behavior', 'mixed']), implementation: componentImplementationSchema,
  dataSchema: z.record(z.string(), jsonValueSchema).optional(), version: z.string().optional(), title: z.string().optional(),
  professionalBuiltinKey: id.optional(),
}).strict()
export const componentAssetSchema = z.object({ id, path: id, mimeType: z.string().optional(), filename: z.string().optional(),
  kind: z.enum(['image', 'audio', 'video', 'font']).optional(), byteLength: finite.nonnegative().optional(),
  width: finite.positive().optional(), height: finite.positive().optional(), duration: finite.nonnegative().optional(),
  remote: z.object({ url: assetRemoteDeliveryUrlSchema }).strict().optional(), source: assetSourceSchema.optional(),
}).strict()
export const componentContainerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('instance'), instanceId: id }).strict(),
  z.object({ kind: z.literal('surface'), surfaceId: id }).strict(),
  z.object({ kind: z.literal('global'), plane: z.enum(['underlay', 'overlay']) }).strict(),
])
export const componentSpatialPoseSchema = z.object({ x: finite, y: finite, zoom: finite.positive(), rotation: finite.optional() }).strict()
export const componentSpatialAuthoringSchema = z.object({
  home: componentSpatialPoseSchema,
  frames: z.array(z.object({ id, title: z.string().optional(), pose: componentSpatialPoseSchema, targetInstanceId: id.optional() }).strict()),
  paths: z.array(z.object({ id, title: z.string().optional(), frameIds: z.array(id), instanceIds: z.array(id).optional(),
    style: z.object({ color: z.string().optional(), width: finite.positive().optional(), dash: z.enum(['solid', 'dashed', 'dotted']).optional() }).strict().optional(),
  }).strict()).optional(),
  relations: z.array(z.object({ id, sourceInstanceId: id, targetInstanceId: id, label: z.string().optional(), kind: z.enum(['line', 'arrow', 'bidirectional']) }).strict()).optional(),
  semanticZoom: z.array(z.object({ id, instanceIds: z.array(id), minZoom: finite.nonnegative(), maxZoom: finite.positive(), visible: z.boolean() }).strict()).optional(),
}).strict().superRefine((spatial, context) => {
  const frames = new Set(spatial.frames.map(frame => frame.id))
  if (frames.size !== spatial.frames.length) context.addIssue({ code: 'custom', message: '镜头身份重复' })
  if (new Set((spatial.paths ?? []).map(path => path.id)).size !== spatial.paths?.length && spatial.paths) context.addIssue({ code: 'custom', message: '镜头路径身份重复' })
  for (const path of spatial.paths ?? []) if (path.frameIds.some(frameId => !frames.has(frameId))) context.addIssue({ code: 'custom', message: '镜头路径引用已不存在的镜头' })
})
export const componentSurfaceSchema = z.object({
  id, kind: z.enum(['slide', 'flow', 'spatial']), title: z.string(), childIds: z.array(id),
  designSize: z.object({ width: finite.positive(), height: finite.positive() }).strict().optional(),
  spatial: componentSpatialAuthoringSchema.optional(), background: componentBackgroundSchema.optional(),
  flow: componentFlowAuthoringSchema.optional(), presentation: componentPresentationSchema.optional(),
}).strict().superRefine((surface, context) => {
  if (surface.flow && surface.kind !== 'flow') context.addIssue({ code: 'custom', message: '只有Flow表面可保存纸张布局' })
  if (surface.presentation && surface.kind !== 'slide') context.addIssue({ code: 'custom', message: '只有Slide表面可保存展示状态' })
  if (surface.spatial && surface.kind !== 'spatial') context.addIssue({ code: 'custom', message: '只有Spatial表面可保存镜头配置' })
})

export const courseProjectV10Schema: z.ZodType<CourseProjectV10> = z.object({
  schemaVersion: z.literal(10), id, revision: z.number().int().nonnegative(), title: z.string(),
  background: componentBackgroundSchema.optional(), designTokens: courseProjectDesignTokensSchema.optional(), theme: courseThemeSchema.optional(),
  playback: projectPlaybackSettingsSchema.optional(), media: projectMediaSettingsSchema.optional(), logic: courseProjectLogicSchema.optional(),
  definitions: z.record(z.string(), componentDefinitionSchema),
  instances: z.record(z.string(), componentInstanceSchema),
  surfaces: z.array(componentSurfaceSchema),
  global: z.object({ underlay: z.array(id), overlay: z.array(id) }).strict(),
  assets: z.record(z.string(), componentAssetSchema),
}).strict().superRefine((project, context) => {
  const issue = (message: string, path: (string | number)[] = []) => context.addIssue({ code: 'custom', message, path })
  for (const [key, definition] of Object.entries(project.definitions)) if (key !== definition.id) issue('定义索引与身份不一致', ['definitions', key])
  for (const [key, asset] of Object.entries(project.assets)) if (key !== asset.id) issue('素材索引与身份不一致', ['assets', key])
  const surfaceIds = new Set<string>()
  for (const surface of project.surfaces) {
    if (surfaceIds.has(surface.id)) issue('表面身份重复', ['surfaces'])
    surfaceIds.add(surface.id)
  }
  const owners = new Set<string>()
  const claim = (children: string[]) => {
    for (const childId of children) {
      if (!Object.hasOwn(project.instances, childId)) issue(`所属对象不存在：${childId}`)
      if (owners.has(childId)) issue(`对象重复归属：${childId}`)
      owners.add(childId)
    }
  }
  claim(project.global.underlay); claim(project.global.overlay)
  for (const surface of project.surfaces) claim(surface.childIds)
  for (const [key, instance] of Object.entries(project.instances)) {
    if (key !== instance.id) issue('实例索引与身份不一致', ['instances', key])
    if (!Object.hasOwn(project.definitions, instance.definitionId)) issue(`定义不存在：${instance.definitionId}`, ['instances', key])
    if (instance.childIds) claim(instance.childIds)
    for (const attachment of instance.attachments ?? []) {
      if (!Object.hasOwn(project.instances, attachment.instanceId)) issue(`行为实例不存在：${attachment.instanceId}`)
      if (attachment.target.kind === 'instance' && !Object.hasOwn(project.instances, attachment.target.instanceId)) issue('行为目标不存在')
      if (attachment.target.kind === 'surface' && !surfaceIds.has(attachment.target.surfaceId)) issue('行为表面不存在')
    }
  }
  const visited = new Set<string>()
  const visit = (instanceId: string) => {
    if (visited.has(instanceId)) return
    visited.add(instanceId)
    for (const childId of project.instances[instanceId]?.childIds ?? []) visit(childId)
  }
  for (const rootId of [...project.global.underlay, ...project.global.overlay, ...project.surfaces.flatMap(surface => surface.childIds)]) visit(rootId)
  for (const instanceId of Object.keys(project.instances)) if (!visited.has(instanceId)) issue(`对象未归属或形成循环：${instanceId}`)
})

const fieldPath = z.array(id).min(1).refine(path => path.every(part => !['__proto__', 'prototype', 'constructor'].includes(part)), '字段路径无效')
const dataPath = z.array(id).refine(path => path.every(part => !['__proto__', 'prototype', 'constructor'].includes(part)), '字段路径无效')
export const componentExpectationSchema = z.object({ path: fieldPath, exists: z.boolean(), value: jsonValueSchema.optional() }).strict()
export const componentOperationBatchSchema: z.ZodType<ComponentOperationBatch> = z.object({
  type: z.literal('component-platform.apply'),
  edits: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('project.title.set'), title: z.string() }).strict(),
    z.object({ type: z.literal('project.background.set'), background: componentBackgroundSchema.nullable() }).strict(),
    z.object({ type: z.literal('project.designTokens.set'), designTokens: courseProjectDesignTokensSchema.nullable() }).strict(),
    z.object({ type: z.literal('project.theme.set'), theme: courseThemeSchema.nullable() }).strict(),
    z.object({ type: z.literal('project.playback.set'), playback: projectPlaybackSettingsSchema.nullable() }).strict(),
    z.object({ type: z.literal('project.media.set'), media: projectMediaSettingsSchema.nullable() }).strict(),
    z.object({ type: z.literal('project.logic.set'), logic: courseProjectLogicSchema.nullable() }).strict(),
    z.object({ type: z.literal('surface.insert'), surface: componentSurfaceSchema, index: z.number().int().nonnegative() }).strict(),
    z.object({ type: z.literal('surface.title.set'), surfaceId: id, title: z.string() }).strict(),
    z.object({ type: z.literal('surface.designSize.set'), surfaceId: id, designSize: z.object({ width: finite.positive(), height: finite.positive() }).strict().nullable() }).strict(),
    z.object({ type: z.literal('surface.remove'), surfaceId: id }).strict(),
    z.object({ type: z.literal('surface.move'), surfaceId: id, index: z.number().int().nonnegative() }).strict(),
    z.object({ type: z.literal('surface.background.set'), surfaceId: id, background: componentBackgroundSchema.nullable() }).strict(),
    z.object({ type: z.literal('surface.presentation.set'), surfaceId: id, presentation: componentPresentationSchema.nullable() }).strict(),
    z.object({ type: z.literal('flow.set'), surfaceId: id, flow: componentFlowAuthoringSchema }).strict(),
    z.object({ type: z.literal('spatial.set'), surfaceId: id, spatial: componentSpatialAuthoringSchema }).strict(),
    z.object({ type: z.literal('definition.set'), definition: componentDefinitionSchema }).strict(),
    z.object({ type: z.literal('definition.remove'), definitionId: id }).strict(),
    z.object({ type: z.literal('asset.remove'), assetId: id }).strict(),
    z.object({ type: z.literal('asset.add'), asset: componentAssetSchema,
      bytes: z.custom<Uint8Array>(value => ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]', '素材需要Uint8Array字节')
        .transform(value => Uint8Array.from(value)),
    }).strict(),
    z.object({ type: z.literal('asset.replace'), asset: componentAssetSchema,
      bytes: z.custom<Uint8Array>(value => ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]', '素材需要Uint8Array字节')
        .transform(value => Uint8Array.from(value)),
      expectedBytes: z.custom<Uint8Array>(value => ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]', '替换需要原素材字节')
        .transform(value => Uint8Array.from(value)),
    }).strict(),
    z.object({ type: z.literal('component.files.set'), ownerId: id,
      files: z.record(id, z.custom<Uint8Array>(value => ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]')).nullable(),
      expectedFiles: z.record(id, z.custom<Uint8Array>(value => ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]')).nullable(),
    }).strict(),
    z.object({ type: z.literal('data.set'), instanceId: id, path: dataPath, value: jsonValueSchema }).strict(),
    z.object({ type: z.literal('style.set'), instanceId: id, path: dataPath, value: jsonValueSchema }).strict(),
    z.object({ type: z.literal('frame.set'), instanceId: id, frame: componentFrameSchema.nullable() }).strict(),
    z.object({ type: z.literal('instance.patch'), instanceId: id, patch: z.object({ name: z.string().nullable().optional(), visible: z.boolean().optional(), locked: z.boolean().optional(), playbackInitialVisibility: z.enum(['inherit', 'hidden']).optional(), visibility: componentVisibilitySchema.nullable().optional() }).strict() }).strict(),
    z.object({ type: z.literal('instance.definition.set'), instanceId: id, definitionId: id }).strict(),
    z.object({ type: z.literal('instance.flowLayout.set'), instanceId: id, flowLayout: componentFlowBodyLayoutSchema.nullable() }).strict(),
    z.object({ type: z.literal('instance.flowPlacement.set'), instanceId: id, flowPlacement: componentFlowPlacementSchema.nullable() }).strict(),
    z.object({ type: z.literal('instance.insert'), container: componentContainerSchema, index: z.number().int().nonnegative(), instances: z.array(componentInstanceSchema), rootIds: z.array(id) }).strict(),
    z.object({ type: z.literal('instance.remove'), instanceId: id }).strict(),
    z.object({ type: z.literal('instance.move'), instanceId: id, container: componentContainerSchema, index: z.number().int().nonnegative(), frame: componentFrameSchema.optional() }).strict(),
    z.object({ type: z.literal('implementation.set'), instanceId: id, implementation: componentImplementationSchema.nullable() }).strict(),
    z.object({ type: z.literal('attachments.set'), instanceId: id, attachments: z.array(behaviorAttachmentSchema) }).strict(),
  ])), expected: z.array(componentExpectationSchema),
}).strict()
