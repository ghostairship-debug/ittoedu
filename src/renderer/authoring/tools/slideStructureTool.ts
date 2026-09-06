import { z } from 'zod'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import {
  openSlideAuthoringSession, addSlideScene, renameSlideScene, duplicateSlideScene, deleteSlideScene, reorderSlideScenes,
  addSlidePresentationState, renameSlidePresentationState, duplicateSlidePresentationState, deleteSlidePresentationState, reorderSlidePresentationStates,
  type SlideCommandResult,
} from '../../course/slideAuthoringBackend'
import type { AuthoringToolDefinition } from './executeAuthoringTool'
import { resolveAuthoringToolScope, insertionIndex } from './authoringToolScope'

const name = z.string().trim().min(1).max(120)
const ids = z.array(z.string().min(1)).min(1)
export const slideStructureToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('add-page'), name: name.optional() }).strict(),
  z.object({ operation: z.literal('rename-page'), name }).strict(),
  z.object({ operation: z.literal('duplicate-page') }).strict(),
  z.object({ operation: z.literal('delete-page') }).strict(),
  z.object({ operation: z.literal('reorder-pages'), ids }).strict(),
  z.object({ operation: z.literal('add-state'), name: name.optional() }).strict(),
  z.object({ operation: z.literal('rename-state'), name }).strict(),
  z.object({ operation: z.literal('duplicate-state') }).strict(),
  z.object({ operation: z.literal('delete-state') }).strict(),
  z.object({ operation: z.literal('reorder-states'), ids }).strict(),
])

export function slideStructureAddress(projectId: string, surfaceId: string, sceneId: string, stateId: string | null) {
  return makeAuthoringAddress({ projectId, scope: 'scene', surfaceId, sceneId, carrier: 'native',
    layerItemId: stateId ?? sceneId, field: stateId === null ? 'scene' : 'presentation.state' })
}

export const slideStructureTool: AuthoringToolDefinition<z.infer<typeof slideStructureToolInputSchema>> = {
  name: 'slide.structure', inputSchema: slideStructureToolInputSchema,
  plan({ document, destination, value }) {
    const { target, surface, location } = resolveAuthoringToolScope(document, destination)
    if (surface.type !== 'slide' || location.kind !== 'slide-scene' || target.owner !== 'scene') throw new Error('页面与状态工具需要 Slide scene owner')
    const scene = surface.scenes.find((entry) => entry.id === location.sceneId)!
    const isState = value.operation.endsWith('state') || value.operation === 'reorder-states'
    const creating = value.operation === 'add-page' || value.operation === 'add-state'
    const targetId = isState ? target.stateId ?? scene.id : scene.id
    if (creating) {
      if (destination.kind !== 'create' || destination.scope.parent.kind !== (isState ? 'owner' : 'course-locations')) throw new Error('创建页面或状态的父 scope 不匹配')
    } else {
      if (destination.kind !== 'update' || destination.target.itemId !== targetId ||
        destination.target.authoringAddress !== slideStructureAddress(document.id, surface.id, scene.id, isState ? target.stateId : null)) throw new Error('页面或状态 target 身份不匹配')
    }
    const opened = openSlideAuthoringSession(document, { locationId: target.locationId })
    const session = { ...opened, selection: { ...opened.selection, stateId: target.stateId } }
    const options = { expectedRevision: document.revision }
    let result: SlideCommandResult
    switch (value.operation) {
      case 'add-page': result = addSlideScene(session, { ...options, name: value.name }); break
      case 'rename-page': result = renameSlideScene(session, scene.id, value.name, options); break
      case 'duplicate-page': result = duplicateSlideScene(session, scene.id, options); break
      case 'delete-page': result = deleteSlideScene(session, scene.id, options); break
      case 'reorder-pages': result = reorderSlideScenes(session, value.ids, options); break
      case 'add-state': result = addSlidePresentationState(session, value.name, options); break
      case 'rename-state': result = renameSlidePresentationState(session, targetId, value.name, options); break
      case 'duplicate-state': result = duplicateSlidePresentationState(session, targetId, options); break
      case 'delete-state': result = deleteSlidePresentationState(session, targetId, options); break
      case 'reorder-states': result = reorderSlidePresentationStates(session, value.ids, options); break
    }
    if (!result.ok || !result.nextSession) throw new Error(result.reason ?? 'Slide 结构命令失败')
    let nextSession = result.nextSession
    let nextDocument = nextSession.history.present
    const nextLocation = nextDocument.locations.find((entry) => entry.id === nextSession.selection.locationId)
    if (nextLocation?.kind !== 'slide-scene') throw new Error('删除最后一个 Slide 页需要课程导航工具切换表面')
    const operation = creating || value.operation.startsWith('duplicate-') ? 'created' : value.operation.startsWith('delete-') ? 'deleted' : 'updated'
    const affectedId = operation === 'created' ? (isState ? nextSession.selection.stateId! : nextLocation.sceneId) : targetId
    if (creating && destination.kind === 'create' && destination.scope.insertion.kind !== 'append') {
      const oldIds = isState ? scene.presentation?.states.map((entry) => entry.id) ?? [] : surface.scenes.map((entry) => entry.id)
      oldIds.splice(insertionIndex(oldIds, destination.scope.insertion), 0, affectedId)
      const reordered = isState ? reorderSlidePresentationStates(nextSession, oldIds) : reorderSlideScenes(nextSession, oldIds)
      if (!reordered.ok || !reordered.nextSession) throw new Error(reordered.reason)
      nextSession = reordered.nextSession
      nextDocument = { ...nextSession.history.present, revision: document.revision + 1 }
    }
    return {
      transaction: { projectId: document.id, baseRevision: document.revision, nextDocument, resourceChanges: {},
        selectionHint: { kind: 'authoring-tool-selection', locationId: nextSession.selection.locationId,
          stateId: nextSession.selection.stateId, owner: 'scene', itemIds: [] } },
      affected: [{ id: affectedId, operation, ownerKey: `scene:${operation === 'created' && !isState ? nextLocation.sceneId : scene.id}`,
        authoringAddress: slideStructureAddress(document.id, surface.id, operation === 'created' && !isState ? nextLocation.sceneId : scene.id, isState ? affectedId : null) }],
    }
  },
}
