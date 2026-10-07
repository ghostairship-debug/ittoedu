import type { CourseProjectV10, JsonObject } from '../../../../shared/contracts/component-platform'
import type { DocumentResources } from '../../../../shared/workbench/document'
import type { ContentApplyDiagnostic } from '../../../../core/contentApply/planning/types'
import { extractHtmlResources } from '../../htmlImport/extractHtmlResources'
import { prepareImageResource } from '../../admittedImageResource'

export interface ContentResourceDiagnosticVerification {
  state: 'resolved' | 'unresolved' | 'unknown'
  code: string
  instanceId?: string
  reference?: string
  assetId?: string
  reason: string
}

/** The caller supplies one fresh canonical snapshot and stamps its revision. */
export async function verifyContentResourceDiagnostic(input: {
  project: CourseProjectV10
  resources: DocumentResources
  diagnostic: Pick<ContentApplyDiagnostic, 'code' | 'instanceId' | 'reference'>
}): Promise<ContentResourceDiagnosticVerification> {
  const { diagnostic } = input
  const fact = { code: diagnostic.code, instanceId: diagnostic.instanceId, reference: diagnostic.reference }
  const result = (state: ContentResourceDiagnosticVerification['state'], reason: string, assetId?: string): ContentResourceDiagnosticVerification =>
    ({ ...fact, state, reason, ...(assetId ? { assetId } : {}) })
  if (diagnostic.code !== 'image-resource-unavailable' || !diagnostic.instanceId || !diagnostic.reference) return result('unknown', '诊断缺少可复核的图片目标或引用。')
  const instance = input.project.instances[diagnostic.instanceId]
  if (!instance) return result('unknown', '原图片实例已不在当前作品，未推断任务目标是否完成。')
  const data = instance.data
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.html !== 'string') return result('unknown', '当前对象没有可复核的 HTML 资源来源。')
  const implementation = instance.implementationOverride ?? input.project.definitions[instance.definitionId]?.implementation
  if (implementation?.kind !== 'builtin' || !['guoling.web', 'guoling.html-program'].includes(implementation.key)) return result('unknown', '当前实现已改变，不能由旧 HTML 诊断推断其运行结果。')
  const reference = diagnostic.reference
  if (!/^cw-resource:[a-zA-Z0-9_.-]+$/.test(reference)) return result('unknown', '原诊断没有当前软件资源引用，保留历史事实。')
  const marker = 'https://content-resource-diagnostic.invalid/current-image.png'
  const replace = (source: string) => source.replace(/cw-resource:[a-zA-Z0-9_.-]+/g, token => token === reference ? marker : token)
  const modules = data.modules && typeof data.modules === 'object' && !Array.isArray(data.modules)
    ? Object.entries(data.modules).filter((entry): entry is [string, string] => typeof entry[1] === 'string') : []
  const css = typeof data.css === 'string' ? data.css : ''
  const sources = [data.html, css, ...modules.map(([, source]) => source)]
  if (!sources.some(source => (source.match(/cw-resource:[a-zA-Z0-9_.-]+/g) ?? []).some(token => token === reference))) return result('resolved', '当前源码已经移除原图片引用。')
  // Reuse the actual resource consumer parser. The sentinel is parse-only;
  // no network request, formal write or new resource identity is performed.
  const extracted = extractHtmlResources({ html: `${replace(data.html)}<style>${replace(css).replace(/<\/style/gi, '<\\/style')}</style>`,
    siblingFiles: new Map(modules.map(([name, source]) => [name, new TextEncoder().encode(replace(source))])) })
  if (!extracted.remoteReferences.some(item => item.url === marker && item.usage === 'image')) return result('unknown', '原引用仍在源码，但当前图片消费关系尚未确认。')
  const bindings = data.resourceBindings as JsonObject | undefined
  const assetId = bindings && typeof bindings === 'object' && !Array.isArray(bindings) && typeof bindings[reference] === 'string' ? bindings[reference] : undefined
  const asset = assetId ? input.project.assets[assetId] : undefined
  const bytes = assetId ? input.resources.assets[assetId] : undefined
  if (!asset || !bytes) return result('unresolved', '当前图片引用仍缺少已保存的资源字节。', assetId)
  try {
    await prepareImageResource({ bytes, mimeType: asset.mimeType ?? '', filename: asset.filename ?? asset.path }, () => 'resource-diagnostic-check')
    return result('resolved', '当前绑定图片字节已由现有图片解码器完整解码。', assetId)
  } catch (error) {
    return result('unresolved', `当前绑定图片仍不可解码：${error instanceof Error ? error.message : String(error)}`, assetId)
  }
}
