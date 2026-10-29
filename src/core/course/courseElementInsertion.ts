import type {NavigationPresentation} from '../../shared/teacherControllerConfig'
import { courseInsertionFrame } from './courseInsertionGeometry'
import { componentSurface } from '../../shared/contracts/component-platform/project'
import { nanoid } from 'nanoid'
import type { ComponentContainer, ComponentDefinition, ComponentInstance, CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform/project'
import { componentDefinitionBuiltinKey, containerChildIds, owningContainer } from '../../shared/contracts/component-platform/project'
import { courseSettingsEdits } from './courseSemanticEdits'
import { courseGlobalPlacementEdits } from './courseObjectEdits'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { prepareProfessionalElement, type ProfessionalElementOptions, type CourseElementKind } from './professionalElementDefaults'
export type { CourseElementKind } from './professionalElementDefaults'
import { TEACHER_CONTROLLER_DEFINITION, createTeacherControllerData, createTeacherControllerFrame } from '../../components/teacher-controller/data'

export interface CourseInsertionOptions extends ProfessionalElementOptions {
  x?: number; y?: number; width?: number; height?: number
  center?: { x: number; y: number }
  container?: ComponentContainer; afterInstanceId?: string | null; index?: number
  destination?: 'document' | 'paper'
  /** Existing UI default profile, prepared by the host rather than supplied by public intent. */
  origin?: ProfessionalElementOptions['origin']
}
interface CourseInsertionTarget { project: CourseProjectV10; surfaceId: string | null; instanceId?: string | null; rootInstanceId?: string | null }

export function insertionContainer(target: CourseInsertionTarget, options: CourseInsertionOptions = {}): ComponentContainer {
  if (target.instanceId && !target.project.instances[target.instanceId]) throw new Error('插入的原对象已不存在')
  if (options.destination === 'paper' && options.container?.kind !== 'global'
    && target.surfaceId && componentSurface(target.project, target.surfaceId)?.kind === 'flow') {
    if (!target.surfaceId) throw new Error('插入目标没有页面')
    return { kind: 'instance', instanceId: target.surfaceId }
  }
  if (options.container) return options.container
  const selectedOwner = target.instanceId ? owningContainer(target.project, target.instanceId) : null
  if (selectedOwner?.kind === 'global') return selectedOwner
  if (selectedOwner?.kind === 'instance' && target.surfaceId && componentSurface(target.project, target.surfaceId)?.kind === 'flow') return selectedOwner
  if (target.surfaceId) return { kind: 'instance', instanceId: target.surfaceId }
  const rootId = target.rootInstanceId ?? target.project.entry?.rootInstanceId
  if (rootId) {
    if (!target.project.rootIds.includes(rootId) || !target.project.instances[rootId]) throw new Error('插入的原作品根已不存在')
    return { kind: 'instance', instanceId: rootId }
  }
  const selected = target.instanceId ? target.project.instances[target.instanceId] : undefined
  if (selected?.childIds) return { kind: 'instance', instanceId: selected.id }
  if (selectedOwner?.kind === 'instance') return selectedOwner
  return { kind: 'project' }
}
export function insertionIndex(target: CourseInsertionTarget, container: ComponentContainer, options: CourseInsertionOptions = {}): number {
  const ids = containerChildIds(target.project, container)
  if (options.index !== undefined) return options.index
  if (options.origin === 'slide-authoring') return ids.length
  if (options.afterInstanceId === null) return 0
  const selected = options.afterInstanceId === undefined ? target.instanceId : options.afterInstanceId
  const index = selected ? ids.indexOf(selected) : -1
  return index < 0 ? ids.length : index + 1
}
export function definitionInsertionEdits(target: CourseInsertionTarget, definition: ComponentDefinition): ComponentEdit[] {
  return target.project.definitions[definition.id] ? [] : [{ type: 'definition.set', definition: structuredClone(definition) }]
}
/** Persist rich professional data, removing only absent optional JSON values. */
export function courseAuthorData(data: unknown): JsonValue { return JSON.parse(JSON.stringify(data)) as JsonValue }
/** Shared placement for professional instances, media and library roots. */
export function resolveCourseInsertionPlacement(target: CourseInsertionTarget, options: CourseInsertionOptions = {}, rootIds: readonly string[] = []) {
  const container = insertionContainer(target, options)
  const flowPaper = container.kind !== 'global' && target.surfaceId && componentSurface(target.project, target.surfaceId)?.kind === 'flow' && options.destination === 'paper'
  const edits: ComponentEdit[] = flowPaper ? rootIds.map(instanceId => ({ type: 'instance.flowPlacement.set', instanceId,
    flowPlacement: { space: 'paper', plane: 'overlay' } })) : []
  return { container, index: insertionIndex(target, container, options), edits }
}
/** The original professional insertion algorithm; the caller retains capture, CAS and History. */
export function prepareCourseElementEdits(project: CourseProjectV10, surfaceId: string | null, selectedInstanceId: string | null,
  kind: CourseElementKind, options: CourseInsertionOptions = {}): { edits: ComponentEdit[]; instanceIds: string[] } {
  if (surfaceId && !componentSurface(project, surfaceId)) throw new Error('插入的原页面已不存在')
  const target = { project, surfaceId, instanceId: selectedInstanceId }
  const { definition, data, width, height } = prepareProfessionalElement(kind, options)
  const instance: ComponentInstance = { id: `instance_${nanoid()}`, definitionId: definition.id,
    ...(!options.origin ? { name: definition.title } : {}), data: courseAuthorData(data), frame: courseInsertionFrame(target, width, height, options) }
  const instanceIds = [instance.id], placement = resolveCourseInsertionPlacement(target, options, instanceIds)
  return { instanceIds, edits: [...definitionInsertionEdits(target, definition),
    { type: 'instance.insert', container: placement.container, index: placement.index, instances: [instance], rootIds: instanceIds }, ...placement.edits] }
}

/** Existing controller reuse and both supported UI defaults share one preparation owner. */
export function prepareCourseTeacherControllerEdits(project: CourseProjectV10, surfaceId: string | null,
  origin?: 'slide-authoring', selectedInstanceId?: string | null, options: {placement?:'global'|'content';presentation?:NavigationPresentation} = {}): { edits: ComponentEdit[]; instanceIds: string[] } {
  if(options.placement==='content'){
    const surface=surfaceId?componentSurface(project,surfaceId):undefined;if(!surface)throw new Error('请先选择导航组件所在页面')
    const id='instance_'+nanoid(),presentation=options.presentation??'directory'
    const data={...createTeacherControllerData(surface.designSize),presentation,title:presentation==='directory'?'内容目录':'作品导航',collapsible:false,defaultCollapsed:false,includeInStaticExports:true}
    const width=surface.kind==='flow'?surface.flow?.layout.readingWidth??800:Math.min(surface.designSize?.width??1280,880)-48
    const height=presentation==='directory'||presentation==='side'?240:72
    const instance:ComponentInstance={id,definitionId:TEACHER_CONTROLLER_DEFINITION.id,name:data.title,data:courseAuthorData(data),frame:{width,height,transform:[1,0,0,1,surface.kind==='flow'?0:24,surface.kind==='flow'?0:24]},...(surface.kind==='flow'?{flowLayout:{width:'content-width' as const}}:{})}
    return {instanceIds:[id],edits:[...definitionInsertionEdits({project,surfaceId},TEACHER_CONTROLLER_DEFINITION),{type:'instance.insert',container:{kind:'instance',instanceId:surface.id},index:surface.kind==='flow'?0:surface.childIds.length,instances:[instance],rootIds:[id]}]}
  }
  const existing = Object.values(project.instances).find(instance => (project.global.overlay.includes(instance.id)||project.global.underlay.includes(instance.id))&&componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.navigation')
  const playback = courseSettingsEdits(project, { playback: { controls: 'canvas' } })
  if (existing) {
    const data = existing.data && typeof existing.data === 'object' && !Array.isArray(existing.data) ? existing.data : {}
    const variants = data.sceneStyles, variant = variants && typeof variants === 'object' && !Array.isArray(variants) && surfaceId ? variants[surfaceId] : undefined
    return { edits: [...playback, { type: 'instance.patch', instanceId: existing.id, patch: { visible: true } },
      { type: 'data.set', instanceId: existing.id, path: ['enabled'], value: true },
      ...(options.presentation?[{type:'data.set' as const,instanceId:existing.id,path:['presentation'],value:options.presentation}]:[]),
      ...(variant && typeof variant === 'object' && !Array.isArray(variant) && variant.enabled === false && surfaceId
        ? [{ type: 'data.set' as const, instanceId: existing.id, path: ['sceneStyles', surfaceId, 'enabled'], value: true }] : []),
      ...(surfaceId ? courseGlobalPlacementEdits(project, existing.id, { atSurface: { surfaceId, visible: true } }) : [])], instanceIds: [existing.id] }
  }
  const surface = surfaceId ? componentSurface(project, surfaceId) : undefined
  if (surfaceId && !surface) throw new Error('插入的原页面已不存在')
  const canvas = origin === 'slide-authoring' ? surface?.designSize ?? { width: 1280, height: 720 } : undefined
  const instance: ComponentInstance = { id: `instance_${nanoid()}`, definitionId: TEACHER_CONTROLLER_DEFINITION.id,
    ...(origin ? {} : { name: '全局控制台' }), data: courseAuthorData({...createTeacherControllerData(canvas),...(options.presentation?{presentation:options.presentation}:{})}),
    frame: origin ? createTeacherControllerFrame(canvas) : { width: 720, height: 80, transform: [1, 0, 0, 1, 20, 20] } }
  return { instanceIds: [instance.id], edits: [...playback, ...definitionInsertionEdits({ project, surfaceId }, TEACHER_CONTROLLER_DEFINITION),
    { type: 'instance.insert', container: { kind: 'global', plane: 'overlay' },
      index: insertionIndex({ project, surfaceId, instanceId: selectedInstanceId }, { kind: 'global', plane: 'overlay' }, { origin }),
      instances: [instance], rootIds: [instance.id] }] }
}
