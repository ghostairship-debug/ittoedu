import { z } from 'zod'
import { spatialCameraPoseSchema, spatialPathDocumentSchema, spatialRelationDocumentSchema } from '../../../shared/courseProjectSchema'
import { openSpatialAuthoringSession, spatialSurfaceIn } from '../../course/spatialEditorCommands'
import { addSpatialEditorCameraFrame, renameSpatialCameraFrame, updateSpatialCameraFramePose, deleteSpatialCameraFrameInSession, setSpatialCameraHome, reorderSpatialCameraFrames } from '../../course/spatialCameraCommands'
import { addSpatialPath, updateSpatialPath, deleteSpatialPath, spatialPathAuthoringAddress, spatialCameraFrameAuthoringAddress, spatialGraphAuthoringAddress } from '../../course/spatialPathCommands'
import { addSpatialRelation, updateSpatialRelation, deleteSpatialRelation, spatialRelationAuthoringAddress } from '../../course/spatialRelationCommands'
import type { AuthoringToolDefinition } from './executeAuthoringTool'
import { insertionIndex, resolveAuthoringToolScope } from './authoringToolScope'

const path = spatialPathDocumentSchema.omit({ id: true })
const relation = spatialRelationDocumentSchema.omit({ id: true })
const name = z.string().trim().min(1).max(200)
export const spatialStructureToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('add-camera'), pose: spatialCameraPoseSchema, name: name.optional() }).strict(),
  z.object({ operation: z.literal('update-camera'), pose: spatialCameraPoseSchema.optional(), name: name.optional() }).strict(),
  z.object({ operation: z.literal('delete-camera') }).strict(),
  z.object({ operation: z.literal('set-home'), pose: spatialCameraPoseSchema }).strict(),
  z.object({ operation: z.literal('add-path'), path }).strict(),
  z.object({ operation: z.literal('update-path'), path: path.partial() }).strict(),
  z.object({ operation: z.literal('delete-path') }).strict(),
  z.object({ operation: z.literal('add-relation'), relation }).strict(),
  z.object({ operation: z.literal('update-relation'), relation: relation.partial() }).strict(),
  z.object({ operation: z.literal('delete-relation') }).strict(),
])

export const spatialStructureTool: AuthoringToolDefinition<z.infer<typeof spatialStructureToolInputSchema>> = {
  name: 'spatial.structure', inputSchema: spatialStructureToolInputSchema,
  plan({ document, destination, value }) {
    const { target, surface } = resolveAuthoringToolScope(document, destination)
    if (surface.type !== 'spatial-2d' || target.owner !== 'world') throw new Error('Spatial 结构工具需要 world owner')
    const session = openSpatialAuthoringSession(document, { locationId: target.locationId })
    let history = session.history
    let locationId = target.locationId
    let entityId = destination.kind === 'update' ? destination.target.itemId : ''
    const creating = value.operation.startsWith('add-')
    const kind = value.operation.endsWith('path') ? 'path' : value.operation.endsWith('relation') ? 'relation' : 'camera'
    const addressFor = (id: string) => value.operation === 'set-home'
      ? spatialGraphAuthoringAddress({ projectId: document.id, surfaceId: surface.id, entityId: id, field: 'camera.home' })
      : kind === 'path' ? spatialPathAuthoringAddress(document.id, surface.id, id)
      : kind === 'relation' ? spatialRelationAuthoringAddress(document.id, surface.id, id)
      : spatialCameraFrameAuthoringAddress(document.id, surface.id, id)
    if (creating) {
      if (destination.kind !== 'create' || destination.scope.parent.kind !== (kind === 'camera' ? 'course-locations' : 'owner')) throw new Error('Spatial 创建父 scope 不匹配')
      if (kind !== 'camera' && destination.scope.insertion.kind !== 'append') throw new Error('路径和关系仅追加，路径点顺序通过内容工具设置')
    } else {
      if (destination.kind !== 'update' || destination.target.authoringAddress !== addressFor(entityId)) throw new Error('Spatial 结构 authoringAddress 不匹配')
      const exists = value.operation === 'set-home' ? entityId === surface.id
        : kind === 'path' ? surface.world.paths?.some((entry) => entry.id === entityId)
        : kind === 'relation' ? surface.world.relations?.some((entry) => entry.id === entityId)
        : surface.camera.frames.some((entry) => entry.id === entityId)
      if (!exists) throw new Error('Spatial 结构目标已失效')
    }
    switch (value.operation) {
      case 'add-camera': history = addSpatialEditorCameraFrame(history, surface.id, value.pose, { name: value.name }); break
      case 'update-camera':
        if (value.name !== undefined) history = renameSpatialCameraFrame(history, surface.id, entityId, value.name)
        if (value.pose !== undefined) history = updateSpatialCameraFramePose(history, surface.id, entityId, value.pose)
        break
      case 'delete-camera': {
        const result = deleteSpatialCameraFrameInSession(session, entityId)
        if (!result.ok || !result.nextSession) throw new Error(result.reason)
        history = result.nextSession.history
        locationId = result.nextSession.selection.locationId
        break
      }
      case 'set-home': history = setSpatialCameraHome(history, surface.id, value.pose); break
      case 'add-path': history = addSpatialPath(history, { surfaceId: surface.id, ...value.path }); break
      case 'update-path': history = updateSpatialPath(history, surface.id, entityId, value.path); break
      case 'delete-path': history = deleteSpatialPath(history, surface.id, entityId); break
      case 'add-relation': history = addSpatialRelation(history, { surfaceId: surface.id, ...value.relation }); break
      case 'update-relation': history = updateSpatialRelation(history, surface.id, entityId, value.relation); break
      case 'delete-relation': history = deleteSpatialRelation(history, surface.id, entityId); break
    }
    if (creating) {
      const nextSurface = spatialSurfaceIn(history.present, surface.id)
      const old = kind === 'path' ? surface.world.paths : kind === 'relation' ? surface.world.relations : surface.camera.frames
      const next = kind === 'path' ? nextSurface.world.paths : kind === 'relation' ? nextSurface.world.relations : nextSurface.camera.frames
      entityId = next?.find((entry) => !old?.some((previous) => previous.id === entry.id))?.id ?? ''
      if (!entityId) throw new Error('Spatial 命令未返回创建身份')
      if (kind === 'camera') {
        locationId = history.present.locations.find((entry) => entry.kind === 'spatial-camera' && entry.surfaceId === surface.id && entry.cameraFrameId === entityId)!.id
        if (destination.kind === 'create' && destination.scope.insertion.kind !== 'append') {
          const ids = surface.camera.frames.map((entry) => entry.id)
          history = reorderSpatialCameraFrames(history, surface.id, entityId, insertionIndex(ids, destination.scope.insertion))
        }
      }
    }
    const operation = creating ? 'created' : value.operation.startsWith('delete-') ? 'deleted' : 'updated'
    return {
      transaction: { projectId: document.id, baseRevision: document.revision,
        nextDocument: history.present === session.history.present ? document : { ...history.present, revision: document.revision + 1 }, resourceChanges: {},
        selectionHint: { kind: 'authoring-tool-selection', locationId, stateId: null, owner: 'world', itemIds: [],
          graphSelection: kind !== 'camera' && operation !== 'deleted' ? { kind, id: entityId } : null } },
      affected: [{ id: entityId, operation, ownerKey: target.ownerKey, authoringAddress: addressFor(entityId) }],
    }
  },
}
