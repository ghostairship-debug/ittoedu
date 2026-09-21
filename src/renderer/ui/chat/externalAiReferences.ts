import type { GenerationRequest } from '../../../shared/generationContract'

/** Describe the actual immutable payload, not the current checkboxes after send. */
export function generationExternalReferences(request: GenerationRequest): string[] {
  const references = [`工程：${request.workspace.normalizedPath}（完整可编辑内容）`]
  const context = request.context && typeof request.context === 'object' && !Array.isArray(request.context) ? request.context : {}
  const scope = context.reference === 'selection' ? '当前选区' : context.reference === 'course' ? '整份课件' : '当前页'
  references.push(`编辑目标：${scope}；其他工程内容可作为上下文读取`)
  if (Array.isArray(context.materials)) for (const material of context.materials) {
    if (!material || typeof material !== 'object' || Array.isArray(material)) continue
    const source = material.source && typeof material.source === 'object' && !Array.isArray(material.source) ? material.source : {}
    references.push(`材料：${typeof material.title === 'string' ? material.title : '引用材料'}${typeof source.locator === 'string' ? `（${source.locator}）` : ''}`)
  }
  const images = request.observation?.files.filter(file => file.role === 'image').length ?? 0
  if (images) references.push(`当前画面：${images} 张图像`)
  const sources = request.resourceFiles?.filter(file => file.path.startsWith('components/') || file.path.startsWith('runtimes/')).length ?? 0
  if (sources) references.push(`工程内组件与互动内容：${sources} 份源文件`)
  if (request.confirmedDocuments) references.push('已确认的教学策划和呈现脚本全文')
  return references
}
