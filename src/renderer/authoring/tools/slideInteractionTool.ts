import { nanoid } from 'nanoid'
import type { z } from 'zod'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import { openSlideAuthoringSession } from '../../course/slideAuthoringBackend'
import { addSlideSceneInteractionRule, updateSlideSceneInteractionRule, deleteSlideSceneInteractionRule } from '../../course/v9SlideActionCommands'
import type { AuthoringToolDefinition } from './executeAuthoringTool'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { slideInteractionToolInputSchema, composeSlideInteraction } from '../../../core/tools/interactionCompose'
export { slideInteractionToolInputSchema } from '../../../core/tools/interactionCompose'

export const slideInteractionTool: AuthoringToolDefinition<z.infer<typeof slideInteractionToolInputSchema>> = {
  name: 'slide.interaction', inputSchema: slideInteractionToolInputSchema,
  conditions: [
    { operations: ['compose', 'insert'], destination: 'create', parents: ['owner'], message: '互动创建使用 create parent:owner append；compose 只需触发与效果，宿主生成完整规则。' },
    { operations: ['replace', 'delete'], destination: 'update', message: 'replace/delete 需要前序互动回执的 update target；新建规则请用 compose 或 insert。' },
  ],
  description: '仅 Slide scene owner。常用“点击/输入提交/翻页 → 显示或隐藏解释、切换呈现状态（图形与文字随状态同步变化）、设置分数、进入下一步或下一场景”用 compose：触发与目标可给图层/状态/场景/课程位置的 id 或唯一名称，效果按顺序给出，宿主生成一致引用、步骤 id、分组与收尾导航，并在边界明确拒绝 Published 不支持的组合。显隐语义：show/hide 是已挂载节点的入退场动画，不能解除 visible:false；初始动画隐藏使用 playbackInitialVisibility:hidden。若已有目标呈现状态负责显隐，只需 set-state，不要先 show 隐藏节点再切状态。导航语义：next-step 先走完当前页剩余呈现步骤再进入下一场景；next-scene 直接跳过剩余步骤进入下一场景（跨 Slide/Flow/Spatial 位置复用课程顺序）；go-to-scene 精确进入指定 Slide 场景；go-to-location 按正式位置 id 精确进入 Slide、Flow 或 Spatial。限制：presentation.enter/presentation.in 当前 Published 播放不执行，因此 compose 不提供 state-enter 触发与 inStates 条件；状态进入类需求用 click/presenter 触发 + 末尾 set-state 效果（当前 Slide 场景、无 transition、独占最后执行组）表达，状态条件用 course-state.compare/course-state.exists，场景限定用 scene.in。需要延迟、动画/媒体触发或完整条件组合时用 insert/replace（本卡完整 rule Schema，不含最外层 id；第一动作 start 必须 after-previous，导航动作必须最后）。',
  plan({ document, destination, value }) {
    const { target, surface, location } = resolveAuthoringToolScope(document, destination)
    if (surface.type !== 'slide' || location.kind !== 'slide-scene' || target.owner !== 'scene') throw new Error('Slide 互动工具需要 scene owner')
    const scene = surface.scenes.find((entry) => entry.id === location.sceneId)!
    const itemId = destination.kind === 'update' ? destination.target.itemId : `rule-${nanoid(10)}`
    const address = makeAuthoringAddress({ projectId: document.id, scope: 'scene', surfaceId: surface.id, sceneId: scene.id, carrier: 'native', layerItemId: itemId, field: 'interactions' })
    if (value.operation === 'insert' || value.operation === 'compose') {
      if (destination.kind !== 'create' || destination.scope.parent.kind !== 'owner' || destination.scope.insertion.kind !== 'append') throw new Error('互动创建需要 scene owner 追加位置')
    } else if (destination.kind !== 'update' || destination.target.authoringAddress !== address || !scene.interactions.some((entry) => entry.id === itemId)) throw new Error('互动规则身份已失效')
    const opened = openSlideAuthoringSession(document, { locationId: target.locationId })
    const session = { ...opened, selection: { ...opened.selection, stateId: target.stateId } }
    const options = { expectedRevision: document.revision }
    const result = value.operation === 'insert' ? addSlideSceneInteractionRule(session, { ...value.rule, id: itemId }, options)
      : value.operation === 'compose' ? addSlideSceneInteractionRule(session, composeSlideInteraction(document, target, scene, itemId, value), options)
      : value.operation === 'replace' ? updateSlideSceneInteractionRule(session, itemId, value.rule, options)
      : deleteSlideSceneInteractionRule(session, itemId, options)
    if (!result.ok || !result.nextSession) throw new Error(result.reason)
    return {
      transaction: { projectId: document.id, baseRevision: document.revision, nextDocument: result.nextSession.history.present, resourceChanges: {} },
      affected: [{ id: itemId, operation: value.operation === 'delete' ? 'deleted' : value.operation === 'replace' ? 'updated' : 'created', ownerKey: target.ownerKey, authoringAddress: address }],
    }
  },
}
