import '../../src/renderer/styles/variables.css'
import '../../src/renderer/styles/globals.css'
import { mountCurrentCourseBrowserHarness } from './currentFlowBrowserHarness'
import { createV10StoreHost } from './courseV10StoreHost'
import { createCourseProjectContent } from '../../src/renderer/store/slices/courseLifecycleSlice'
import { useEditorStore } from '../../src/renderer/store/editorStore'

/** Isolated author workspace: real runtime, document Session, archive and observer; no desktop app. */
export async function mountFlowManualFeedback(host: HTMLElement, readingWidth = 900, missingDesignSize = true) {
  const { project, resources } = createCourseProjectContent('flow')
  const surface = project.surfaces[0]
  surface.flow!.layout.readingWidth = readingWidth
  surface.flow!.layout.wideContentWidth = readingWidth
  if (missingDesignSize) delete surface.designSize
  const teacherId = project.global.overlay[0]
  project.instances[teacherId].data = { ...project.instances[teacherId].data as object, defaultCollapsed: false }
  const transport = await createV10StoreHost(project, resources, false)
  const mounted = await mountCurrentCourseBrowserHarness(host, transport.api)
  useEditorStore.getState().courseBridge.selectInstances(transport.first.documentId, [teacherId], surface.id)
  return {
    teacherId, errors: mounted.errors,
    read: () => ({ project: transport.model().project, operations: transport.operations }),
    async save() {
      await transport.api.save(transport.first.documentId, 'feedback.glx')
      return transport.driver.load(transport.disk.get('feedback.glx')!)
    },
    async undo() { await useEditorStore.getState().courseBridge.undo(transport.first.documentId) },
    async redo() { await useEditorStore.getState().courseBridge.redo(transport.first.documentId) },
    dispose: mounted.dispose,
  }
}
