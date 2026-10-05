import { createBlankCourseProjectV10 } from '../../core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../core/drivers/CourseV10Driver'
import { createTeacherControllerFrame } from '../../components/teacher-controller/data'
import type { CourseProjectV10 } from '../../shared/contracts/component-platform'
import type { DocumentResources } from '../../shared/workbench/document'
import { SLIDE_CANVAS_MAX, SLIDE_CANVAS_MIN, SLIDE_CANVAS_PRESETS, type SlideCanvasSize } from '../../shared/slideCanvas'
import { parsePptxImport } from './pptxImport'
import { planPptxImportTransaction } from './pptxImportTransaction'
import { openPptxPackage, pptxReject, xmlFirst, type PptxImportIssue } from './pptxPackage'

/** The Slide canvas of an H5 presentation made from this PPT: its own page ratio, at the usual size. */
export function pptxCourseCanvas(bytes: Uint8Array): SlideCanvasSize {
  const size = xmlFirst(openPptxPackage(bytes).xml('ppt/presentation.xml'), 'sldSz')
  const width = Number(size?.getAttribute('cx')), height = Number(size?.getAttribute('cy'))
  if (!(width > 0 && height > 0)) pptxReject('页面尺寸', '页面宽高必须大于零')
  const ratio = width / height
  const preset = SLIDE_CANVAS_PRESETS.find(candidate => Math.abs(candidate.width / candidate.height - ratio) < 0.01)
  if (preset) return { width: preset.width, height: preset.height }
  // Other ratios keep 1280 on the long side, within the canvas limits.
  const fit = (value: number) => Math.max(SLIDE_CANVAS_MIN, Math.min(SLIDE_CANVAS_MAX, Math.round(value)))
  return ratio >= 1 ? { width: 1280, height: fit(1280 / ratio) } : { width: fit(1280 * ratio), height: 1280 }
}

export interface PptxCourse {
  project: CourseProjectV10
  resources: DocumentResources
  issues: PptxImportIssue[]
}

/** A new H5 presentation holding the PPT's pages, and nothing else (M21 "从 PPT 新建 H5 演示"). */
export async function createCourseFromPptx(bytes: Uint8Array, title: string): Promise<PptxCourse> {
  const canvas = pptxCourseCanvas(bytes)
  const draft = await parsePptxImport(bytes, canvas)
  const project = createBlankCourseProjectV10(title)
  project.surfaces = []
  for (const id of project.global.overlay) if (project.instances[id].definitionId === 'guoling.navigation') project.instances[id].frame = createTeacherControllerFrame(canvas)
  const driver = new CourseV10Driver()
  const resources: DocumentResources = { assets: {}, components: {} }
  const target = { documentId: crypto.randomUUID(), epoch: crypto.randomUUID(), project, resources,
    surfaceId: null, instanceId: null, instanceIds: [], activeStateId: null, editingProject: project }
  const step = planPptxImportTransaction(target, draft, title, { canvas, source: { bytes, filename: `${title}.pptx` } })
  const model = driver.apply({ kind: 'course-v10', project, resources },
    { type: step.type, edits: step.edits, expected: step.expected })
  if (model.kind !== 'course-v10') throw new Error('PPT 导入没有产生 V10 工程')
  return { project: model.project, resources: model.resources, issues: draft.issues }
}

/** The .h5lesson bytes of a course made from a PPT. */
export function pptxCourseArchive(course: PptxCourse): Uint8Array<ArrayBuffer> {
  const bytes = new CourseV10Driver().serialize({ kind: 'course-v10', project: course.project, resources: course.resources })
  // File requests carry ArrayBuffer-backed bytes; the zip output already is one.
  return bytes.buffer instanceof ArrayBuffer ? bytes as Uint8Array<ArrayBuffer> : Uint8Array.from(bytes)
}

/** The file stem an H5 presentation made from `name` gets ("第一课.pptx" → "第一课"). */
export function pptxCourseStem(name: string): string {
  return name.replace(/^.*[\\/]/, '').replace(/\.pptx$/i, '').trim() || '从 PPT 新建的 H5 演示'
}
