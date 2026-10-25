import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { CourseV10RuntimeView, type CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import { SlideWorkspaceConnector } from '../../src/renderer/ui/workspaces/SlideWorkspaceConnector'
import { FlowWorkspaceConnector } from '../../src/renderer/ui/workspaces/FlowWorkspaceConnector'
import { SpatialWorkspaceConnector } from '../../src/renderer/ui/workspaces/SpatialWorkspaceConnector'
import { projectWithSlideContentDraft } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { componentSurface, resolveComponentPresentation } from '../../src/shared/contracts/component-platform'
import { CourseEditorActionsContext } from '../../src/renderer/documents/CourseEditorActionsContext'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { replaceCourseImageAtTarget } from '../../src/renderer/media/commitCourseMediaAuthoring'
import type { ImportedImageAsset } from '../../src/renderer/project/assetManager'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

/** Main-owned DocumentSession, the actual Store/Bridge, and unchanged workspace connectors. */
export async function mountImagePanelBrowserHarness(host: HTMLElement, api: DocumentHostAPI, replacement: ImportedImageAsset) {
  await useEditorStore.getState().connectCourseDocuments(api)
  const root = createRoot(host), errors: string[] = []
  let runtime: CourseV10RuntimePorts | undefined, pickerCalls = 0
  const pick = async () => { pickerCalls++; return replacement }
  const actions = { replaceImage: () => {
    const state = useEditorStore.getState(), target = state.courseKernel.captureTarget()
    void pick().then(item => replaceCourseImageAtTarget(state.courseKernel, target, item)).catch(error => errors.push(String(error)))
  } }
  function View() {
    const view = useEditorStore(state => state.courseView), bridge = useEditorStore(state => state.courseBridge)
    const draft = useEditorStore(state => state.slideContentEdit)
    const current = view.views.find(value => value.documentId === view.activeDocumentId)
    if (!current) return null
    const epoch = view.documents.find(value => value.documentId === current.documentId)?.epoch
    const renderProject = projectWithSlideContentDraft(resolveComponentPresentation(current.model.project, current.surfaceId, current.activeStateId), draft,
      { documentId: current.documentId, epoch, surfaceId: current.surfaceId, activeStateId: current.activeStateId })
    const kind = componentSurface(renderProject, current.surfaceId ?? '')?.kind
    return <CourseEditorActionsContext.Provider value={actions}><CourseEditorChromeContext.Provider value={{ documentId: current.documentId, mode: 'deep', setMode() {} }}>
      <CourseV10RuntimeView documentId={current.documentId} model={current.model} surfaceId={current.surfaceId}
        activeStateId={current.activeStateId} selectedInstanceId={current.selectedInstanceId} selectedInstanceIds={current.selectedInstanceIds}
        player={false} renderProject={renderProject} bridge={bridge} report={message => errors.push(message)}
        onSelect={id => bridge.selectInstances(current.documentId, id ? [id] : [])}
        onSelectInstances={(ids, surfaceId) => bridge.selectInstances(current.documentId, ids, surfaceId)}
        onSurfaceSelect={id => bridge.selectSurface(current.documentId, id)}
        renderWorkspace={ports => {
          runtime = ports
          return kind === 'spatial' ? <SpatialWorkspaceConnector onSelectImageAsset={pick} />
            : kind === 'flow' ? <FlowWorkspaceConnector onSelectImageAsset={pick} />
            : <SlideWorkspaceConnector onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={pick} />
        }} />
    </CourseEditorChromeContext.Provider></CourseEditorActionsContext.Provider>
  }
  flushSync(() => root.render(<View />))
  return { errors, get pickerCalls() { return pickerCalls }, async dispose() {
    flushSync(() => root.unmount()); if (runtime) await runtime.world.dispose(); useEditorStore.getState().courseBridge.dispose()
  } }
}
export { useEditorStore }
