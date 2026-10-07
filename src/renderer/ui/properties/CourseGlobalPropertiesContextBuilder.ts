import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import { owningContainer } from '../../../shared/contracts/component-platform/project'
import { propertiesEffectiveBackground } from './componentProperties'
import { readTeacherControllerConfig } from '../../../shared/teacherControllerConfig'
import { projectDesignTokensSchema } from '../../../shared/contracts/design-v1/schema'
import type { ProjectPlaybackSettings } from '../../../shared/contracts/playback-v1'
import type { PropertiesOwnerReadModel } from '../../composition/properties/PropertiesAuthoringReadModel'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { BackgroundPreviewTarget } from '../../authoring/backgroundPreview'
import type { SlideNativePropertiesContext } from './SlideNativePropertiesPanel'
import type { CourseGlobalPropertiesContext } from './CourseGlobalPropertiesPanel'
import { componentParentMatrix } from '../../composition/crossSurfaceCommands'
import { reparentFrame, IDENTITY_MATRIX } from '../../../core/components/geometry'
import { resizeComponentSurfacesEdits } from '../../../core/drivers/courseV10Operations'
const defaults: ProjectPlaybackSettings = { controls: 'none', keyboardNavigation: true, presenter: { enabled: false, strategy: 'scene-navigation', additionalBindings: [] } }
/** Editing one page preserves an include list's restriction on future pages. */
export function globalVisibilityAtSurface(current: NonNullable<import('../../../shared/contracts/component-platform/project').ComponentInstance['visibility']>, surfaceId: string, visible: boolean) {
  const ids = new Set(current.mode === 'all' ? [] : current.surfaceIds)
  if (current.mode === 'include') {
    if (visible) ids.add(surfaceId); else ids.delete(surfaceId)
    return { mode: 'include' as const, surfaceIds: [...ids] }
  }
  if (visible) ids.delete(surfaceId); else ids.add(surfaceId)
  return { mode: ids.size ? 'exclude' as const : 'all' as const, surfaceIds: [...ids] }
}
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
      updateCourseBackground: value => run(() => { const target = liveTarget(); submit([{ type: 'project.background.set', background: { ...target.project.background,
        ...(value.backgroundColor === undefined ? {} : { color: value.backgroundColor }), ...(value.backgroundAssetId === undefined ? {} : { assetId: value.backgroundAssetId }) } }], target) }),
      previewCourseBackground: value => run(() => input.preview(value.backgroundColor == null ? null : [{ type: 'project.background.set', background: { ...project.background, color: value.backgroundColor } }], 'project')),
      resizeSlideCanvas: (designSize, options = {}) => run(() => {
        const captured = liveTarget(), target = { ...captured, activeStateId: null, editingProject: captured.project }
        if (!target.surfaceId) return
        return submit(resizeComponentSurfacesEdits(target.project, { surfaceIds: options.surfaceIds ?? [target.surfaceId], designSize,
          mode: options.mode ?? 'preserve', ...(options.mode === 'contain' && options.includeGlobal ? { globalReferenceSurfaceId: target.surfaceId } : {}) }), target)
      }),
      updatePlayback: value => run(() => { const target = liveTarget(); submit([{ type: 'project.playback.set', playback: { ...defaults, ...target.project.playback, ...value } }], target) }),
      ensureTeacherController: () => run(async () => { const target = liveTarget(); await input.ensureTeacherController(); submit([{ type: 'project.playback.set', playback: { ...defaults, ...target.project.playback, controls: 'canvas' } }], target) }),
      manageTeacherControllerComponent: (id, _operation) => run(() => submit([{ type: 'implementation.set', instanceId: id, implementation: null }])),
      editControllerSource: input.editSource,
      updateDesignTokens: designTokens => run(() => submit([{ type: 'project.designTokens.set', designTokens }])),
      setVisibleAtLocation: (id, visible) => run(() => { const target = liveTarget(); if (!target.surfaceId) return;
        const current = target.project.instances[id]?.visibility ?? { mode: 'all' as const, surfaceIds: [] }
        submit([{ type: 'instance.patch', instanceId: id, patch: { visibility: globalVisibilityAtSurface(current, target.surfaceId, visible) } }], target)
      }),
      setLocationVisibility: (id, value) => run(() => submit([{ type: 'instance.patch', instanceId: id, patch: { visibility: { mode: value.mode, surfaceIds: value.locationIds } } }])),
      updateLayerSettings: (id, value) => run(() => { const target = liveTarget(), frame = target.project.instances[id]?.frame; submit([{ type: 'instance.move', instanceId: id, container: { kind: 'global', plane: value.layer },
        index: target.project.global[value.layer].filter(value => value !== id).length,
        ...(frame ? { frame: reparentFrame(frame, componentParentMatrix(target.project, id), IDENTITY_MATRIX) } : {}) }], target) }),
      openProfessionalAutomation: input.openAutomation,
    }, onFeedback: value => { if (value.kind === 'error') report(value.message) } }
}
