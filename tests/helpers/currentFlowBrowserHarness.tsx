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
import { useMediaImport, type MediaImportPorts } from '../../src/renderer/app/useMediaImport'
import { CourseEditorActionsContext } from '../../src/renderer/documents/CourseEditorActionsContext'

/** Actual Main/Store/Bridge and workspace connectors; no layout imitation. */
export async function mountCurrentCourseBrowserHarness(host: HTMLElement, api: DocumentHostAPI, strictMode = false,
  options: { selectImage?: MediaImportPorts['selectImage'] } = {}) {
  await useEditorStore.getState().connectCourseDocuments(api)
  const root = createRoot(host), errors: string[] = []
  let runtime: CourseV10RuntimePorts | undefined
  function View() {
    const view = useEditorStore(state => state.courseView), bridge = useEditorStore(state => state.courseBridge)
    const draft = useEditorStore(state => state.slideContentEdit)
    // The browser fixture replaces only the desktop file picker. Native menus,
    // decoding/import, captured selection and the Kernel writer are production owners.
    const media = useMediaImport({ kernel: useEditorStore.getState().courseKernel,
      selectImage: options.selectImage ?? (async () => null), selectImages: async () => null,
      selectAudios: async () => null, selectVideos: async () => null,
      runBusy: async operation => {
        try { return await operation() }
        catch (error) { const message = error instanceof Error ? error.message : String(error); errors.push(message); useEditorStore.getState().setError(message); return undefined }
      }, commitStatus: message => useEditorStore.getState().setStatus(message), reportError: message => { errors.push(message); useEditorStore.getState().setError(message) } })
    const document = view.views.find(value => value.documentId === view.activeDocumentId)
    if (!document) return null
    const epoch = view.documents.find(value => value.documentId === document.documentId)?.epoch
    const renderProject = projectWithSlideContentDraft(resolveComponentPresentation(document.model.project, document.surfaceId, document.activeStateId), draft,
      { documentId: document.documentId, epoch, surfaceId: document.surfaceId, activeStateId: document.activeStateId })
    const kind = componentSurface(renderProject, document.surfaceId ?? '')?.kind
    return <CourseEditorActionsContext.Provider value={options.selectImage ? { replaceImage: () => { void media.selectAndImportImage('replace') } } : null}>
      <CourseV10RuntimeView documentId={document.documentId} model={document.model} surfaceId={document.surfaceId}
      activeStateId={document.activeStateId} selectedInstanceId={document.selectedInstanceId} selectedInstanceIds={document.selectedInstanceIds}
      player={false} renderProject={renderProject} bridge={bridge} report={message => errors.push(message)}
      onSelect={id => bridge.selectInstances(document.documentId, id ? [id] : [])}
      onSelectInstances={(ids, surfaceId) => bridge.selectInstances(document.documentId, ids, surfaceId)}
      onSurfaceSelect={id => bridge.selectSurface(document.documentId, id)}
      renderWorkspace={ports => {
        runtime = ports
        if (kind === 'slide') return <SlideWorkspaceConnector onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={media.selectImageAsset} />
        if (kind === 'spatial') return <SpatialWorkspaceConnector onSelectImageAsset={media.selectImageAsset} />
        return <FlowWorkspaceConnector onSelectImageAsset={media.selectImageAsset} />
      }} />
    </CourseEditorActionsContext.Provider>
  }
  flushSync(() => root.render(strictMode ? <StrictMode><View /></StrictMode> : <View />))
  return { get runtime() { if (!runtime) throw new Error('Current Flow runtime missing'); return runtime }, errors, async dispose() {
    flushSync(() => root.unmount()); if (runtime) await runtime.world.dispose(); useEditorStore.getState().courseBridge.dispose()
  } }
}

export { useEditorStore }
