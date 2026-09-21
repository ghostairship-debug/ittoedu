import { generationRequestSchema, type GenerationRequest } from './generationContract'

type JsonRecord = Record<string, unknown>
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined

/** The exact lesson payload Main attaches after the renderer froze its request. */
export interface LessonGenerationContextPayload {
  context: unknown
  resourceFiles: NonNullable<GenerationRequest['resourceFiles']>
  confirmedDocuments?: GenerationRequest['confirmedDocuments']
}

/**
 * The single expansion shared by the send path and the pre-send explanation.
 * Main reads the lesson's current documents, material fragments and material
 * originals *after* the renderer froze its request, so a renderer-side copy of
 * this rule would describe a payload that is not the one actually sent.
 */
export function withLessonGenerationContext(request: GenerationRequest, current: LessonGenerationContextPayload): GenerationRequest {
  return generationRequestSchema.parse({ ...request,
    context: { ...(request.context && typeof request.context === 'object' && !Array.isArray(request.context) ? request.context : { projectContext: request.context }), currentLesson: current.context },
    resourceFiles: [...(request.resourceFiles ?? []).filter(file => !file.path.startsWith('lesson-materials/')), ...current.resourceFiles],
    confirmedDocuments: current.confirmedDocuments,
  })
}

/** Documents and material reads Main injects into every lesson turn. */
export function lessonContextReferences(value: unknown): string[] {
  const lesson = record(value)
  if (!Object.keys(lesson).length) return []
  const documents = list(lesson.documents).map(record)
  const names = documents.map(document => text(document.path) ?? text(document.role) ?? '教学文档')
  const references = [`课例：${text(lesson.directory) ?? '当前课例'}（全部教学文档全文：${names.length ? names.join('、') : '随本轮请求读取'}）`]
  const materials = list(lesson.materials).map(record)
  if (materials.length) references.push(`课例材料提取片段：${materials.map(material => `${text(material.materialId) ?? '材料'}（${list(material.fragments).length} 个片段）`).join('、')}`)
  return references
}

/** Material originals travel as inline base64 bytes, not as readable paths. */
function lessonMaterialFileReferences(files: GenerationRequest['resourceFiles']): string[] {
  const originals = (files ?? []).filter(file => file.role === 'material' && file.path.startsWith('lesson-materials/'))
  if (!originals.length) return []
  const ids = [...new Set(originals.map(file => file.path.split('/')[1] ?? file.path))]
  return [`课例材料原件：${ids.join('、')}（${originals.length} 份 base64 原始字节）`]
}

/** Describe the actual immutable payload, not the current checkboxes after send. */
export function generationExternalReferences(request: GenerationRequest): string[] {
  const references = [`工程：${request.workspace.normalizedPath}（完整可编辑内容）`]
  const context = record(request.context)
  const scope = context.reference === 'selection' ? '当前选区' : context.reference === 'course' ? '整份课件' : '当前页'
  references.push(`编辑目标：${scope}；其他工程内容可作为上下文读取`)
  // The lesson context is injected by Main after this request is frozen; it is
  // listed from the final request so the explanation always names it.
  references.push(...lessonContextReferences(context.currentLesson), ...lessonMaterialFileReferences(request.resourceFiles))
  for (const material of list(context.materials)) {
    if (!material || typeof material !== 'object' || Array.isArray(material)) continue
    const entry = material as JsonRecord
    const source = entry.source && typeof entry.source === 'object' && !Array.isArray(entry.source) ? entry.source as JsonRecord : {}
    references.push(`材料：${typeof entry.title === 'string' ? entry.title : '引用材料'}${typeof source.locator === 'string' ? `（${source.locator}）` : ''}`)
  }
  const images = request.observation?.files.filter(file => file.role === 'image').length ?? 0
  if (images) references.push(`当前画面：${images} 张图像`)
  const sources = request.resourceFiles?.filter(file => file.path.startsWith('components/') || file.path.startsWith('runtimes/')).length ?? 0
  if (sources) references.push(`工程内组件与互动内容：${sources} 份源文件`)
  if (request.confirmedDocuments) references.push('已确认的教学策划和呈现脚本全文')
  return references
}
