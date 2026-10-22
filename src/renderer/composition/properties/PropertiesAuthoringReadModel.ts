import { componentContainers } from '../../../shared/contracts/component-platform/project'
import type { ComponentInstance, ComponentSurface, CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import { componentContainerForInstance, componentIsLocked, owningContainer } from '../../../shared/contracts/component-platform/project'
import type { DocumentResources } from '../../../shared/workbench/document'
import type { EditorState } from '../../store/editorStore'
import { selectEditingScope } from '../../store/editorStore'
import { projectWithSlideContentDraft } from '../../store/slices/slideAuthoringSlice'
import { componentPropertiesView } from '../../ui/properties/componentProperties'
import type { PropertiesItemView } from '../../ui/properties/SlideNativePropertiesPanel'
import { frameCorners } from '../../../core/components/geometry'
import { componentParentMatrix } from '../crossSurfaceCommands'
import type { CourseInteractionSelection } from '../../documents/interactionSelection'

export interface PropertiesOwnerReadModel {
  readonly documentId: string | null
  readonly rootInstanceId?: string | null
  readonly epoch: string | null
  readonly activeStateId: string | null
  readonly editingGlobal: boolean
  readonly project: CourseProjectV10 | null
  readonly baseProject: CourseProjectV10 | null
  readonly surface: ComponentSurface | null
  readonly selectedInstanceIds: readonly string[]
  readonly selectedInstances: readonly ComponentInstance[]
  readonly selectedViews: readonly PropertiesItemView[]
  readonly selectedInstance: ComponentInstance | null
  readonly selectedView: PropertiesItemView | null
  readonly selectedIsGlobal: boolean
  readonly selectedField?: Extract<CourseInteractionSelection, { kind: 'author-field' }> | null
  readonly resources: DocumentResources
  readonly error: string | null
}

const cache = new WeakMap<object, { inputs: readonly unknown[]; read: PropertiesOwnerReadModel }>()
const EMPTY_RESOURCES: DocumentResources = { assets: {}, components: {} }

/** A Properties-only projection. The Bridge owns documents, selection and pending edits. */
export function selectPropertiesAuthoringReadModel(state: EditorState): PropertiesOwnerReadModel {
  const view = state.courseView
  const draft = state.slideContentEdit
  const resources = view.views.find(item => item.documentId === view.activeDocumentId)?.model.resources
    ?? view.snapshot?.model.resources ?? EMPTY_RESOURCES
  const editingGlobal = selectEditingScope(state) === 'global'
  const selectedField = view.interactionSelection?.kind === 'author-field' ? view.interactionSelection : null
  const inputs = [view.project, view.editingProject, view.activeDocumentId, view.snapshot?.epoch, view.rootInstanceId,
    view.surfaceId, view.activeStateId, view.presentationStates, view.selectedInstanceIds, selectedField, draft,
    editingGlobal, resources, view.error, state.flowContextSelection]
  const cacheKey = view.editingProject ?? view.project ?? view
  const cached = cache.get(cacheKey)
  if (cached && cached.inputs.length === inputs.length && inputs.every((value, index) => Object.is(value, cached.inputs[index]))) return cached.read
  const effective = view.editingProject
  const project = effective ? projectWithSlideContentDraft(effective, draft, { documentId: view.activeDocumentId ?? '',
    epoch: view.snapshot?.epoch, surfaceId: view.surfaceId, activeStateId: view.activeStateId }) : effective
  const selectedInstances = project
    ? view.selectedInstanceIds.flatMap(id => project.instances[id] ? [project.instances[id]!] : [])
    : []
  let error: string | null = view.error
  const selectedViews = selectedField ? [] : selectedInstances.flatMap(instance => {
    try {
      const item = componentPropertiesView(instance, project!.definitions[instance.definitionId])
      item.locked = componentIsLocked(project!, instance.id)
      // Multi-selection statistics use world corners; single-item editors retain parent-local frame fields.
      if (selectedInstances.length <= 1 || !instance.frame) return [item]
      const corners = frameCorners(instance.frame, componentParentMatrix(project!, instance.id))
      const x = Math.min(...corners.map(point => point.x)), y = Math.min(...corners.map(point => point.y))
      return [{ ...item, x, y,
        width: Math.max(...corners.map(point => point.x)) - x,
        height: Math.max(...corners.map(point => point.y)) - y }]
    }
    catch (problem) {
      error ??= problem instanceof Error ? problem.message : '此组件的专业数据无法读取。'
      return []
    }
  })
  const selectedInstance = selectedInstances.length === 1 ? selectedInstances[0]! : null
  let container = project && selectedInstance ? owningContainer(project, selectedInstance.id) : null
  while (project && container?.kind === 'instance') container = owningContainer(project, container.instanceId)
  const surface = project ? (selectedInstance ? componentContainerForInstance(project, selectedInstance.id) : undefined)
    ?? componentContainers(project).find(surface => surface.id === view.surfaceId) ?? null : null
  const result: PropertiesOwnerReadModel = {
    documentId: view.activeDocumentId,
    rootInstanceId: view.rootInstanceId ?? null,
    epoch: view.snapshot?.epoch ?? null,
    activeStateId: surface?.id === view.surfaceId ? view.activeStateId : view.presentationStates?.[surface?.id ?? ''] ?? null,
    editingGlobal,
    project,
    baseProject: view.project,
    surface,
    selectedInstanceIds: view.selectedInstanceIds,
    selectedInstances,
    selectedViews,
    selectedInstance,
    selectedView: selectedViews.length === 1 ? selectedViews[0]! : null,
    selectedIsGlobal: container?.kind === 'global',
    selectedField,
    resources,
    error,
  }
  cache.set(cacheKey, { inputs, read: result })
  return result
}
