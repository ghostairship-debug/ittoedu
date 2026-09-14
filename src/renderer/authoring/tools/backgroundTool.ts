import { z } from 'zod'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import { backgroundModeSchema } from '../../../shared/courseProjectSchema'
import { updateCourseBackground, updateSlideBackgroundOwner } from '../../course/courseBackgroundCommands'
import { updateFlowSurfaceBackground } from '../../course/flowEditorCommands'
import { openSpatialAuthoringSession, updateSpatialSurfaceBackground } from '../../course/spatialEditorCommands'
import { resolveAuthoringToolScope } from './authoringToolScope'
import type { AuthoringToolDefinition } from './executeAuthoringTool'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { AuthoringToolDestinationV1 } from '../../../shared/authoringToolContract'
import { resolveEffectiveBackground, type EffectiveBackgroundRequest } from '../../../shared/effectiveBackground'
import { captureCourseAuthoringTarget, type CourseAuthoringSessionToken } from '../courseAuthoringSession'
import { courseAuthoringScopeFromLocation, resolveCourseLocation, type CourseAuthoringOwner } from '../courseAuthoringScope'

/** One domain for discovery, snapshot capture and execution; world content is not a background owner. */
export const backgroundSupportedScopes = ['slide:scene', 'slide:surface', 'slide:global', 'flow:surface', 'flow:global', 'spatial-2d:surface', 'spatial-2d:global'] as const
export const backgroundDiscovery = {
  supportedScopes: backgroundSupportedScopes,
  description: '修改正式背景目标的颜色、图片或继承模式。当前页使用 pages.backgrounds 中 role=page 的 update 目标；Course/共享 Surface 仅在相应授权范围中可用。省略字段保持原值；backgroundAssetId:null 移除图片。Course 和命名状态没有 backgroundMode；命名状态只覆盖给定颜色/图片，其余继承。',
  fallback: '图片优先 media.apply placement=background；失败后可读取 asset.media.import 与 owner.background 完整卡，在同一候选中导入真实图片并以 {$result:{stepId:"import",kind:"asset-id",index:0}} 更新同一背景目标。使用当前 request 的 global create 素材依赖范围；已有有效 assetId 可直接复用。失败不扩大修改范围，不直接写工程。',
}

function backgroundOwner(document: CourseProjectDocument, locationId: string, owner: CourseAuthoringOwner, stateId: string | null) {
  const { surface, location } = resolveCourseLocation(document, locationId)
  if (!(backgroundSupportedScopes as readonly string[]).includes(`${surface.type}:${owner}`)) throw new Error('当前 owner 不支持背景更新')
  if (owner !== 'scene' && stateId !== null) throw new Error('只有场景背景目标可指定命名状态')
  const scope = courseAuthoringScopeFromLocation({ project: document, locationId, owner, stateId })
  let request: EffectiveBackgroundRequest
  let itemId: string
  let fields: { backgroundMode?: 'own' | 'inherit'; backgroundColor?: string; backgroundAssetId?: string | null }
  if (owner === 'global') { request = { owner: 'course', course: document }; itemId = document.id; fields = document }
  else if (surface.type === 'slide') {
    if (owner === 'surface') { request = { owner: 'slide-surface', course: document, surface }; itemId = surface.id; fields = surface }
    else {
      const scene = location.kind === 'slide-scene' && surface.scenes.find(value => value.id === location.sceneId)
      if (!scene) throw new Error('背景目标场景不存在')
      if (stateId !== null) {
        const state = scene.presentation?.states.find(value => value.id === stateId)
        if (!state) throw new Error('背景目标呈现状态不存在')
        request = { owner: 'slide-state', course: document, surface, scene, state }; itemId = state.id; fields = state
      } else { request = { owner: 'slide-scene', course: document, surface, scene }; itemId = scene.id; fields = scene }
    }
  } else { request = { owner: surface.type === 'flow' ? 'flow-surface' : 'spatial-surface', course: document, surface }; itemId = surface.id; fields = surface }
  const address = makeAuthoringAddress({ projectId: document.id, scope: owner as 'global' | 'surface' | 'scene',
    surfaceId: owner === 'global' ? undefined : surface.id, sceneId: owner === 'scene' ? scope.sceneId! : undefined,
    carrier: 'native', layerItemId: itemId, field: 'background' })
  return { itemId, address, scope, surface, supportsMode: owner !== 'global' && stateId === null,
    fields: { backgroundColor: fields.backgroundColor, backgroundAssetId: fields.backgroundAssetId,
      ...('backgroundMode' in fields ? { backgroundMode: fields.backgroundMode } : {}) },
    effective: resolveEffectiveBackground(request) }
}

/** Capture only owners authorized by the caller's frozen reference scope. */
export function captureBackgroundTargets(input: { document: CourseProjectDocument; sessionToken: CourseAuthoringSessionToken; stateId: string | null; reference: 'page' | 'course' }) {
  const { document, sessionToken } = input
  const { surface } = resolveCourseLocation(document, sessionToken.locationId)
  const pageOwner = surface.type === 'slide' ? 'scene' : 'surface'
  const owners: { owner: CourseAuthoringOwner; stateId: string | null; role: 'page' | 'surface' | 'course' | 'scene' }[] = [
    { owner: pageOwner, stateId: input.stateId, role: 'page' },
  ]
  if (input.reference === 'course') {
    if (surface.type === 'slide') {
      if (input.stateId !== null) owners.push({ owner: 'scene', stateId: null, role: 'scene' })
      owners.push({ owner: 'surface', stateId: null, role: 'surface' })
    }
    owners.push({ owner: 'global', stateId: null, role: 'course' })
  }
  return owners.map(({ owner, stateId, role }) => {
    const resolved = backgroundOwner(document, sessionToken.locationId, owner, stateId)
    const target = captureCourseAuthoringTarget({ sessionToken, projectId: document.id, surfaceId: surface.id,
      stateId, owner, ownerKey: resolved.scope.ownerKey, itemId: resolved.itemId, authoringAddress: resolved.address })
    return { role, target, fields: resolved.fields, effective: resolved.effective, supportsMode: resolved.supportsMode }
  })
}

export function resolveBackgroundTarget(document: CourseProjectDocument, destination: AuthoringToolDestinationV1) {
  const { target } = resolveAuthoringToolScope(document, destination)
  if (destination.kind !== 'update') throw new Error('背景更新需要正式背景 update 目标')
  const resolved = backgroundOwner(document, target.locationId, target.owner, target.stateId)
  if (destination.target.itemId !== resolved.itemId || destination.target.authoringAddress !== resolved.address) throw new Error('背景目标 owner 身份不匹配')
  return { ...resolved, target: destination.target }
}

export const backgroundToolInputSchema = z.object({
  backgroundMode: backgroundModeSchema.optional(),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  backgroundAssetId: z.string().min(1).nullable().optional(),
}).strict()

export const backgroundTool: AuthoringToolDefinition<z.infer<typeof backgroundToolInputSchema>> = {
  name: 'owner.background', inputSchema: backgroundToolInputSchema, description: backgroundDiscovery.description,
  plan({ document, destination, value }) {
    const { target, surface, scope, itemId, address } = resolveBackgroundTarget(document, destination)
    let nextDocument = document
    const options = { expectedRevision: document.revision }
    if (target.owner === 'global') {
      if (value.backgroundMode !== undefined) throw new Error('课程背景没有继承模式')
      const result = updateCourseBackground(document, value, options)
      if (!result.ok) throw new Error(result.reason)
      nextDocument = result.project
    } else if (surface.type === 'slide') {
      const result = updateSlideBackgroundOwner(document, { surfaceId: surface.id,
        ...(target.owner === 'scene' ? { sceneId: scope.sceneId!, ...(target.stateId ? { stateId: target.stateId } : {}) } : {}) }, value, options)
      if (!result.ok) throw new Error(result.reason)
      nextDocument = result.project
    } else if (surface.type === 'flow') {
      const result = updateFlowSurfaceBackground(document, surface.id, value, options)
      if (!result.ok || !result.nextDocument) throw new Error(result.reason)
      nextDocument = result.nextDocument
    } else if (surface.type === 'spatial-2d') {
      const result = updateSpatialSurfaceBackground(openSpatialAuthoringSession(document, { locationId: target.locationId }), value, options)
      if (!result.ok || !result.nextSession) throw new Error(result.reason)
      nextDocument = result.nextSession.history.present
    }
    return {
      transaction: { projectId: document.id, baseRevision: document.revision, nextDocument, resourceChanges: {} },
      affected: [{ id: itemId, operation: 'updated', ownerKey: target.ownerKey, authoringAddress: address }],
    }
  },
}
