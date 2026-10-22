import type { PptxImportConversionInput, PptxImportConversionReply } from '../../../shared/workbench/pptxImport'
import { createCourseFromPptx, pptxCourseStem } from '../../project/pptxCourseCreation'
import { parsePptxImport } from '../../project/pptxImport'

declare global {
  interface Window {
    pptxImportWorkerAPI?: { run(convert: (input: PptxImportConversionInput) => Promise<PptxImportConversionReply>): void }
  }
}

const api = window.pptxImportWorkerAPI
if (!api) throw new Error('PPTX 转换 worker 服务尚未连接')
api.run(async input => {
  if (input.mode === 'draft') return { requestId: input.requestId, status: 'converted', mode: 'draft', draft: await parsePptxImport(input.bytes, input.canvas) }
  const title = pptxCourseStem(input.filename)
  // Identical editable V10 conversion and source retention to the manual PPTX entrance.
  const course = await createCourseFromPptx(input.bytes, title)
  return { requestId: input.requestId, status: 'converted', mode: 'course', course: {
    model: { kind: 'course-v10', project: course.project, resources: course.resources }, suggestedName: `${title}.glx`, issues: course.issues } }
})
