import type { CompositionLayerItem } from '../../shared/contracts/course-project-v9/types'
import { findCompositionNode } from '../../shared/composition/content'
import { documentContentSchema } from '../../shared/document/content'
import type { CompositionContentEdit } from '../../shared/composition/edit'
export type { CompositionContentEdit } from '../../shared/composition/edit'
import { mergeCourseNativeData, nativeElementContentSchema, webCompositionSchema } from '../../shared/contracts/course-project-v9/schema'
import { patchCompositionInlineStyle } from '../../shared/composition/inlineStyle'
export { patchCompositionInlineStyle } from '../../shared/composition/inlineStyle'

export type CompositionContent = CompositionLayerItem['content']
export type CompositionContentNode = CompositionContent['root']

export interface CompositionContentDiagnostic {
  code: 'node-not-found' | 'wrong-node-kind' | 'invalid-content' | 'root-required' | 'layout-cycle' | 'invalid-position'
  message: string
  nodeId: string
}

export type CompositionContentEditResult =
  | { ok: true; content: CompositionContent; changed: boolean }
  | { ok: false; content: CompositionContent; changed: false; diagnostic: CompositionContentDiagnostic }

type Element = Extract<CompositionContentNode, { kind: 'element' }>

function parentOf(root: CompositionContentNode, id: string): Element | undefined {
  if (root.kind !== 'element') return undefined
  if (root.children.some(child => child.id === id)) return root
  for (const child of root.children) {
    const found = parentOf(child, id)
    if (found) return found
  }
  return undefined
}

/** Copy only the path to a changed node; untouched professional leaves and asset bindings keep their owner. */
function replaceNode(root: CompositionContentNode, id: string, replacement: CompositionContentNode): CompositionContentNode {
  if (root.id === id) return replacement
  if (root.kind !== 'element') return root
  const children = root.children.map(child => replaceNode(child, id, replacement))
  return children.some((child, index) => child !== root.children[index]) ? { ...root, children } : root
}

/** Pure author-data edits. The existing DocumentSession remains responsible for scope, CAS, history and resources. */
export function applyCompositionContentEdit(content: CompositionContent, edit: CompositionContentEdit): CompositionContentEditResult {
  const fail = (code: CompositionContentDiagnostic['code'], message: string): CompositionContentEditResult => ({
    ok: false, content, changed: false, diagnostic: { code, message, nodeId: edit.nodeId },
  })
  if (edit.type === 'batch') {
    if (!findCompositionNode(content.root, edit.nodeId)) return fail('node-not-found', '组合内容中的目标已不存在')
    let next = content
    for (const child of edit.edits) {
      const result = applyCompositionContentEdit(next, child)
      if (!result.ok) return { ...result, content }
      next = result.content
    }
    return { ok: true, content: next, changed: next !== content }
  }
  const target = findCompositionNode(content.root, edit.nodeId)
  if (!target) return fail('node-not-found', '组合内容中的目标已不存在')
  const wrongKind = () => fail('wrong-node-kind', target.kind === 'runtime'
    ? '动态区域由运行时代码和参数负责；不能将其显示结果当作静态正文修改'
    : '该操作不适用于当前节点；专业正文和原生内容继续使用各自的数据合同')
  let root = content.root
  try {
    if (edit.type === 'move' || edit.type === 'remove') {
      const parent = parentOf(root, edit.nodeId)
      if (!parent) return fail('root-required', '根节点必须保留；删除整块内容请删除所属图层')
      const children = parent.children.filter(child => child.id !== edit.nodeId)
      if (edit.type === 'remove') root = replaceNode(root, parent.id, { ...parent, children })
      else {
        const destination = findCompositionNode(root, edit.parentId)
        if (!destination) return fail('node-not-found', '目标容器已不存在')
        if (destination.kind !== 'element') return fail('wrong-node-kind', '只有元素容器可以接收子节点')
        if (findCompositionNode(target, edit.parentId)) return fail('layout-cycle', '不能把节点放入自身或自己的后代中')
        const count = destination.children.length - (parent.id === destination.id ? 1 : 0)
        if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index > count)
          return fail('invalid-position', '插入位置超出目标容器的当前范围')
        if (parent.id === destination.id && parent.children.findIndex(child => child.id === edit.nodeId) === edit.index)
          return { ok: true, content, changed: false }
        root = replaceNode(root, parent.id, { ...parent, children })
        const destinationAfterRemoval = findCompositionNode(root, edit.parentId) as Element
        const inserted = [...destinationAfterRemoval.children]
        inserted.splice(edit.index, 0, target)
        root = replaceNode(root, destinationAfterRemoval.id, { ...destinationAfterRemoval, children: inserted })
      }
    } else if (edit.type === 'text') {
      if (target.kind !== 'text') return wrongKind()
      if (target.text !== edit.text) root = replaceNode(root, target.id, { ...target, text: edit.text })
    } else if (edit.type === 'attributes' || edit.type === 'style') {
      if (target.kind !== 'element') return wrongKind()
      const attributes = { ...target.attributes }
      const patch = edit.type === 'style' ? { style: patchCompositionInlineStyle(attributes.style ?? '', edit.patch) } : edit.patch
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete attributes[key]
        else attributes[key] = value
      }
      if (JSON.stringify(attributes) !== JSON.stringify(target.attributes)) root = replaceNode(root, target.id, { ...target, attributes })
    } else if (edit.type === 'document') {
      if (target.kind !== 'document') return wrongKind()
      const next = documentContentSchema.parse(edit.content)
      if (JSON.stringify(next) !== JSON.stringify(target.content)) root = replaceNode(root, target.id, { ...target, content: next })
    } else if (edit.type === 'native') {
      if (target.kind !== 'native') return wrongKind()
      const next = nativeElementContentSchema.parse({ nativeType: target.content.nativeType,
        data: mergeCourseNativeData(target.content.data as Record<string, unknown>, edit.patch) })
      if (JSON.stringify(next) !== JSON.stringify(target.content)) root = replaceNode(root, target.id, { ...target, content: next })
    } else {
      const replacement: CompositionContentNode = { ...structuredClone(edit.node), id: target.id }
      const candidate = { ...content, root: replaceNode(root, target.id, replacement) }
      // Replacement can introduce duplicate identities or invalid professional content; use the formal schema.
      webCompositionSchema.parse(candidate)
      if (JSON.stringify(replacement) !== JSON.stringify(target)) root = candidate.root
    }
  } catch (error) {
    return fail('invalid-content', error instanceof Error ? error.message : '组合内容修改无效')
  }
  return { ok: true, content: root === content.root ? content : { ...content, root }, changed: root !== content.root }
}
