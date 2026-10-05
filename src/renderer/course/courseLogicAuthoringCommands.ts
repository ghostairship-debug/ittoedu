import { courseStateDeclarationSchema } from '../../shared/contracts/course-state/schema'
import type { CourseStateDeclaration } from '../../shared/contracts/course-state/types'
import { courseStateScalarType } from '../../shared/contracts/course-state/types'
import { courseProjectLogicSchema } from '../../shared/contracts/component-platform/schema'
import type { ComponentEdit, ComponentPresentation, CourseProjectLogic, CourseProjectV10, JsonObject, JsonValue } from '../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey } from '../../shared/contracts/component-platform/project'
import type { InteractionRule } from '../../shared/interactionTypes'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import { interactionRules } from '../interactions/componentInteractionAuthoring'

export type CourseNavigationGuard = CourseProjectLogic['navigationGuards'][number]
export type CourseNetworkDeclaration = NonNullable<CourseProjectLogic['network']>
export interface CourseLogicAuthoringView {
  id: string; revision: number; courseState: CourseStateDeclaration[]; navigationGuards: CourseNavigationGuard[]
  surfaces: { id: string; title: string }[]
}
export function courseLogicAuthoringView(project: CourseProjectV10): CourseLogicAuthoringView {
  return { id: project.id, revision: project.revision, courseState: project.logic?.courseState ?? [],
    navigationGuards: project.logic?.navigationGuards ?? [], surfaces: project.surfaces.map(({ id, title }) => ({ id, title })) }
}
export interface CourseLogicAuthoringTarget { readonly projectId: string; readonly baseRevision: number }
export type CourseLogicAuthoringCommand = CourseLogicAuthoringTarget & (
  | { kind: 'course-state.add'; declaration: CourseStateDeclaration }
  | { kind: 'course-state.update'; key: string; declaration: CourseStateDeclaration }
  | { kind: 'course-state.delete'; key: string }
  | { kind: 'navigation-guard.add'; guard: CourseNavigationGuard }
  | { kind: 'navigation-guard.update'; guardId: string; guard: CourseNavigationGuard }
  | { kind: 'navigation-guard.delete'; guardId: string })
export type CourseLogicAuthoringFailureCode = 'project-mismatch' | 'stale-revision' | 'state-key-exists' | 'state-not-found'
  | 'state-referenced' | 'state-type-referenced' | 'guard-id-exists' | 'guard-not-found' | 'no-change' | 'invalid-document'
export type CourseLogicAuthoringResult = { ok: true; edits: ComponentEdit[]; statusMessage: string; historyEntry: boolean }
  | { ok: false; code: CourseLogicAuthoringFailureCode; reason: string; historyEntry: false }
const reject = (code: CourseLogicAuthoringFailureCode, reason: string): CourseLogicAuthoringResult => ({ ok: false, code, reason, historyEntry: false })
class LogicError extends Error { constructor(readonly code: CourseLogicAuthoringFailureCode, message: string) { super(message) } }
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
const referencesState = (rule: InteractionRule, key: string, sensitive = false) => rule.conditions.some(condition =>
  (condition.type === 'course-state.exists' || condition.type === 'course-state.compare') && condition.key === key && (!sensitive || condition.type === 'course-state.compare'))
  || rule.actions.some(step => step.action.type === 'course-state.set' && step.action.key === key)
function validateTarget(project: CourseProjectV10, target: CourseLogicAuthoringTarget): CourseLogicAuthoringResult | null {
  if (project.id !== target.projectId) return reject('project-mismatch', '逻辑草稿属于另一工程，请重新打开编辑器。')
  if (project.revision !== target.baseRevision) return reject('stale-revision', '工程已更新，请检查当前逻辑后再保存。')
  return null
}
/** Plans canonical C1 edits; the host DocumentSession owns revision/history. */
export function executeCourseLogicAuthoringCommand(project: CourseProjectV10, command: CourseLogicAuthoringCommand): CourseLogicAuthoringResult {
  const failure = validateTarget(project, command); if (failure) return failure
  try {
    const logic: CourseProjectLogic = structuredClone(project.logic ?? { courseState: [], navigationGuards: [] })
    const behaviors = Object.values(project.instances).filter(instance => componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.interactions')
    const stateRules = project.surfaces.flatMap(surface => (surface.presentation?.states ?? []).flatMap(state => behaviors.flatMap(instance => {
      const data = state.overrides[instance.id]?.data
      return data === undefined ? [] : [{ surfaceId: surface.id, stateId: state.id, instance, data, rules: interactionRules({ ...instance, data }) }]
    })))
    const rules = [...behaviors.flatMap(instance => interactionRules(instance)), ...stateRules.flatMap(slot => slot.rules)]
    const edits: ComponentEdit[] = []
    let statusMessage = ''
    if (command.kind.startsWith('course-state.')) {
      const key = command.kind === 'course-state.add' ? command.declaration.key : 'key' in command ? command.key : ''
      const index = logic.courseState.findIndex(state => state.key === key)
      if (command.kind === 'course-state.add') {
        const declaration = courseStateDeclarationSchema.parse(command.declaration)
        if (index >= 0) throw new LogicError('state-key-exists', `状态“${key}”已经存在。`)
        logic.courseState.push(declaration); statusMessage = `已添加状态“${key}”`
      } else if (command.kind === 'course-state.update' || command.kind === 'course-state.delete') {
        if (index < 0) throw new LogicError('state-not-found', `找不到状态“${key}”。`)
        const sensitive = command.kind === 'course-state.update' && logic.courseState[index]!.valueType !== command.declaration.valueType
        const referenced = logic.navigationGuards.some(guard => guard.conditions.some(condition => condition.key === key && (!sensitive || condition.type === 'compare')))
          || rules.some(rule => referencesState(rule, key, sensitive))
        if (command.kind === 'course-state.delete') {
          if (referenced) throw new LogicError('state-referenced', `状态“${key}”仍被守卫或互动使用，请先调整引用。`)
          logic.courseState.splice(index, 1); statusMessage = `已删除状态“${key}”`
        } else {
          const declaration = courseStateDeclarationSchema.parse(command.declaration)
          if (sensitive && referenced) throw new LogicError('state-type-referenced', `状态“${key}”被比较或赋值使用，请先调整这些操作。`)
          if (declaration.key !== key && logic.courseState.some(state => state.key === declaration.key)) throw new LogicError('state-key-exists', '新状态键已经存在。')
          logic.courseState[index] = declaration
          if (declaration.key !== key) {
            for (const guard of logic.navigationGuards) guard.conditions = guard.conditions.map(condition => condition.key === key ? { ...condition, key: declaration.key } : condition)
            const renameRules = (rules: readonly InteractionRule[]) => rules.map(rule => ({ ...rule,
              conditions: rule.conditions.map(condition => (condition.type === 'course-state.exists' || condition.type === 'course-state.compare') && condition.key === key ? { ...condition, key: declaration.key } : condition),
              actions: rule.actions.map(step => step.action.type === 'course-state.set' && step.action.key === key ? { ...step, action: { ...step.action, key: declaration.key } } : step) }))
            for (const instance of behaviors) {
              const next = renameRules(interactionRules(instance))
              if (JSON.stringify(next) !== JSON.stringify(interactionRules(instance))) edits.push({ type: 'data.set', instanceId: instance.id, path: ['rules'], value: json(next) })
            }
            const presentations = new Map<string, ComponentPresentation>()
            for (const slot of stateRules) {
              const next = renameRules(slot.rules)
              if (JSON.stringify(next) === JSON.stringify(slot.rules)) continue
              const presentation = presentations.get(slot.surfaceId) ?? structuredClone(project.surfaces.find(surface => surface.id === slot.surfaceId)!.presentation!)
              presentation.states.find(state => state.id === slot.stateId)!.overrides[slot.instance.id]!.data = { ...(slot.data as JsonObject), rules: json(next) }
              presentations.set(slot.surfaceId, presentation)
            }
            for (const [surfaceId, presentation] of presentations) edits.push({ type: 'surface.presentation.set', surfaceId, presentation })
          }
          statusMessage = `已更新状态“${declaration.key}”并同步引用`
        }
      }
    } else if (command.kind === 'navigation-guard.add' || command.kind === 'navigation-guard.update' || command.kind === 'navigation-guard.delete') {
      const index = command.kind === 'navigation-guard.add' ? -1 : logic.navigationGuards.findIndex(guard => guard.id === command.guardId)
      if (command.kind !== 'navigation-guard.add' && index < 0) throw new LogicError('guard-not-found', '导航守卫已经不存在。')
      if (command.kind === 'navigation-guard.delete') logic.navigationGuards.splice(index, 1)
      else {
        const guard = courseProjectLogicSchema.shape.navigationGuards.element.parse(command.guard)
        if (logic.navigationGuards.some((value, i) => value.id === guard.id && i !== index)) throw new LogicError('guard-id-exists', '导航守卫身份重复。')
        const surfaces = new Set(project.surfaces.map(surface => surface.id))
        if ([...(guard.fromSurfaceIds ?? []), ...guard.toSurfaceIds].some(id => !surfaces.has(id))) throw new LogicError('invalid-document', '守卫引用的页面已不存在。')
        for (const condition of guard.conditions) {
          const declaration = logic.courseState.find(state => state.key === condition.key)
          if (!declaration) throw new LogicError('invalid-document', `守卫引用的状态“${condition.key}”未声明。`)
          if (condition.type === 'compare' && (courseStateScalarType(condition.value) !== declaration.valueType
            || !['eq', 'neq'].includes(condition.operator) && declaration.valueType !== 'number')) {
            throw new LogicError('invalid-document', `状态“${condition.key}”的比较值或运算不符合其类型。`)
          }
        }
        if (index < 0) logic.navigationGuards.push(guard); else logic.navigationGuards[index] = guard
      }
      statusMessage = command.kind === 'navigation-guard.delete' ? '已删除导航守卫' : '已保存导航守卫'
    }
    const parsed = courseProjectLogicSchema.parse(logic)
    if (JSON.stringify(project.logic ?? { courseState: [], navigationGuards: [] }) === JSON.stringify(parsed) && !edits.length) return reject('no-change', '课程逻辑没有变化。')
    edits.unshift({ type: 'project.logic.set', logic: parsed })
    return { ok: true, edits, statusMessage, historyEntry: false }
  } catch (error) { return reject(error instanceof LogicError ? error.code : 'invalid-document', error instanceof Error ? error.message : String(error)) }
}
export async function commitCourseLogicAuthoringCommand(kernel: EditorStoreKernel, documentId: string, command: CourseLogicAuthoringCommand): Promise<CourseLogicAuthoringResult> {
  try {
    const target = kernel.captureTarget(documentId), result = executeCourseLogicAuthoringCommand(target.project, command)
    if (!result.ok) return result
    await kernel.editCaptured(kernel.capture(result.edits, { ...target, activeStateId: null }))
    return { ...result, historyEntry: true }
  } catch (error) { return reject('invalid-document', error instanceof Error ? error.message : String(error)) }
}
export function replaceCourseNetworkDeclaration(project: CourseProjectV10, target: CourseLogicAuthoringTarget, network: CourseNetworkDeclaration): CourseLogicAuthoringResult {
  const failure = validateTarget(project, target); if (failure) return failure
  try {
    const logic = courseProjectLogicSchema.parse({ ...(project.logic ?? { courseState: [], navigationGuards: [] }), network })
    return { ok: true, edits: [{ type: 'project.logic.set', logic }], statusMessage: '已更新课程网络声明', historyEntry: false }
  } catch (error) { return reject('invalid-document', error instanceof Error ? error.message : String(error)) }
}
