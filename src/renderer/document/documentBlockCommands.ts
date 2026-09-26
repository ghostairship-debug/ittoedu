import type { DocumentBlock, DocumentContent, FlowTextContent } from '../../shared/document/content'
import { documentContentSchema, plainDocumentText } from '../../shared/document/content'
import { fromEditorDocument, renewEditorIdentities, toEditorDocument } from './documentAdapter'
import type { MenuCommand } from '../editing/commands/CommandMenu'

export type DocumentBlockKind = 'paragraph' | 'heading' | 'quote' | 'list' | 'code' | 'divider'
export type DocumentBlockAction = 'insert-above' | 'insert-below' | 'duplicate' | 'delete' | 'move-up' | 'move-down'
export type DocumentBlockCommand = { action: DocumentBlockAction; blockId: string; kind?: DocumentBlockKind }
  | { action: 'ai'; blockId: string }
  | { action: 'convert'; blockId: string; kind: DocumentBlockKind }
  | { action: 'move'; blockId: string; targetId: string; side: 'before' | 'after' }

export interface DocumentBlockCommandPort {
  content: DocumentContent
  /** Read at command execution, because an open menu may outlive an owner revision. */
  readContent?(): DocumentContent
  blockId: string
  apply(content: DocumentContent): void
  onError?(message: string): void
  ai?(blockId: string): void
  disabledReason?: string | null
  createId?(): string
}

const empty = (): FlowTextContent => ({ inlines: [] })
const kinds: readonly { kind: DocumentBlockKind; label: string }[] = [
  { kind: 'paragraph', label: '正文' }, { kind: 'heading', label: '标题' },
  { kind: 'quote', label: '引用' }, { kind: 'list', label: '列表' },
  { kind: 'code', label: '代码' }, { kind: 'divider', label: '分隔线' },
]

function locate(blocks: DocumentBlock[], id: string): { blocks: DocumentBlock[]; index: number; block: DocumentBlock } | null {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!
    if (block.id === id) return { blocks, index, block }
    if (block.type === 'section') {
      const child = locate(block.blocks, id)
      if (child) return child
    }
  }
  return null
}

function newBlock(kind: DocumentBlockKind, id: () => string): DocumentBlock {
  const blockId = id()
  switch (kind) {
    case 'paragraph': return { id: blockId, type: kind, content: empty() }
    case 'heading': return { id: blockId, type: kind, level: 2, content: empty() }
    case 'quote': return { id: blockId, type: kind, content: empty() }
    case 'list': return { id: blockId, type: kind, ordered: false, items: [{ id: id(), content: empty() }] }
    case 'code': return { id: blockId, type: kind, code: '' }
    case 'divider': return { id: blockId, type: kind }
  }
}

function convertible(block: DocumentBlock): block is Extract<DocumentBlock, { type: 'paragraph' | 'heading' | 'quote' | 'list' | 'code' | 'divider' }> {
  return ['paragraph', 'heading', 'quote', 'list', 'code', 'divider'].includes(block.type)
}

function convert(block: DocumentBlock, kind: DocumentBlockKind, id: () => string): DocumentBlock {
  if (!convertible(block)) throw new Error('此对象不能转换为文字段落')
  if (block.type === kind) return block
  if (block.type === 'quote' && block.citation?.inlines.length) throw new Error('带出处的引用不能直接转换')
  if (block.type === 'list' && block.items.length !== 1) throw new Error('多项列表不能直接转换')
  const paragraphStyle = block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote'
    ? { ...(block.textAlign ? { textAlign: block.textAlign } : {}), ...(block.lineSpacing !== undefined ? { lineSpacing: block.lineSpacing } : {}) }
    : {}
  if ((kind === 'list' || kind === 'code' || kind === 'divider') && Object.keys(paragraphStyle).length) throw new Error('转换会丢失段落排版')
  const content = block.type === 'list' ? block.items[0]!.content : block.type === 'code'
    ? { inlines: block.code ? [{ type: 'text' as const, text: block.code }] : [] }
    : block.type === 'divider' ? empty() : block.content
  if ((kind === 'code' || kind === 'divider') && content.inlines.some(inline => inline.type === 'math' || (inline.type === 'text' && (inline.style || inline.link || inline.code)))) throw new Error('转换会丢失文字样式或公式')
  if (kind === 'divider' && content.inlines.length) throw new Error('非空段落不能转换为分隔线')
  const base = { id: block.id }
  switch (kind) {
    case 'paragraph': return { ...base, type: kind, content, ...paragraphStyle }
    case 'heading': return { ...base, type: kind, level: block.type === 'heading' ? block.level : 2, content, ...paragraphStyle }
    case 'quote': return { ...base, type: kind, content, ...paragraphStyle }
    case 'list': return { ...base, type: kind, ordered: block.type === 'list' ? block.ordered : false, items: [{ id: block.type === 'list' ? block.items[0]!.id : id(), content }] }
    case 'code': return { ...base, type: kind, code: plainDocumentText(content) }
    case 'divider': return { ...base, type: kind }
  }
}

function copiedBlock(block: DocumentBlock, id: () => string): DocumentBlock {
  const doc = toEditorDocument({ blocks: [block] })
  return fromEditorDocument(renewEditorIdentities(doc, id, true)).blocks[0]!
}

function conversionReason(block: DocumentBlock, kind: DocumentBlockKind): string | undefined {
  if (!convertible(block)) return '此对象不能转换为文字段落'
  if (block.type === kind) return '已是当前类型'
  try { convert(block, kind, () => 'preview-id'); return undefined }
  catch (error) { return error instanceof Error ? error.message : String(error) }
}

/** Pure document result. The caller submits it through the existing document owner and History. */
export function applyDocumentBlockCommand(content: DocumentContent, command: Exclude<DocumentBlockCommand, { action: 'ai' }>, createId: () => string = () => crypto.randomUUID()): DocumentContent {
  const next = structuredClone(content)
  const source = locate(next.blocks, command.blockId)
  if (!source) throw new Error(`找不到段落：${command.blockId}`)
  const { blocks, index, block } = source
  switch (command.action) {
    case 'insert-above': case 'insert-below':
      blocks.splice(index + (command.action === 'insert-below' ? 1 : 0), 0, newBlock(command.kind ?? 'paragraph', createId)); break
    case 'duplicate': blocks.splice(index + 1, 0, copiedBlock(block, createId)); break
    case 'delete': blocks.splice(index, 1); break
    case 'move-up': case 'move-down': {
      const target = index + (command.action === 'move-up' ? -1 : 1)
      if (target < 0 || target >= blocks.length) throw new Error('段落已在边界')
      blocks.splice(index, 1); blocks.splice(target, 0, block); break
    }
    case 'move': {
      const destination = locate(next.blocks, command.targetId)
      if (!destination) throw new Error(`找不到目标段落：${command.targetId}`)
      if (command.blockId === command.targetId) return content
      if (destination.blocks !== blocks) throw new Error('暂不支持跨分节拖动段落')
      blocks.splice(index, 1)
      const target = blocks.findIndex(item => item.id === command.targetId)
      blocks.splice(target + (command.side === 'after' ? 1 : 0), 0, block)
      break
    }
    case 'convert': blocks[index] = convert(block, command.kind, createId); break
  }
  return documentContentSchema.parse(next)
}

/** One descriptor source for +, /, handle, and context menu. */
export function documentBlockMenu(port: DocumentBlockCommandPort): MenuCommand[] {
  const location = locate(port.content.blocks, port.blockId)
  if (!location) return []
  const run = (command: DocumentBlockCommand) => {
    try {
      const current = port.readContent?.() ?? port.content
      if (!locate(current.blocks, port.blockId)) throw new Error('段落已变化，请重新选择')
      if (command.action === 'ai') { port.ai?.(port.blockId); return }
      const result = applyDocumentBlockCommand(current, command, port.createId)
      if (result !== current) port.apply(result)
    } catch (error) {
      if (!port.onError) throw error
      port.onError(error instanceof Error ? error.message : String(error))
    }
  }
  const item = (id: string, label: string, group: string, command: DocumentBlockCommand, disabledReason?: string | null): MenuCommand => ({
    id, label, group, disabledReason: port.disabledReason ?? disabledReason,
    run: () => run(command), danger: command.action === 'delete',
  })
  return [
    ...kinds.map(({ kind, label }) => item(`insert-${kind}`, `下方插入${label}`, '插入', { action: 'insert-below', blockId: port.blockId, kind })),
    item('insert-above', '上方插入段落', '插入', { action: 'insert-above', blockId: port.blockId }),
    ...kinds.map(({ kind, label }) => item(`convert-${kind}`, `转换为${label}`, '转换', { action: 'convert', blockId: port.blockId, kind }, conversionReason(location.block, kind))),
    item('duplicate', '复制段落', '段落', { action: 'duplicate', blockId: port.blockId }),
    item('delete', '删除段落', '段落', { action: 'delete', blockId: port.blockId }),
    item('move-up', '上移段落', '排序', { action: 'move-up', blockId: port.blockId }, location.index === 0 ? '已在顶部' : undefined),
    item('move-down', '下移段落', '排序', { action: 'move-down', blockId: port.blockId }, location.index === location.blocks.length - 1 ? '已在底部' : undefined),
    item('ai', '用 AI 修改段落', 'AI', { action: 'ai', blockId: port.blockId }, port.ai ? undefined : '当前入口未连接 AI'),
  ]
}
