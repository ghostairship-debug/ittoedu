import { createBlankCourseProject } from '../../core/course/createCourseProject'
import { createCourseProjectArchive } from '../../core/drivers/codecs/courseProjectArchive'
import { deleteCourseSurface } from '../../core/tools/courseLocations'
import type { ComponentPackageData } from '../../shared/componentTypes'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { SLIDE_CANVAS_MAX, SLIDE_CANVAS_MIN, SLIDE_CANVAS_PRESETS, type SlideCanvasSize } from '../../shared/slideCanvas'
import { componentPackagesToArchiveFiles } from '../components/componentPackageStore'
import { withDefaultComponentController } from '../components/teacherControllerComponent'
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
  project: CourseProjectDocument
  assetFiles: Record<string, Uint8Array>
  componentPackages: Record<string, ComponentPackageData>
  issues: PptxImportIssue[]
}

/** A new H5 presentation holding the PPT's pages, and nothing else (M21 "从 PPT 新建 H5 演示"). */
export async function createCourseFromPptx(bytes: Uint8Array, title: string): Promise<PptxCourse> {
  const canvas = pptxCourseCanvas(bytes)
  const draft = await parsePptxImport(bytes, canvas)
  const bundle = withDefaultComponentController(createBlankCourseProject({ title, canvas }))
  const blankPage = bundle.project.surfaces[0]!.id
  // The import adds the PPT's pages as a new Slide page; the blank page the course started with goes.
  const step = planPptxImportTransaction(bundle.project, draft, title)
  const removed = deleteCourseSurface(step.nextDocument, blankPage)
  if (!removed.ok) throw new Error(removed.reason)
  return {
    project: courseProjectDocumentSchema.parse(removed.project),
    assetFiles: Object.fromEntries(draft.assets.map(asset => [asset.meta.id, asset.bytes])),
    componentPackages: bundle.componentPackages,
    issues: draft.issues,
  }
}

/** The .h5lesson bytes of a course made from a PPT. */
export function pptxCourseArchive(course: PptxCourse): Uint8Array<ArrayBuffer> {
  const bytes = createCourseProjectArchive({ project: course.project, assetFiles: course.assetFiles, componentFiles: componentPackagesToArchiveFiles(course.componentPackages) })
  // File requests carry ArrayBuffer-backed bytes; the zip output already is one.
  return bytes.buffer instanceof ArrayBuffer ? bytes as Uint8Array<ArrayBuffer> : Uint8Array.from(bytes)
}

/** The file stem an H5 presentation made from `name` gets ("第一课.pptx" → "第一课"). */
export function pptxCourseStem(name: string): string {
  return name.replace(/^.*[\\/]/, '').replace(/\.pptx$/i, '').trim() || '从 PPT 新建的 H5 演示'
}
