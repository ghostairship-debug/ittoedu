import '../../src/renderer/styles/variables.css'
import '../../src/renderer/styles/globals.css'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { CourseV10RuntimeView, type CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import { SpatialWorkspaceConnector } from '../../src/renderer/ui/workspaces/SpatialWorkspaceConnector'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createV10StoreHost } from './courseV10StoreHost'
import { mountPublishedCourseV3 } from '../../src/player/componentPlatform/publishedPlayer'
import { mountCompiledCourse } from '../../src/player/componentPlatform/compiledPlayer'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { PublishedCourseV3 } from '../../src/shared/contracts/component-platform/published'
import type { CompiledCoursePlayback } from '../../src/core/publish/componentPlatform/compiledContract'

export async function mountRuntimeDocumentCreation(kind: 'editor' | 'published' | 'compiled', element: HTMLElement,
  input: { model: Extract<DocumentModel, { kind: 'course-v10' }>; payload: PublishedCourseV3; artifact: CompiledCoursePlayback }) {
  const errors: string[] = []
  if (kind !== 'editor') {
    const player = kind === 'compiled' ? await mountCompiledCourse(input.artifact, element, { report: message => errors.push(message), keyboardNavigation: false })
      : await mountPublishedCourseV3(input.payload, element, { report: message => errors.push(message), keyboardNavigation: false })
    return { errors, read: () => player.navigation.read(), playing: () => player.runtime.isPlaying(), next: player.next, previous: player.previous,
      go: player.go, get: (key: string) => player.runtime.getState(key), snapshot: () => player.runtime.stateSnapshot(), dispose: player.dispose }
  }
  // Only compiler transport crosses Playwright; it calls the real Main compiler.
  Reflect.set(window, 'desktopAPI', { compileComponent: (value: unknown) => Reflect.get(window, 'compileForFixture')(value) })
  const host = await createV10StoreHost(input.model.project, input.model.resources, false)
  await useEditorStore.getState().connectCourseDocuments(host.api)
  useEditorStore.getState().setCanvasMode('edit')
  let runtime: CourseV10RuntimePorts | undefined
  const root = createRoot(element)
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
  return { errors, read: () => runtime!.navigation.read(), playing: () => runtime!.world.isPlaying(),
    next: () => runtime!.navigation.execute({ type: 'step.next' }), previous: () => runtime!.navigation.execute({ type: 'step.previous' }),
    go: (id: string) => runtime!.navigation.execute({ type: 'scene.go', sceneId: id }),
    get: (key: string) => runtime!.world.getState(key), snapshot: () => runtime!.world.stateSnapshot(),
    formal: () => ({ project: host.model().project, operations: host.operations }),
    async dispose() { flushSync(() => root.unmount()); await runtime?.world.dispose(); useEditorStore.getState().courseBridge.dispose(); host.bridge.dispose() },
  }
}
