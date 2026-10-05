import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../../store/editorStoreKernel'
import type { PropertiesOwnerReadModel } from '../../composition/properties/PropertiesAuthoringReadModel'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { SpatialPropertiesContext } from './SpatialPropertiesPanel'
import type { createSpatialAuthoringSlice } from '../../store/slices/spatialAuthoringSlice'
import { propertiesEffectiveBackground } from './componentProperties'

export function buildSpatialPropertiesOwner(input: {
  read: PropertiesOwnerReadModel
  kernel: EditorStoreKernel
  actions: Pick<ReturnType<typeof createSpatialAuthoringSlice>,
    'readSpatialView' | 'setSpatialShowCameraFrames' | 'addSpatialCameraFrameFromSession' | 'renameSpatialCameraFrame'
    | 'updateSpatialCameraFrameTarget' | 'reorderSpatialCameraFrames' | 'deleteSpatialCameraFrame' | 'setSpatialCameraHomeFromSession'
    | 'updateActiveSpatialCameraFrameFromSession' | 'activateSpatialCameraFrame' | 'fitSpatialSessionToWorldContent'
    | 'setSpatialPlaybackPathId' | 'addSpatialSemanticZoomRule' | 'updateSpatialSemanticZoomRule' | 'deleteSpatialSemanticZoomRule'
    | 'addSpatialPath' | 'updateSpatialPath' | 'deleteSpatialPath' | 'addSpatialRelation' | 'updateSpatialRelation' | 'deleteSpatialRelation'>
  assets: Readonly<Record<string, AssetMeta>>
  liveTarget(): CapturedCourseTarget
  submit(edits: ComponentEdit[], target?: CapturedCourseTarget): void
  report(error: unknown): void
  preview(edits: ComponentEdit[] | null, owner?: 'surface' | 'instance'): void
}): SpatialPropertiesContext | null {
  const { read, actions } = input
  const surface = read.surface
  if (surface?.kind !== 'spatial' || !read.documentId || !read.project) return null
  const view = actions.readSpatialView(surface.id, read.documentId)
  const spatial = surface.spatial ?? { home: { x: 0, y: 0, zoom: 1 }, frames: [] }
  const binding = JSON.stringify([read.documentId, read.epoch, surface.id, read.activeStateId])
  const run = (action: () => unknown) => { try { input.liveTarget(); void Promise.resolve(action()).catch(input.report) } catch (error) { input.report(error) } }
  const create = async (action: (target: CapturedCourseTarget) => unknown) => {
    try { return await action(input.liveTarget()) }
    catch (error) { input.report(error); throw error }
  }
  const patchBackground: SpatialPropertiesContext['commands']['updateBackground'] = patch => run(() => {
    const target = input.liveTarget(), current = target.project.surfaces.find(value => value.id === surface.id)?.background
    input.submit([{ type: 'surface.background.set', surfaceId: surface.id, background: { ...current,
      ...(patch.backgroundMode === undefined ? {} : { mode: patch.backgroundMode }),
      ...(patch.backgroundColor === undefined ? {} : { color: patch.backgroundColor, mode: 'own' }),
      ...(patch.backgroundAssetId === undefined ? {} : { assetId: patch.backgroundAssetId, mode: 'own' }),
    } }], target)
  })
  const ids = (roots: readonly string[]): string[] => roots.flatMap(id => [id, ...ids(read.project!.instances[id]?.childIds ?? [])])
  return {
    kind: view.graphSelection ? 'spatial-graph' : 'spatial-page',
    view: { surfaceId: surface.id, surfaceTitle: surface.title, spatial,
      backgroundMode: surface.background?.mode ?? 'inherit', backgroundColor: surface.background?.color,
      effectiveBackground: propertiesEffectiveBackground(read.project, surface),
      backgroundAssetId: surface.background?.assetId, worldInstances: ids(surface.childIds).map(id => read.project!.instances[id]).filter(Boolean) },
    course: { backgroundColor: read.project.background?.color, backgroundAssetId: read.project.background?.assetId },
    assets: input.assets, sessionCamera: view.camera, showCameraFrames: view.showCameraFrames, activeCameraFrameId: view.activeCameraFrameId, playbackPathId: view.playbackPathId,
    selectedPathId: view.graphSelection?.kind === 'path' ? view.graphSelection.id : null,
    selectedRelationId: view.graphSelection?.kind === 'relation' ? view.graphSelection.id : null,
    draftBindings: { surface: binding,
      cameraFrames: new Map(spatial.frames.map(frame => [frame.id, `${binding}:frame:${frame.id}`])),
      paths: new Map((spatial.paths ?? []).map(path => [path.id, `${binding}:path:${path.id}`])),
      relations: new Map((spatial.relations ?? []).map(relation => [relation.id, `${binding}:relation:${relation.id}`])),
      semanticRules: new Map((spatial.semanticZoom ?? []).map(rule => [rule.id, `${binding}:rule:${rule.id}`])) },
    commands: {
      setBackgroundColor: backgroundColor => patchBackground({ backgroundColor }), updateBackground: patchBackground,
      previewBackground: patch => run(() => input.preview(patch.backgroundColor == null ? null : [
        { type: 'surface.background.set', surfaceId: surface.id, background: { ...surface.background, mode: 'own', color: patch.backgroundColor } }], 'surface')),
      setShowCameraFrames: show => actions.setSpatialShowCameraFrames(show, surface.id),
      addCameraFrame: () => run(() => actions.addSpatialCameraFrameFromSession(surface.id, input.liveTarget())),
      renameCameraFrame: (frameId, title) => run(() => actions.renameSpatialCameraFrame(surface.id, frameId, title, input.liveTarget())),
      updateCameraFrameTarget: (frameId, instanceId) => run(() => actions.updateSpatialCameraFrameTarget(surface.id, frameId, instanceId, input.liveTarget())),
      reorderCameraFrame: (frameId, toIndex) => run(() => {
        const target = input.liveTarget(), values = [...(target.project.surfaces.find(value => value.id === surface.id)?.spatial?.frames ?? [])].map(frame => frame.id)
        const from = values.indexOf(frameId)
        if (from >= 0) { values.splice(from, 1); values.splice(Math.max(0, Math.min(toIndex, values.length)), 0, frameId) }
        return actions.reorderSpatialCameraFrames(surface.id, values, target)
      }),
      deleteCameraFrame: frameId => run(() => actions.deleteSpatialCameraFrame(surface.id, frameId, input.liveTarget())),
      setHome: () => run(() => actions.setSpatialCameraHomeFromSession(surface.id, input.liveTarget())),
      updateActiveFromSession: () => run(() => actions.updateActiveSpatialCameraFrameFromSession(surface.id, input.liveTarget())),
      activateFrame: frameId => actions.activateSpatialCameraFrame(surface.id, frameId),
      fitWorldContent: () => actions.fitSpatialSessionToWorldContent(undefined, surface.id),
      setPlaybackPathId: pathId => actions.setSpatialPlaybackPathId(pathId, surface.id),
      addSemanticZoomRule: rule => run(() => actions.addSpatialSemanticZoomRule(surface.id, rule)),
      updateSemanticZoomRule: (ruleId, patch) => run(() => actions.updateSpatialSemanticZoomRule(surface.id, ruleId, patch, input.liveTarget())),
      deleteSemanticZoomRule: ruleId => run(() => actions.deleteSpatialSemanticZoomRule(surface.id, ruleId, input.liveTarget())),
      addPath: path => create(target => actions.addSpatialPath(surface.id, path, target)),
      renamePath: (pathId, title) => run(() => actions.updateSpatialPath(surface.id, pathId, { title }, input.liveTarget())),
      updatePathStyle: (pathId, style) => run(() => actions.updateSpatialPath(surface.id, pathId, { style }, input.liveTarget())),
      reorderPathWaypoints: (pathId, instanceIds) => run(() => actions.updateSpatialPath(surface.id, pathId, { instanceIds, frameIds: [] }, input.liveTarget())),
      reorderPathFrames: (pathId, frameIds) => run(() => actions.updateSpatialPath(surface.id, pathId, { frameIds, instanceIds: [] }, input.liveTarget())),
      deletePath: pathId => run(() => actions.deleteSpatialPath(surface.id, pathId, input.liveTarget())),
      addRelation: relation => create(target => actions.addSpatialRelation(surface.id, relation, target)),
      updateRelationLabel: (relationId, label) => run(() => actions.updateSpatialRelation(surface.id, relationId, { label }, input.liveTarget())),
      updateRelationKind: (relationId, kind) => run(() => actions.updateSpatialRelation(surface.id, relationId, { kind }, input.liveTarget())),
      deleteRelation: relationId => run(() => actions.deleteSpatialRelation(surface.id, relationId, input.liveTarget())), reportError: input.report,
    },
  }
}
