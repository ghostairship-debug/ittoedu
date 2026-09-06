import { z } from 'zod'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import { backgroundModeSchema } from '../../../shared/courseProjectSchema'
import { updateCourseBackground, updateSlideBackgroundOwner } from '../../course/courseBackgroundCommands'
import { updateFlowSurfaceBackground } from '../../course/flowEditorCommands'
import { openSpatialAuthoringSession, updateSpatialSurfaceBackground } from '../../course/spatialEditorCommands'
import { resolveAuthoringToolScope } from './authoringToolScope'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

export const backgroundToolInputSchema = z.object({
  backgroundMode: backgroundModeSchema.optional(),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  backgroundAssetId: z.string().min(1).nullable().optional(),
}).strict()

export const backgroundTool: AuthoringToolDefinition<z.infer<typeof backgroundToolInputSchema>> = {
  name: 'owner.background', inputSchema: backgroundToolInputSchema,
  plan({ document, destination, value }) {
    const { target, surface, scope } = resolveAuthoringToolScope(document, destination)
    if (destination.kind !== 'update' || target.owner === 'world') throw new Error('背景更新需要 global / surface / scene 的 update target')
    const itemId = target.owner === 'global' ? document.id : target.owner === 'surface' ? surface.id : target.stateId ?? scope.sceneId!
    const address = makeAuthoringAddress({ projectId: document.id, scope: target.owner,
      surfaceId: target.owner === 'global' ? undefined : surface.id, sceneId: target.owner === 'scene' ? scope.sceneId! : undefined,
      carrier: 'native', layerItemId: itemId, field: 'background' })
    if (destination.target.itemId !== itemId || destination.target.authoringAddress !== address) throw new Error('背景目标 owner 身份不匹配')
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
