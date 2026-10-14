import '../../src/renderer/styles/variables.css'
import '../../src/renderer/styles/globals.css'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { CourseV10RuntimeView, type CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import { SpatialWorkspaceConnector } from '../../src/renderer/ui/workspaces/SpatialWorkspaceConnector'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'
import { createV10StoreHost } from './courseV10StoreHost'
import { buttonNavigationProject } from './buttonNavigationProject'

export async function mountSpatialButtonNavigationProperties(stage: HTMLElement, properties: HTMLElement) {
  const host = await createV10StoreHost(buttonNavigationProject(), undefined, false)
  await useEditorStore.getState().connectCourseDocuments(host.api)
  useEditorStore.getState().setCanvasMode('edit')
  let runtime: CourseV10RuntimePorts | undefined
  const errors: string[] = [], viewRoot = createRoot(stage), propsRoot = createRoot(properties)
  function View() {
    const view = useEditorStore(state => state.courseView), bridge = useEditorStore(state => state.courseBridge)
    const document = view.views.find(item => item.documentId === view.activeDocumentId)
    if (!document) return null
    return <CourseV10RuntimeView documentId={document.documentId} model={document.model} surfaceId={document.surfaceId}
      activeStateId={document.activeStateId} selectedInstanceId={document.selectedInstanceId} selectedInstanceIds={document.selectedInstanceIds}
      player={false} bridge={bridge} report={message => errors.push(message)}
      onSelect={id => bridge.selectInstances(document.documentId, id ? [id] : [])}
      onSelectInstances={(ids, id) => bridge.selectInstances(document.documentId, ids, id)}
      onSurfaceSelect={id => bridge.selectSurface(document.documentId, id)}
      renderWorkspace={ports => { runtime = ports; return <SpatialWorkspaceConnector /> }} />
  }
  flushSync(() => { viewRoot.render(<View />); propsRoot.render(<PropertiesTab onReplaceImage={() => {}} />) })
  return {
    select: (id: string) => useEditorStore.getState().selectNode(id),
    teacherId: host.model().project.global.overlay[0],
    read() { const view = useEditorStore.getState().courseView; return { surface: view.surfaceId, revision: host.first.read().revision,
      camera: useEditorStore.getState().readSpatialView(view.surfaceId!, host.first.documentId).camera,
      playing: runtime!.world.isPlaying(), project: host.model().project, operations: host.operations, errors } },
    mode: (mode: 'edit' | 'run') => useEditorStore.getState().setCanvasMode(mode),
    navigate: (action: Parameters<CourseV10RuntimePorts['navigation']['execute']>[0]) => runtime!.navigation.execute(action),
    click: () => runtime!.world.targetElement('button')!.click(),
    clickTeacher() { const id = host.model().project.global.overlay[0], buttonId = (host.model().project.instances[id].data as any).buttons[0].id;
      const element = runtime!.world.targetElement(id)!
      if (!element.querySelector(`[data-controller-button-id="${buttonId}"]`)) element.querySelector<HTMLButtonElement>('[data-control="collapse"]')!.click()
      element.querySelector<HTMLButtonElement>(`[data-controller-button-id="${buttonId}"]`)!.click() },
    async dispose() { flushSync(() => { viewRoot.unmount(); propsRoot.unmount() }); if (runtime) await runtime.world.dispose(); useEditorStore.getState().courseBridge.dispose() },
  }
}
