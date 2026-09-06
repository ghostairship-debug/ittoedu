import { nanoid } from 'nanoid'
import { z } from 'zod'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import { courseStateDeclarationSchema, courseNavigationGuardSchema, courseNetworkDeclarationSchema, coursePlaybackSchema } from '../../../shared/courseProjectSchema'
import { executeCourseLogicAuthoringCommand, replaceCourseNetworkDeclaration, type CourseLogicAuthoringCommand } from '../../course/courseLogicAuthoringCommands'
import { updateCoursePlaybackSettings } from '../../course/globalLayerCommands'
import { resolveAuthoringToolScope } from './authoringToolScope'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

export const courseSettingsToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('add-state'), declaration: courseStateDeclarationSchema }).strict(),
  z.object({ operation: z.literal('update-state'), declaration: courseStateDeclarationSchema }).strict(),
  z.object({ operation: z.literal('delete-state') }).strict(),
  z.object({ operation: z.literal('add-guard'), guard: courseNavigationGuardSchema.omit({ id: true }) }).strict(),
  z.object({ operation: z.literal('update-guard'), guard: courseNavigationGuardSchema.omit({ id: true }) }).strict(),
  z.object({ operation: z.literal('delete-guard') }).strict(),
  z.object({ operation: z.literal('network'), network: courseNetworkDeclarationSchema }).strict(),
  z.object({ operation: z.literal('playback'), playback: coursePlaybackSchema }).strict(),
])

export const courseSettingsTool: AuthoringToolDefinition<z.infer<typeof courseSettingsToolInputSchema>> = {
  name: 'course.settings', inputSchema: courseSettingsToolInputSchema,
  plan({ document, destination, value }) {
    const { target } = resolveAuthoringToolScope(document, destination)
    if (target.owner !== 'global') throw new Error('课程设置工具需要 global owner')
    const creating = value.operation.startsWith('add-')
    const isState = value.operation.endsWith('state')
    const isGuard = value.operation.endsWith('guard')
    const field = isState ? 'courseState' : isGuard ? 'navigationGuards' : value.operation
    const itemId = destination.kind === 'update' ? destination.target.itemId
      : value.operation === 'add-state' ? value.declaration.key : `guard-${nanoid(10)}`
    const address = makeAuthoringAddress({ projectId: document.id, scope: 'global', carrier: 'native', layerItemId: itemId, field })
    if (creating) {
      if (destination.kind !== 'create' || destination.scope.parent.kind !== 'owner' || destination.scope.insertion.kind !== 'append') throw new Error('课程设置创建需要 global owner 追加位置')
    } else {
      if (destination.kind !== 'update' || destination.target.authoringAddress !== address) throw new Error('课程设置 authoringAddress 不匹配')
      const exists = isState ? document.courseState.some((entry) => entry.key === itemId)
        : isGuard ? document.navigationGuards.some((entry) => entry.id === itemId) : itemId === document.id
      if (!exists) throw new Error('课程设置目标已失效')
    }
    const commandTarget = { projectId: document.id, baseRevision: document.revision }
    let nextDocument = document
    if (value.operation === 'playback') {
      const result = updateCoursePlaybackSettings(document, value.playback, { expectedRevision: document.revision })
      if (!result.ok || !result.nextDocument) throw new Error(result.reason)
      nextDocument = result.nextDocument
    } else {
      let command: CourseLogicAuthoringCommand | null = null
      switch (value.operation) {
        case 'add-state': command = { ...commandTarget, kind: 'course-state.add', declaration: value.declaration }; break
        case 'update-state': command = { ...commandTarget, kind: 'course-state.update', key: itemId, declaration: value.declaration }; break
        case 'delete-state': command = { ...commandTarget, kind: 'course-state.delete', key: itemId }; break
        case 'add-guard': command = { ...commandTarget, kind: 'navigation-guard.add', guard: { ...value.guard, id: itemId } }; break
        case 'update-guard': command = { ...commandTarget, kind: 'navigation-guard.update', guardId: itemId, guard: { ...value.guard, id: itemId } }; break
        case 'delete-guard': command = { ...commandTarget, kind: 'navigation-guard.delete', guardId: itemId }; break
      }
      const result = value.operation === 'network' ? replaceCourseNetworkDeclaration(document, commandTarget, value.network)
        : executeCourseLogicAuthoringCommand(document, command!)
      if (!result.ok && result.code !== 'no-change') throw new Error(result.reason)
      if (result.ok) nextDocument = result.project
    }
    const affectedId = value.operation === 'update-state' ? value.declaration.key : itemId
    return {
      transaction: { projectId: document.id, baseRevision: document.revision, nextDocument, resourceChanges: {} },
      affected: [{ id: affectedId, operation: creating ? 'created' : value.operation.startsWith('delete-') ? 'deleted' : 'updated', ownerKey: 'global',
        authoringAddress: makeAuthoringAddress({ projectId: document.id, scope: 'global', carrier: 'native', layerItemId: affectedId, field }) }],
    }
  },
}
