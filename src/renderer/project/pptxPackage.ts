import { strFromU8, unzipSync } from 'fflate'

export const PPTX_IMPORT_LIMITS = { fileBytes: 32 * 1024 * 1024, expandedBytes: 128 * 1024 * 1024, entryBytes: 32 * 1024 * 1024, entries: 4096, ratio: 200, slides: 100, objects: 2000 } as const
export interface PptxImportIssue { page?: number; type: string; message: string }
export class PptxImportError extends Error {
  constructor(readonly issues: PptxImportIssue[]) { super(issues.map(i => `${i.page ? `第 ${i.page} 页：` : ''}${i.type} — ${i.message}`).join('\n')) }
}
export function pptxReject(type: string, message: string, page?: number): never { throw new PptxImportError([{ type, message, ...(page ? { page } : {}) }]) }
export const xmlAll = (node: Document | Element, name: string): Element[] => Array.from(node.getElementsByTagNameNS('*', name))
export const xmlFirst = (node: Document | Element, name: string): Element | undefined => xmlAll(node, name)[0]
export const xmlChildren = (node: Element): Element[] => Array.from(node.children)
const relNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const pptxRelationshipId = (node: Element, name = 'id'): string => node.getAttributeNS(relNamespace, name) ?? ''

export interface PptxRelationship { id: string; type: string; target: string; external: boolean }
export interface PptxPackage {
  files: Record<string, Uint8Array>
  xml(path: string): Document
  relationships(path: string): PptxRelationship[]
}

function resolvePart(source: string, target: string): string {
  if (!target || /[\\?#\u0000]/.test(target) || /^[a-z][a-z0-9+.-]*:/i.test(target)) return pptxReject('损坏关系', `非法目标 ${target}`)
  const parts = target.startsWith('/') ? [] : source.split('/').slice(0, -1)
  for (const part of target.replace(/^\//, '').split('/')) {
    if (part === '..') { if (!parts.length) return pptxReject('损坏关系', `目标越界 ${target}`); parts.pop() }
    else if (part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/** Stage only: validate every ZIP entry before allocating its expanded bytes. */
export function openPptxPackage(bytes: Uint8Array): PptxPackage {
  if (bytes.length > PPTX_IMPORT_LIMITS.fileBytes) pptxReject('文件大小', 'PPTX 不能超过 32 MiB')
  let total = 0
  const names = new Set<string>()
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, { filter(entry) {
      if (entry.name.startsWith('/') || /[\\\u0000]/.test(entry.name) || entry.name.split('/').some(p => p === '..' || p === '.')) pptxReject('ZIP 结构', `非法路径 ${entry.name}`)
      if (names.has(entry.name)) pptxReject('ZIP 结构', `重复路径 ${entry.name}`)
      names.add(entry.name)
      total += entry.originalSize
      if (names.size > PPTX_IMPORT_LIMITS.entries || total > PPTX_IMPORT_LIMITS.expandedBytes || entry.originalSize > PPTX_IMPORT_LIMITS.entryBytes) pptxReject('解压大小', '文件数或解压大小超过导入上限')
      if (entry.originalSize > Math.max(1, entry.size) * PPTX_IMPORT_LIMITS.ratio) pptxReject('解压比', `${entry.name} 超过 200 倍`)
      return !entry.name.endsWith('/')
    } })
  } catch (error) { if (error instanceof PptxImportError) throw error; return pptxReject('ZIP 结构', 'PPTX 压缩包损坏') }
  const cache = new Map<string, Document>()
  const pkg: PptxPackage = {
    files,
    xml(path) {
      const cached = cache.get(path)
      if (cached) return cached
      if (!files[path]) return pptxReject('损坏关系', `缺少 ${path}`)
      const source = strFromU8(files[path])
      if (/<!DOCTYPE|<!ENTITY/i.test(source)) pptxReject('XML 结构', `${path} 不支持 DTD`)
      const parsed = new DOMParser().parseFromString(source, 'application/xml')
      if (xmlAll(parsed, 'parsererror').length) pptxReject('XML 结构', `${path} 无法解析`)
      cache.set(path, parsed)
      return parsed
    },
    relationships(path) {
      const segments = path.split('/')
      const filename = segments.pop()!
      const relPath = [...segments, '_rels', `${filename}.rels`].join('/')
      if (!files[relPath]) return []
      const ids = new Set<string>()
      return xmlAll(pkg.xml(relPath), 'Relationship').map(node => {
        const id = node.getAttribute('Id') ?? ''
        if (!id || ids.has(id)) pptxReject('损坏关系', `${relPath} 关系 ID 缺失或重复`)
        ids.add(id)
        const external = node.getAttribute('TargetMode') === 'External'
        const raw = node.getAttribute('Target') ?? ''
        const target = external ? raw : resolvePart(path, raw)
        return { id, type: node.getAttribute('Type') ?? '', target, external }
      })
    },
  }
  const root = pkg.relationships('').find(r => r.type.endsWith('/officeDocument'))
  if (!root || root.external || root.target !== 'ppt/presentation.xml') pptxReject('PPTX 结构', '需要标准 PresentationML 主文档')
  return pkg
}
