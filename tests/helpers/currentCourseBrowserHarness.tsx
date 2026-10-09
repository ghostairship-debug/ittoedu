import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { CourseV10RuntimeView, type CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import { SlideWorkspaceConnector } from '../../src/renderer/ui/workspaces/SlideWorkspaceConnector'
import { projectWithSlideContentDraft } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { resolveComponentPresentation } from '../../src/shared/contracts/component-platform'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import { mountV10Model } from '../../src/player/componentPlatform/ModelPlayer'

export { useEditorStore, mountV10Model }
export { ComponentRuntimeHost } from '../../src/player/components/runtime/ComponentRuntimeHost'
export { textRuntimeImplementation } from '../../src/components/text/runtime'
/** Main owns every read/dispatch; the real Store, Bridge, editor slice and Runtime project it. */
export async function mountCurrentCourseBrowserHarness(host: HTMLElement, api: DocumentHostAPI) {
  await useEditorStore.getState().connectCourseDocuments(api)
  const root = createRoot(host), errors: string[] = []
  let runtime: CourseV10RuntimePorts | undefined
  function View() {
    const view = useEditorStore(state => state.courseView), bridge = useEditorStore(state => state.courseBridge)
    const draft = useEditorStore(state => state.slideContentEdit)
    const document = view.views.find(value => value.documentId === view.activeDocumentId)
    if (!document) return null
    const epoch = view.documents.find(value => value.documentId === document.documentId)?.epoch
    const renderProject = projectWithSlideContentDraft(resolveComponentPresentation(document.model.project, document.surfaceId, document.activeStateId), draft,
      { documentId: document.documentId, epoch, surfaceId: document.surfaceId, activeStateId: document.activeStateId })
    return <CourseV10RuntimeView documentId={document.documentId} model={document.model} surfaceId={document.surfaceId} activeStateId={document.activeStateId}
      selectedInstanceId={document.selectedInstanceId} selectedInstanceIds={document.selectedInstanceIds} player={false} renderProject={renderProject} bridge={bridge}
      report={message => errors.push(message)} onSelect={id => bridge.selectInstances(document.documentId, id ? [id] : [])}
      onSelectInstances={(ids, surfaceId) => bridge.selectInstances(document.documentId, ids, surfaceId)} onSurfaceSelect={id => bridge.selectSurface(document.documentId, id)}
      renderWorkspace={ports => { runtime = ports; return <SlideWorkspaceConnector onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null} /> }} />
  }
  flushSync(() => root.render(<View />))
  return { get runtime() { if (!runtime) throw new Error('Current course runtime missing'); return runtime }, errors,
    async dispose() { flushSync(() => root.unmount()); if (runtime) await runtime.world.dispose(); useEditorStore.getState().courseBridge.dispose() } }
}
