import '../../src/renderer/styles/variables.css'
import '../../src/renderer/styles/globals.css'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { createCourseProjectContent } from '../../src/renderer/store/slices/courseLifecycleSlice'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { CourseV10RuntimeView, type CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import { SpatialWorkspaceConnector } from '../../src/renderer/ui/workspaces/SpatialWorkspaceConnector'
import { createV10StoreHost } from './courseV10StoreHost'
import { SHAPE_DEFINITION } from '../../src/components/shape/authoring'
import { defaultShapeData } from '../../src/components/shape/data'
import { componentRuleEdits } from '../../src/shared/componentInteractionData'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { mountPublishedCourseV3 } from '../../src/player/componentPlatform/publishedPlayer'

export async function mountSpatialNavigationFeedback(element: HTMLElement) {
  const snapshot = createCourseProjectContent('spatial'), { project } = snapshot
  project.surfaces[0] = { ...project.surfaces[0], id: 'A', title: 'A', childIds: ['go-last'], spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [
    { id: 'a-first', title: 'A first', pose: { x: 200, y: 0, zoom: 1 } }, { id: 'a-last', title: 'A last', pose: { x: 700, y: 0, zoom: 1 } }] } }
  project.surfaces.push({ id: 'B', title: 'B', kind: 'spatial', childIds: [], designSize: { width: 1280, height: 720 }, spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [
    { id: 'b-first', title: 'B first', pose: { x: 400, y: 0, zoom: 1 } }, { id: 'b-last', title: 'B last', pose: { x: 900, y: 0, zoom: 1 } }] } })
  project.definitions[SHAPE_DEFINITION.id] = SHAPE_DEFINITION
  project.instances['go-last'] = { id: 'go-last', name: 'Go B last', definitionId: SHAPE_DEFINITION.id, data: JSON.parse(JSON.stringify(defaultShapeData())), frame: { width: 100, height: 80, transform: [1, 0, 0, 1, 150, -40] } }
  const driver = new CourseV10Driver()
  const model = driver.apply({ kind: 'course-v10', ...snapshot }, captureComponentOperation(project, componentRuleEdits(project, { kind: 'surface', surfaceId: 'A' }, [
    { id: 'jump', name: 'Jump mirror', enabled: true, trigger: { type: 'node.click', nodeId: 'go-last' }, conditions: [],
      actions: [{ id: 'jump-action', start: 'after-previous', delayMs: 0, action: { type: 'scene.go', sceneId: 'B', targetStateId: 'b-last' } }] },
  ])))
  if (model.kind !== 'course-v10') throw new Error('Expected V10')
  const host = await createV10StoreHost(model.project, model.resources, false)
  await useEditorStore.getState().connectCourseDocuments(host.api)
  useEditorStore.getState().setCanvasMode('edit')
  let runtime: CourseV10RuntimePorts | undefined
  const errors: string[] = [], root = createRoot(element)
  function View() {
    const view = useEditorStore(state => state.courseView), bridge = useEditorStore(state => state.courseBridge)
    const document = view.views.find(value => value.documentId === view.activeDocumentId)
    if (!document) return null
    return <CourseV10RuntimeView documentId={document.documentId} model={document.model} surfaceId={document.surfaceId}
      activeStateId={document.activeStateId} selectedInstanceId={document.selectedInstanceId} selectedInstanceIds={document.selectedInstanceIds}
      player={false} bridge={bridge} report={message => errors.push(message)}
      onSelect={id => bridge.selectInstances(document.documentId, id ? [id] : [])}
      onSelectInstances={(ids, surfaceId) => bridge.selectInstances(document.documentId, ids, surfaceId)}
      onSurfaceSelect={id => bridge.selectSurface(document.documentId, id)}
      renderWorkspace={ports => { runtime = ports; return <SpatialWorkspaceConnector /> }} />
  }
  flushSync(() => root.render(<View />))
  return { project: model.project, errors,
    read() { const state = useEditorStore.getState(), surface = state.courseView.surfaceId!; return { surface, view: state.readSpatialView(surface, host.first.documentId), playing: runtime!.world.isPlaying(), progress: runtime!.navigation.read().progress, project: host.model().project, operations: host.operations } },
    mode: (mode: 'edit' | 'run') => useEditorStore.getState().setCanvasMode(mode),
    free: () => useEditorStore.getState().setSpatialSessionCamera({ x: 999, y: 88, zoom: 1.3 }, 'A', host.first.documentId),
    navigate: (action: Parameters<CourseV10RuntimePorts['navigation']['execute']>[0]) => runtime!.navigation.execute(action),
    click() { runtime!.world.targetElement('go-last')!.click() },
    async publish(container: HTMLElement, options: Parameters<typeof mountPublishedCourseV3>[2] = {}, follow = false) {
      const copy = structuredClone(model.project)
      if (follow) copy.surfaces[0].spatial!.frames[0].targetInstanceId = 'go-last'
      const { revision: _revision, ...payload } = copy
      return mountPublishedCourseV3({ ...payload, schemaVersion: 3, definitions: Object.fromEntries(Object.entries(payload.definitions).map(([id, { dataSchema: _schema, ...definition }]) => [id, definition])) }, container, { keyboardNavigation: false, ...options })
    },
    async dispose() { flushSync(() => root.unmount()); if (runtime) await runtime.world.dispose(); useEditorStore.getState().courseBridge.dispose() },
  }
}
