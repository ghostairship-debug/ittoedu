import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { StrictMode } from 'react'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { CourseV10RuntimeView, type CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import { FlowWorkspaceConnector } from '../../src/renderer/ui/workspaces/FlowWorkspaceConnector'
import { SlideWorkspaceConnector } from '../../src/renderer/ui/workspaces/SlideWorkspaceConnector'
import { SpatialWorkspaceConnector } from '../../src/renderer/ui/workspaces/SpatialWorkspaceConnector'
import { projectWithSlideContentDraft } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { componentSurface, resolveComponentPresentation } from '../../src/shared/contracts/component-platform'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

/** Actual Main/Store/Bridge and workspace connectors; no layout imitation. */
export async function mountCurrentCourseBrowserHarness(host: HTMLElement, api: DocumentHostAPI, strictMode = false) {
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
    const kind = componentSurface(renderProject, document.surfaceId ?? '')?.kind
    return <CourseV10RuntimeView documentId={document.documentId} model={document.model} surfaceId={document.surfaceId}
      activeStateId={document.activeStateId} selectedInstanceId={document.selectedInstanceId} selectedInstanceIds={document.selectedInstanceIds}
      player={false} renderProject={renderProject} bridge={bridge} report={message => errors.push(message)}
      onSelect={id => bridge.selectInstances(document.documentId, id ? [id] : [])}
      onSelectInstances={(ids, surfaceId) => bridge.selectInstances(document.documentId, ids, surfaceId)}
      onSurfaceSelect={id => bridge.selectSurface(document.documentId, id)}
      renderWorkspace={ports => {
        runtime = ports
        if (kind === 'slide') return <SlideWorkspaceConnector onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null} />
        if (kind === 'spatial') return <SpatialWorkspaceConnector onSelectImageAsset={async () => null} />
        return <FlowWorkspaceConnector onSelectImageAsset={async () => null} />
      }} />
  }
  flushSync(() => root.render(strictMode ? <StrictMode><View /></StrictMode> : <View />))
  return { get runtime() { if (!runtime) throw new Error('Current Flow runtime missing'); return runtime }, errors, async dispose() {
    flushSync(() => root.unmount()); if (runtime) await runtime.world.dispose(); useEditorStore.getState().courseBridge.dispose()
  } }
}

export { useEditorStore }
