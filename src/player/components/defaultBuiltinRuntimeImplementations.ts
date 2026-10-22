import { textRuntimeImplementation, formulaRuntimeImplementation } from '../../components/text/runtime'
import { createImageRuntimeImplementation } from '../../components/image/runtime'
import { shapeRuntimeImplementation } from '../../components/shape/render'
import { tableRuntimeImplementation } from '../../components/table/runtime'
import { chartRuntimeImplementation } from '../../components/chart/runtime'
import { createTeacherControllerRuntimeImplementation } from '../../components/teacher-controller'
import { inputRuntimeImplementation, feedbackRuntimeImplementation, visibilityRuntimeImplementation } from '../../components/input'
import { choiceRuntimeImplementation } from '../../components/choice'
import { disclosureRuntimeImplementation } from '../../components/disclosure'
import { popoverRuntimeImplementation } from '../../components/popover'
import { documentBlockRuntimeImplementation } from '../../components/document-block'
import type { ComponentRuntimeImplementation, TeacherControllerPort } from '../../shared/contracts/component-platform'
/** The common projection owns layout and child mounting; the boundary shares the ordinary runtime lifecycle. */
const containerRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ root }) {
    if (root) root.dataset.componentContainerBoundary = ''
    return { update() {}, dispose() { if (root) delete root.dataset.componentContainerBoundary } }
  },
}
export function defaultBuiltinRuntimeImplementations(ports:{assetUrl(id:string):string|undefined;teacherController?:TeacherControllerPort;reportImage(message:string,assetId:string):void}):ReadonlyMap<string,ComponentRuntimeImplementation>{
  const image=createImageRuntimeImplementation(id=>{const url=ports.assetUrl(id);return url?{url}:undefined},d=>ports.reportImage(d.message,d.assetId));
  return new Map([
      ['guoling.text', textRuntimeImplementation], ['guoling.formula', formulaRuntimeImplementation],
      ['guoling.image', image as ComponentRuntimeImplementation], ['guoling.shape', shapeRuntimeImplementation as ComponentRuntimeImplementation],
      ['guoling.table', tableRuntimeImplementation], ['guoling.chart', chartRuntimeImplementation],
      ['guoling.navigation', createTeacherControllerRuntimeImplementation(ports.teacherController)],
      ['guoling.input', inputRuntimeImplementation as ComponentRuntimeImplementation], ['guoling.choice', choiceRuntimeImplementation as ComponentRuntimeImplementation],
      ['guoling.disclosure', disclosureRuntimeImplementation as ComponentRuntimeImplementation], ['guoling.popover', popoverRuntimeImplementation as ComponentRuntimeImplementation],
      ['guoling.feedback', feedbackRuntimeImplementation as ComponentRuntimeImplementation], ['guoling.visibility', visibilityRuntimeImplementation as ComponentRuntimeImplementation],
      ['guoling.document-block', documentBlockRuntimeImplementation],
      ['guoling.container.slide', containerRuntimeImplementation], ['guoling.container.flow', containerRuntimeImplementation], ['guoling.container.spatial', containerRuntimeImplementation],
  ]);
}
