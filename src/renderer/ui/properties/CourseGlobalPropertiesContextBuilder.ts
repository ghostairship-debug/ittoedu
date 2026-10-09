import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import { owningContainer } from '../../../shared/contracts/component-platform/project'
import { propertiesEffectiveBackground } from './componentProperties'
import { readTeacherControllerConfig } from '../../../shared/teacherControllerConfig'
import { projectDesignTokensSchema } from '../../../shared/contracts/design-v1/schema'
import type { PropertiesOwnerReadModel } from '../../composition/properties/PropertiesAuthoringReadModel'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { BackgroundPreviewTarget } from '../../authoring/backgroundPreview'
import type { SlideNativePropertiesContext } from './SlideNativePropertiesPanel'
import type { CourseGlobalPropertiesContext } from './CourseGlobalPropertiesPanel'
import { courseSettingsEdits, surfaceSettingsEdits, defaultCoursePlayback as defaults } from '../../../core/course/courseSemanticEdits'
import { courseGlobalPlacementEdits } from '../../../core/course/courseObjectEdits'
export { globalVisibilityAtSurface } from '../../../core/course/courseSemanticEdits'
export function buildCourseGlobalPropertiesOwner(input: {
  read: PropertiesOwnerReadModel; selectedContext: SlideNativePropertiesContext | null; assets: Record<string, AssetMeta>; key: string
  liveTarget(): CapturedCourseTarget
  submit(edits: ComponentEdit[], target?: CapturedCourseTarget): void
  preview(edits: ComponentEdit[] | null, owner?: BackgroundPreviewTarget['owner']): void
  ensureTeacherController(): Promise<void>
  editSource(): void; openAutomation(): void; report(error: unknown): void
}): CourseGlobalPropertiesContext | null {
  const { read, liveTarget, submit, report } = input
  if (!read.project || (!read.selectedIsGlobal && !(read.editingGlobal && !read.selectedInstanceIds.length))) return null
  const project = read.project, selected = read.selectedInstance, native = input.selectedContext
  const definition = selected ? project.definitions[selected.definitionId] : undefined
  const controller = definition?.implementation.kind === 'builtin' && definition.implementation.key === 'guoling.navigation'
  let container = selected ? owningContainer(project, selected.id) : null
  while (container?.kind === 'instance') container = owningContainer(project, container.instanceId)
  const visibility = selected?.visibility ?? { mode: 'all' as const, surfaceIds: [] }
  const scopeVisible = read.surface ? visibility.mode === 'all' || (visibility.mode === 'include' ? visibility.surfaceIds.includes(read.surface.id) : !visibility.surfaceIds.includes(read.surface.id)) : true
  const run = (action: () => unknown) => { try { void Promise.resolve(action()).catch(report) } catch (error) { report(error) } }
  return { kind: 'course-global', draftBindingKey: input.key, mode: selected ? 'selected' : 'empty', native,
    disabledReason: read.error, flowOrSpatial: read.surface?.kind !== 'slide', editingScopeGlobal: true,
    empty: selected ? null : { globalLayerCount: project.global.underlay.length + project.global.overlay.length,
      underlayCount: project.global.underlay.length, overlayCount: project.global.overlay.length,
      runtimeAvailable: [...project.global.underlay, ...project.global.overlay].some(id => (project.instances[id]?.implementationOverride ?? project.definitions[project.instances[id]?.definitionId ?? '']?.implementation)?.kind === 'source'),
      playback: project.playback ?? defaults, hasTeacherController: Object.values(project.instances).some(instance => instance.definitionId === 'guoling.navigation'),
      designTokens: project.designTokens ?? projectDesignTokensSchema.parse(undefined),
      background: { color: project.background?.color, assetId: project.background?.assetId,
        effective: propertiesEffectiveBackground(project), assets: input.assets },
      canvas: read.surface?.kind === 'slide' ? read.surface.designSize ?? { width: 1280, height: 720 } : null,
      ...(read.surface?.kind === 'slide' ? { canvasScope: { currentSurfaceId: read.surface.id,
        pages: project.surfaces.filter(surface => surface.kind === 'slide').map(surface => ({ id: surface.id, label: surface.title })) } } : {}) },
    layer: selected ? { nodeId: selected.id, visibleHere: scopeVisible, visibility: { mode: visibility.mode, locationIds: visibility.surfaceIds },
      scenePlane: container?.kind === 'global' ? container.plane : 'overlay', isController: controller, locationKind: read.surface?.kind,
      locations: project.surfaces.map(surface => ({ id: surface.id, label: surface.title })) } : null,
    selected: selected && native ? { view: native.view, notices: native.notices, contentEditingEnabled: true, spatialMode: native.spatialMode,
      videoDiagnostics: [], controller: controller && native.view.type === 'external-component' ? readTeacherControllerConfig(native.view.props) : null,
      controllerComponent: controller, controllerScenes: project.surfaces.map(surface => ({ id: surface.id, name: surface.title,
        presentation: surface.presentation ? { states: surface.presentation.states.map(state => ({ id: state.id, name: state.title })) } : undefined })), component: native.component } : null,
    runtime: native?.runtime ?? null, interaction: null,
    commands: { patch: native?.commands.patch ?? (() => {}), preview: native?.commands.preview, replaceImage: native?.commands.replaceImage ?? (() => {}),
      clearPresentationOverride: native?.commands.clearPresentationOverride ?? (() => {}), text: native?.commands.text ?? { beginEdit() {}, commitEdit() {}, cancelEdit() {}, updateDraft() {}, toggleStyle() {} },
      updateCourseBackground: value => run(() => { const target = liveTarget(); submit(courseSettingsEdits(target.project, { background: {
        ...(value.backgroundColor === undefined ? {} : { color: value.backgroundColor }), ...(value.backgroundAssetId === undefined ? {} : { assetId: value.backgroundAssetId }) } }), target) }),
      previewCourseBackground: value => run(() => input.preview(value.backgroundColor == null ? null : [{ type: 'project.background.set', background: { ...project.background, color: value.backgroundColor } }], 'project')),
      resizeSlideCanvas: (designSize, options = {}) => run(() => {
        const captured = liveTarget(), target = { ...captured, activeStateId: null, editingProject: captured.project }
        if (!target.surfaceId) return
        return submit(surfaceSettingsEdits(target.project, target.surfaceId, { resize: { ...options, designSize } }), target)
      }),
      updatePlayback: value => run(() => { const target = liveTarget(); submit(courseSettingsEdits(target.project, { playback: value }), target) }),
      ensureTeacherController: () => run(async () => { const target = liveTarget(); await input.ensureTeacherController(); submit(courseSettingsEdits(target.project, { playback: { controls: 'canvas' } }), target) }),
      manageTeacherControllerComponent: (id, _operation) => run(() => submit([{ type: 'implementation.set', instanceId: id, implementation: null }])),
      editControllerSource: input.editSource,
      updateDesignTokens: designTokens => run(() => { const target = liveTarget(); submit(courseSettingsEdits(target.project, { designTokens }), target) }),
      setVisibleAtLocation: (id, visible) => run(() => { const target = liveTarget(); if (!target.surfaceId) return;
        submit(courseGlobalPlacementEdits(target.project, id, { atSurface: { surfaceId: target.surfaceId, visible } }), target)
      }),
      setLocationVisibility: (id, value) => run(() => { const target = liveTarget(); submit(courseGlobalPlacementEdits(target.project, id, { visibility: { mode: value.mode, surfaceIds: value.locationIds } }), target) }),
      updateLayerSettings: (id, value) => run(() => { const target = liveTarget(); submit(courseGlobalPlacementEdits(target.project, id, { plane: value.layer }), target) }),
      openProfessionalAutomation: input.openAutomation,
    }, onFeedback: value => { if (value.kind === 'error') report(value.message) } }
}
