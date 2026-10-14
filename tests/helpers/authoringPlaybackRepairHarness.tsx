import '../../src/renderer/styles/variables.css'
import '../../src/renderer/styles/globals.css'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { courseDeliverySnapshot } from '../../src/renderer/app/courseDeliverySnapshot'
import { useCourseDelivery, type CourseDeliveryApi, type CourseDeliveryPorts } from '../../src/renderer/app/useCourseDelivery'
import { CoursePreviewNotices } from '../../src/renderer/app/CoursePreviewNotices'

export function mountAuthoringPlaybackRepair(root: HTMLElement) {
  const project = createBlankCourseProjectV10('播放链路回归')
  project.global.overlay = []; project.instances = {}; project.definitions = {}
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  project.definitions.failed = { id: 'failed', role: 'content', implementation: { kind: 'builtin', key: 'missing-fixture-implementation' } }
  project.instances.dynamic = { id: 'dynamic', definitionId: 'web', frame: { width: 500, height: 200, transform: [1, 0, 0, 1, 100, 80] },
    data: { html: '<button id="act">开始实验</button><div id="result"></div><script>let count=0;document.querySelector("#act").onclick=()=>{document.querySelector("#result").innerHTML="结果 "+(++count)};</script>' } }
  project.instances.failed = { id: 'failed', definitionId: 'failed', data: {}, frame: { width: 200, height: 160, transform: [1, 0, 0, 1, 700, 80] } }
  project.surfaces[0].childIds = ['dynamic', 'failed']
  const snapshot: DocumentSnapshot = { documentId: 'fixture', epoch: 'fixture', revision: 0, binding: { kind: 'untitled', suggestedName: '回归.glx' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } }, dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  let delivery!: CourseDeliveryApi
  const ports: CourseDeliveryPorts = { captureSnapshot: async () => courseDeliverySnapshot(structuredClone(snapshot)), readCanonicalSnapshot: () => courseDeliverySnapshot(snapshot),
    compileComponent: async () => { throw new Error('该样本没有源码编译请求') }, runBusy: async work => work(), commitStatus() {}, reportError() {}, navigateFinding() {},
    exportHtml: async () => null, exportWebPackage: async () => null, exportPdf: async () => null, exportBinary: async () => null }
  function View() {
    delivery = useCourseDelivery(ports, { documentTrigger: null, sidecarTrigger: null, componentPackagesTrigger: null })
    return <>{!delivery.previewOpen ? <button onClick={delivery.openPreview}>整课预览</button> : <section className="course-preview-shell">
      <header className="course-preview-chrome"><button onClick={delivery.closePreview}>关闭预览</button><CoursePreviewNotices messages={delivery.previewDiagnostics} /></header>
      <div className="course-preview-viewport"><div ref={delivery.bindPreviewHost} className="course-preview-host" />
        {delivery.previewFeedback && <div className={`runtime-preview-loading runtime-preview-loading--${delivery.previewFeedback.kind}`} data-testid="course-preview-feedback">
          {delivery.previewFeedback.title}: {delivery.previewFeedback.message}</div>}
      </div></section>}</>
  }
  const view = createRoot(root); flushSync(() => view.render(<View />))
  return { read: () => ({ feedback: delivery.previewFeedback, diagnostics: delivery.previewDiagnostics }),
    invalidate() { project.surfaces[0].childIds.push('missing-object') }, dispose: () => flushSync(() => view.unmount()) }
}
