import { nanoid } from 'nanoid'
import { z } from 'zod'
import { interactionRuleContentSchema } from '../../../shared/interactionSchema'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import { openSlideAuthoringSession } from '../../course/slideAuthoringBackend'
import { addSlideSceneInteractionRule, updateSlideSceneInteractionRule, deleteSlideSceneInteractionRule } from '../../course/v9SlideActionCommands'
import type { AuthoringToolDefinition } from './executeAuthoringTool'
import { resolveAuthoringToolScope } from './authoringToolScope'

const rule = interactionRuleContentSchema
export const slideInteractionToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('insert'), rule }).strict(),
  z.object({ operation: z.literal('replace'), rule }).strict(),
  z.object({ operation: z.literal('delete') }).strict(),
])
export const slideInteractionTool: AuthoringToolDefinition<z.infer<typeof slideInteractionToolInputSchema>> = {
  name: 'slide.interaction', inputSchema: slideInteractionToolInputSchema,
  description: '仅 Slide scene owner；insert 使用 create owner append。rule 使用本卡完整输入 Schema，不含最外层 id（由宿主生成），保留 actions 内部的步骤 id。第一动作 start 必须 after-previous，导航动作必须最后。',
  plan({ document, destination, value }) {
    const { target, surface, location } = resolveAuthoringToolScope(document, destination)
    if (surface.type !== 'slide' || location.kind !== 'slide-scene' || target.owner !== 'scene') throw new Error('Slide 互动工具需要 scene owner')
    const scene = surface.scenes.find((entry) => entry.id === location.sceneId)!
    const itemId = destination.kind === 'update' ? destination.target.itemId : `rule-${nanoid(10)}`
    const address = makeAuthoringAddress({ projectId: document.id, scope: 'scene', surfaceId: surface.id, sceneId: scene.id, carrier: 'native', layerItemId: itemId, field: 'interactions' })
    if (value.operation === 'insert') {
      if (destination.kind !== 'create' || destination.scope.parent.kind !== 'owner' || destination.scope.insertion.kind !== 'append') throw new Error('互动创建需要 scene owner 追加位置')
    } else if (destination.kind !== 'update' || destination.target.authoringAddress !== address || !scene.interactions.some((entry) => entry.id === itemId)) throw new Error('互动规则身份已失效')
    const opened = openSlideAuthoringSession(document, { locationId: target.locationId })
    const session = { ...opened, selection: { ...opened.selection, stateId: target.stateId } }
    const options = { expectedRevision: document.revision }
    const result = value.operation === 'insert' ? addSlideSceneInteractionRule(session, { ...value.rule, id: itemId }, options)
      : value.operation === 'replace' ? updateSlideSceneInteractionRule(session, itemId, value.rule, options)
      : deleteSlideSceneInteractionRule(session, itemId, options)
    if (!result.ok || !result.nextSession) throw new Error(result.reason)
    return {
      transaction: { projectId: document.id, baseRevision: document.revision, nextDocument: result.nextSession.history.present, resourceChanges: {} },
      affected: [{ id: itemId, operation: value.operation === 'insert' ? 'created' : value.operation === 'delete' ? 'deleted' : 'updated', ownerKey: target.ownerKey, authoringAddress: address }],
    }
  },
}
