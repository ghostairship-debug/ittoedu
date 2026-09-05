import { nanoid } from 'nanoid'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import type { CourseProjectDocument, LayerItem, SlideSceneDocument } from '../../shared/courseProjectTypes'
import type { InteractionActionPayload, InteractionCondition, InteractionRule } from '../../shared/interactionTypes'
import { SINGLE_CHOICE_STATE_KEY_PREFIX, SINGLE_CHOICE_STATE_KEY_SUFFIX } from '../../shared/singleChoiceRuleFamily'
import type { EditorTransactionPlan } from '../authoring/editorTransaction'
import { commitCourseProjectMutation } from '../course/courseProjectMutation'
import { createExternalComponentNode, createTextNode } from '../project/nativeNodeFactories'
import { RECIPE_CATALOG, type RecipeInput } from './recipeCatalog'
import { createSortComponentPackage } from './sort-component/package'

export type RecipePlanResult =
  | { ok: true; plan: EditorTransactionPlan<{ locationId: string; layerItemIds: string[] }>; createdLocationId: string }
  | { ok: false; kind: 'invalid' | 'switch-layout' | 'split-pages' | 'use-flow'; reason: string }
const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean)
class CapacityError extends Error {
  constructor(readonly kind: 'switch-layout' | 'split-pages' | 'use-flow', message: string) { super(message) }
}

/** Plans one ordinary V9 scene and optional package bytes. Nothing writes a live session. */
export function planRecipe(project: CourseProjectDocument, input: RecipeInput, options: { idFactory?: () => string; now?: string } = {}): RecipePlanResult {
  try {
    if (input.target.projectId !== project.id || input.target.revision !== project.revision) throw new Error('工程内容已改变，请重新打开配方。')
    const catalog = RECIPE_CATALOG.find(entry => entry.id === input.recipeId)
    if (!catalog) throw new Error('不支持的配方。')
    const location = project.locations.find(entry => entry.id === input.target.locationId)
    const surface = project.surfaces.find(entry => entry.id === location?.surfaceId)
    if (!location || !surface || surface.type !== 'slide') throw new Error('请在演示页中应用页面配方；长正文建议使用流式讲义。')
    const slots: Record<string, string> = {}
    for (const field of catalog.fields) {
      const value = input.slots[field.key]
      if (typeof value !== 'string') throw new Error(`缺少${field.label}。`)
      slots[field.key] = value.trim()
    }
    if (!slots.title) throw new Error('请填写标题。')
    if (slots.title.length > 54) throw new CapacityError('switch-layout', '标题过长，建议换用概念讲解版式或缩短标题。')
    if (Object.values(slots).some(value => value.length > 1200)) throw new CapacityError('use-flow', '内容较长，建议切换为流式讲义。')
    const accent = input.accentTokenId
      ? project.designTokens.colors.find(token => token.id === input.accentTokenId)?.color
      : project.designTokens.colors.find(token => token.id === 'accent')?.color ?? '#2563eb'
    if (!accent) throw new Error('所选项目色已不存在，请重新选择。')
    const idFactory = options.idFactory ?? nanoid
    const id = (prefix: string) => `${prefix}_${idFactory()}`
    const sceneId = id('scene'), stateId = id('state')
    const scene: SlideSceneDocument = { id: sceneId, name: slots.title, backgroundColor: '#ffffff', layerItems: [], interactions: [], presentation: { initialStateId: stateId, thumbnailStateId: stateId, states: [{ id: stateId, name: '初始', layerItemOverrides: {} }] } }
    // Fixed readable templates, scaled to the authored canvas. No runtime layout solver.
    const sx = surface.canvas.width / 1280, sy = surface.canvas.height / 720
    const fontScale = Math.min(sx, sy)
    if (fontScale < 0.75) throw new CapacityError('switch-layout', '当前画布过小，建议切换标准演示页版式。')
    const text = (label: string, value: string, x: number, y: number, width: number, height: number, size = 28, colored = false, hidden = false): string => {
      const fontSize = Math.max(20, size * fontScale)
      const lineCapacity = Math.max(1, Math.floor(width * sx / fontSize))
      const neededLines = value.split(/\r?\n/).reduce((count, line) => count + Math.max(1, Math.ceil(line.length / lineCapacity)), 0)
      if (neededLines * (fontSize + 6) > height * sy) throw new CapacityError('split-pages', `${label}超出版式容量，请拆成两页或改用流式讲义。`)
      const node = createTextNode({ id: id('text'), name: label, text: value, x: x * sx, y: y * sy, width: width * sx, height: height * sy, playbackInitialVisibility: hidden ? 'hidden' : 'inherit', style: { fontSize, color: colored ? accent : '#1f2937', bold: label === '标题', overflow: 'fixed' } })
      scene.layerItems.push(sceneNodeToCourseLayerItem(node, scene.layerItems.length + 1))
      return node.id
    }
    const show = (nodeId: string, visible: boolean): InteractionActionPayload => ({ type: visible ? 'node.enter' : 'node.exit', nodeId, effect: 'none', durationMs: 0, easing: 'linear' })
    const rule = (name: string, trigger: InteractionRule['trigger'], actions: InteractionActionPayload[], conditions: InteractionCondition[] = []) => scene.interactions.push({ id: id('rule'), name, enabled: true, trigger, conditions, actions: actions.map(action => ({ id: id('action'), start: 'after-previous', delayMs: 0, action })) })
    const click = (nodeId: string, actions: InteractionActionPayload[], conditions: InteractionCondition[] = []) => rule('点击操作', { type: 'node.click', nodeId }, actions, conditions)
    const compare = (key: string, value: string | number): InteractionCondition => ({ type: 'course-state.compare', key, operator: 'eq', value })
    const declarations: CourseProjectDocument['courseState'] = []
    const title = text('标题', slots.title, 72, 46, 1136, 112, 42, true)
    void title
    let sortPackage: ReturnType<typeof createSortComponentPackage> | undefined
    if (input.recipeId === 'cover-v1') {
      text('副标题', slots.subtitle, 80, 218, 620, 132, 32)
      text('署名', slots.author, 80, 558, 620, 60, 24)
      text('视觉槽位', slots.visual, 766, 224, 420, 260, 28, true)
    } else if (input.recipeId === 'concept-v1') {
      text('解释', slots.explanation, 72, 190, 660, 210)
      text('例证', slots.example, 72, 440, 660, 190)
      text('视觉槽位', slots.visual, 810, 220, 360, 350, 28, true)
    } else if (input.recipeId === 'worked-example-v1' || input.recipeId === 'step-reveal-v1') {
      const steps = lines(slots.steps)
      if (steps.length < (input.recipeId === 'step-reveal-v1' ? 3 : 1)) throw new Error('逐步揭示至少填写三步，分步例题至少填写一步。')
      if (steps.length > 5) throw new CapacityError('split-pages', '每页最多五步，请拆页。')
      const initial = input.recipeId === 'step-reveal-v1' ? Number(slots.initialStep) : steps.length
      if (!Number.isInteger(initial) || initial < 0 || initial > steps.length) throw new Error('初始显示步数必须在 0 到步骤数之间。')
      const stepIds = steps.map((value, index) => text(`步骤 ${index + 1}`, `${index + 1}. ${value}`, 96, 176 + index * 74, 1060, 64, 28, false, index >= initial))
      if (input.recipeId === 'worked-example-v1') {
        text('结论', slots.conclusion, 96, 560, 1060, 58, 28, true)
        text('提示', slots.hint, 96, 628, 1060, 48, 22)
      } else {
        const key = id('progress'); declarations.push({ key, valueType: 'number', defaultValue: initial })
        const next = text('下一步', '下一步 →', 96, 620, 320, 54, 28, true)
        const reset = text('重置', '返回起点', 840, 620, 320, 54, 28, true)
        stepIds.forEach((stepId, index) => click(next, [show(stepId, true), { type: 'course-state.set', key, value: index + 1 }], [compare(key, index)]))
        const resetActions: InteractionActionPayload[] = [{ type: 'course-state.set', key, value: initial }, ...stepIds.map((stepId, index) => show(stepId, index < initial))]
        click(reset, resetActions); rule('进入页面恢复起点', { type: 'scene.enter' }, resetActions)
      }
    } else if (input.recipeId === 'choice-feedback-v1') {
      const choices = lines(slots.options), correct = Number(slots.correct)
      if (choices.length < 2) throw new Error('至少填写两个选项。')
      if (choices.length > 4) throw new CapacityError('switch-layout', '当前选择版式最多四个选项，请精简选项或拆页。')
      if (!Number.isInteger(correct) || correct < 1 || correct > choices.length) throw new Error('必须有且只有一个有效的正确选项序号。')
      const correctKey = `${SINGLE_CHOICE_STATE_KEY_PREFIX}${idFactory()}${SINGLE_CHOICE_STATE_KEY_SUFFIX}`
      declarations.push({ key: correctKey, valueType: 'boolean', defaultValue: false })
      const feedback = choices.map((_, index) => text(`选项 ${index + 1} 反馈`, index === correct - 1 ? slots.success : slots.failure, 90, 534, 1100, 80, 28, index === correct - 1, true))
      choices.forEach((value, index) => {
        const target = text(`选项 ${index + 1}`, `${String.fromCharCode(65 + index)}. ${value}`, 110, 194 + index * 74, 1060, 66)
        click(target, [{ type: 'course-state.set', key: correctKey, value: index === correct - 1 }, ...feedback.map((feedbackId, feedbackIndex) => show(feedbackId, feedbackIndex === index))])
      })
      const reset = text('重置', '重新选择', 900, 630, 280, 48, 26, true)
      click(reset, [{ type: 'course-state.set', key: correctKey, value: false }, ...feedback.map(target => show(target, false))])
    } else {
      if (slots.mode !== 'sort' && slots.mode !== 'classify') throw new Error('模式必须为 classify 或 sort。')
      const items = lines(slots.items).map(line => { const parts = line.split('|').map(part => part.trim()); return { id: parts[0], text: parts[1], group: parts[2] } })
      if (items.length < 2 || items.some(item => !item.id || !item.text) || new Set(items.map(item => item.id)).size !== items.length) throw new Error('至少两个项目，每项必须有唯一稳定 ID 和文字。')
      if (items.length > 5) throw new CapacityError('split-pages', '每页最多五个项目，请拆页。')
      if (slots.mode === 'sort') {
        const expected = slots.correctOrder.split(',').map(value => value.trim())
        if (expected.length !== items.length || new Set(expected).size !== items.length || expected.some(value => !items.some(item => item.id === value))) throw new Error('正确顺序必须恰好包含全部项目 ID，不能重复或遗漏。')
        sortPackage = createSortComponentPackage()
        const node = createExternalComponentNode({ id: id('component'), name: '教学排序', x: 80 * sx, y: 180 * sy, width: 1120 * sx, height: 480 * sy, component: { packageId: sortPackage.manifest.id, version: sortPackage.manifest.version }, props: { items: items.map(item => `${item.id} | ${item.text}`).join('\n'), correctOrder: expected.join(','), content: { success: slots.success, failure: slots.failure } } })
        scene.layerItems.push(sceneNodeToCourseLayerItem(node, scene.layerItems.length + 1))
      } else {
        const groups = lines(slots.groups)
        if (groups.length < 2 || new Set(groups).size !== groups.length || items.some(item => !groups.includes(item.group))) throw new Error('至少两个不同的组，每个项目必须属于一个已定义的组。')
        if (groups.length > 3) throw new CapacityError('switch-layout', '分类版式最多三个组，请精简组数或拆页。')
        const selected = id('selected'); declarations.push({ key: selected, valueType: 'string', defaultValue: '' })
        const itemIds = items.map((item, index) => text(`项目 ${item.id}`, item.text, 80, 184 + index * 65, 450, 58, 26))
        const selectedLabels = items.map((item, index) => text(`已选 ${item.id}`, `已选：${item.text}`, 590, 494, 610, 52, 25, true, true))
        const success = text('正确反馈', slots.success, 590, 554, 610, 66, 26, true, true)
        const failure = text('错误反馈', slots.failure, 590, 554, 610, 66, 26, false, true)
        const assignments: string[] = []
        const assignedDisplays: string[] = []
        items.forEach((item, index) => {
          const key = id('assigned'); assignments.push(key); declarations.push({ key, valueType: 'string', defaultValue: '' })
          click(itemIds[index], [{ type: 'course-state.set', key: selected, value: item.id }, ...selectedLabels.map((nodeId, i) => show(nodeId, i === index)), show(success, false), show(failure, false)])
        })
        groups.forEach((group, groupIndex) => {
          const groupId = text(`分类组 ${group}`, group, 590 + groupIndex * 200, 186, 186, 60, 26, true)
          items.forEach((item, index) => {
            const placed = text(`${item.id} → ${group}`, item.text, 590 + groupIndex * 200, 262 + index * 44, 186, 40, 20, false, true)
            assignedDisplays.push(placed)
            // Build after all groups so reassigning hides the previous group too.
            click(groupId, [{ type: 'course-state.set', key: assignments[index], value: group }, show(placed, true), show(success, false), show(failure, false)], [compare(selected, item.id)])
          })
        })
        for (const candidate of scene.interactions) {
          if (candidate.trigger.type !== 'node.click' || !candidate.conditions.some(condition => condition.type === 'course-state.compare' && condition.key === selected)) continue
          const itemIndex = items.findIndex(item => candidate.conditions.some(condition => condition.type === 'course-state.compare' && condition.value === item.id))
          const shown = candidate.actions.find(step => step.action.type === 'node.enter')?.action
          const hidden = assignedDisplays.filter((_, index) => index % items.length === itemIndex).filter(nodeId => shown?.type !== 'node.enter' || nodeId !== shown.nodeId)
          candidate.actions.push(...hidden.map(nodeId => ({ id: id('action'), start: 'after-previous' as const, delayMs: 0, action: show(nodeId, false) })))
        }
        const check = text('检查答案', '检查答案', 80, 620, 280, 52, 26, true)
        click(check, [show(success, true), show(failure, false)], items.map((item, index) => compare(assignments[index], item.group)))
        // One failing rule per item is enough; all write the same visible result.
        items.forEach((item, index) => click(check, [show(success, false), show(failure, true)], [{ type: 'course-state.compare', key: assignments[index], operator: 'neq', value: item.group }]))
        const reset = text('重置', '重置', 920, 630, 220, 48, 26, true)
        const resetActions: InteractionActionPayload[] = [...assignments, selected].map(key => ({ type: 'course-state.set', key, value: '' }))
        resetActions.push(...[...assignedDisplays, ...selectedLabels, success, failure].map(nodeId => show(nodeId, false)))
        click(reset, resetActions); rule('进入页面恢复分类', { type: 'scene.enter' }, resetActions)
      }
    }
    const nextDocument = commitCourseProjectMutation(project, draft => {
      const targetSurface = draft.surfaces.find(entry => entry.id === surface.id)!
      if (targetSurface.type !== 'slide') throw new Error('目标不是演示页。')
      const sourceSceneIndex = location.kind === 'slide-scene' ? targetSurface.scenes.findIndex(entry => entry.id === location.sceneId) : targetSurface.scenes.length - 1
      targetSurface.scenes.splice(sourceSceneIndex + 1, 0, scene)
      draft.locations.splice(draft.locations.findIndex(entry => entry.id === location.id) + 1, 0, { id: sceneId, kind: 'slide-scene', surfaceId: surface.id, sceneId, label: slots.title })
      draft.courseState.push(...declarations)
      const printEntry = draft.mixedPrintPlan?.entries.find(entry => entry.kind === 'slide-scenes' && entry.surfaceId === surface.id)
      if (printEntry?.kind === 'slide-scenes') {
        const sourcePrintIndex = location.kind === 'slide-scene' ? printEntry.sceneIds.indexOf(location.sceneId) : -1
        printEntry.sceneIds.splice(sourcePrintIndex >= 0 ? sourcePrintIndex + 1 : printEntry.sceneIds.length, 0, sceneId)
      }
      if (sortPackage) {
        const existing = draft.componentPackages[sortPackage.manifest.id]
        if (existing && existing.contentSha256 !== sortPackage.metadata.contentSha256) throw new Error('工程已有不同版本的教学排序包，请先处理版本冲突。')
        draft.componentPackages[sortPackage.manifest.id] = sortPackage.metadata
      }
    }, options.now)
    return { ok: true, createdLocationId: sceneId, plan: { projectId: project.id, baseRevision: project.revision, nextDocument,
      resourceChanges: sortPackage && !project.componentPackages[sortPackage.manifest.id] ? { componentPackageChanges: [{ packageId: sortPackage.manifest.id, after: sortPackage }] } : {},
      selectionHint: { locationId: sceneId, layerItemIds: scene.layerItems.map((item: LayerItem) => item.layerItemId) },
    } }
  } catch (error) {
    return { ok: false, kind: error instanceof CapacityError ? error.kind : 'invalid', reason: error instanceof Error ? error.message : '配方无法应用。' }
  }
}
