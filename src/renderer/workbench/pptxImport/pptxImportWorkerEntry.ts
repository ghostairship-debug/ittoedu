import type { PptxImportConversionInput, PptxImportConversionReply } from '../../../main/workbench/pptxImport/PptxCourseImportProducer'
import { createCourseFromPptx, pptxCourseArchive, pptxCourseStem } from '../../project/pptxCourseCreation'

declare global {
  interface Window {
    pptxImportWorkerAPI?: { run(convert: (input: PptxImportConversionInput) => Promise<PptxImportConversionReply>): void }
  }
}

const api = window.pptxImportWorkerAPI
if (!api) throw new Error('PPTX 转换 worker 服务尚未连接')
api.run(async input => {
  const title = pptxCourseStem(input.filename)
  // Identical editable V10 conversion and source retention to the manual PPTX entrance.
  const course = await createCourseFromPptx(input.bytes, title)
  return { requestId: input.requestId, status: 'converted', archiveBytes: pptxCourseArchive(course),
    suggestedName: `${title}.glx`, issues: course.issues }
})
