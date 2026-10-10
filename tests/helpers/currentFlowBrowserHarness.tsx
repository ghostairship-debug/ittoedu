import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { CourseV10RuntimeView, type CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import { FlowWorkspaceConnector } from '../../src/renderer/ui/workspaces/FlowWorkspaceConnector'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

/** Actual Main/Store/Bridge, FlowWorkspace and SharedDocumentEditor; no layout imitation. */
export async function mountCurrentCourseBrowserHarness(host: HTMLElement, api: DocumentHostAPI) {
  await useEditorStore.getState().connectCourseDocuments(api)
  const root = createRoot(host), errors: string[] = []
  let runtime: CourseV10RuntimePorts | undefined
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
      renderWorkspace={ports => { runtime = ports; return <FlowWorkspaceConnector onSelectImageAsset={async () => null} /> }} />
  }
  flushSync(() => root.render(<View />))
  return { errors, async dispose() {
    flushSync(() => root.unmount()); if (runtime) await runtime.world.dispose(); useEditorStore.getState().courseBridge.dispose()
  } }
}
