export type FlowInsertDestination = 'document' | 'paper'
export type FlowInsertKind = 'heading' | 'list' | 'table' | 'formula' | 'divider' | 'callout' | 'section' | 'image' | 'video' | 'audio' | 'component' | 'text-box' | 'shape'

export interface FlowInsertCommand {
  readonly destination: FlowInsertDestination
  readonly kind: FlowInsertKind
  readonly label: string
}

export const FLOW_DOCUMENT_INSERT_COMMANDS: readonly FlowInsertCommand[] = [
  { destination: 'document', kind: 'heading', label: '标题' },
  { destination: 'document', kind: 'list', label: '列表' },
  { destination: 'document', kind: 'table', label: '表格' },
  { destination: 'document', kind: 'formula', label: '公式' },
  { destination: 'document', kind: 'divider', label: '分隔线' },
  { destination: 'document', kind: 'callout', label: '提示框' },
  { destination: 'document', kind: 'section', label: '折叠节' },
  { destination: 'document', kind: 'image', label: '图片' },
  { destination: 'document', kind: 'video', label: '视频' },
  { destination: 'document', kind: 'audio', label: '音频' },
  { destination: 'document', kind: 'component', label: '组件' },
]

export const FLOW_PAPER_INSERT_COMMANDS: readonly FlowInsertCommand[] = [
  { destination: 'paper', kind: 'text-box', label: '文本框' },
  { destination: 'paper', kind: 'image', label: '图片' },
  { destination: 'paper', kind: 'shape', label: '形状' },
  { destination: 'paper', kind: 'component', label: '组件' },
]

export function flowInsertCommand(destination: FlowInsertDestination, kind: FlowInsertKind): FlowInsertCommand | null {
  return [...FLOW_DOCUMENT_INSERT_COMMANDS, ...FLOW_PAPER_INSERT_COMMANDS].find(command => command.destination === destination && command.kind === kind) ?? null
}
import { nanoid } from 'nanoid'
import type { EditorStoreKernel } from '../../store/editorStoreKernel'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import { DOCUMENT_BLOCK_DEFINITION, documentBlockData } from '../../../components/document-block'
import type { DocumentBlock } from '../../../shared/document/content'
import { TEXT_DEFINITION } from '../../../components/text/adapters'
import { createTextComponentData } from '../../../components/text/data'
import { captureCourseInsertionTarget, commitCourseInsertion, insertCourseElement, insertCourseLibraryAsset, courseAuthorData,
  type CourseInsertionOptions, type CourseInsertionResult } from '../../media/commitCourseMediaAuthoring'


export function captureFlowMenuTarget(kernel: EditorStoreKernel): CapturedCourseTarget {
  const target = captureCourseInsertionTarget(kernel)
  if (target.project.surfaces.find(surface => surface.id === target.surfaceId)?.kind !== 'flow') throw new Error('请先选择讲义页面')
  return target
}
export interface FlowInsertionOptions extends CourseInsertionOptions { assetId?: string }
/** The original menu enters the canonical component writer, retaining the captured document. */
export async function insertFlowMenu(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  command: FlowInsertCommand, options: FlowInsertionOptions = {}): Promise<CourseInsertionResult> {
  const placement = { ...options, destination: command.destination }
  if (['image', 'video', 'audio'].includes(command.kind)) {
    if (!options.assetId) throw new Error('请先选择要插入的媒体素材')
    // Library insertion also fixes the target before asynchronous image metadata reads.
    return insertCourseLibraryAsset(kernel, options.assetId, placement, target)
  }
  if (command.kind === 'component') throw new Error('请选择组件库条目后使用组件库的原目标插入入口')
  if (command.kind === 'text-box') return insertCourseElement(kernel, target, 'text', placement)
  if (command.kind === 'shape' || command.kind === 'table' || command.kind === 'formula') return insertCourseElement(kernel, target, command.kind, placement)
  const text = (value: string) => ({ inlines: [{ type: 'text' as const, text: value }] })
  const id = `block_${nanoid()}`
  let block: DocumentBlock
  switch (command.kind) {
    case 'heading': block = { id, type: 'heading', level: 2, content: text(options.text ?? '新标题') }; break
    case 'list': block = { id, type: 'list', ordered: false, items: [{ id: `listitem_${nanoid()}`, content: text(options.text ?? '列表内容') }] }; break
    case 'divider': block = { id, type: 'divider' }; break
    case 'callout': block = { id, type: 'callout', tone: 'note', title: text('提示'), body: text(options.text ?? '提示内容') }; break
    case 'section': block = { id, type: 'section', title: text(options.text ?? '新章节'), collapsedByDefault: false, blocks: [] }; break
    default: throw new Error(`未知讲义插入类型：${command.kind}`)
  }
  const childId = command.kind === 'section' ? `instance_${nanoid()}` : null
  return commitCourseInsertion(kernel, target, DOCUMENT_BLOCK_DEFINITION,
    [{ id, definitionId: DOCUMENT_BLOCK_DEFINITION.id, name: command.label, data: documentBlockData(block), ...(childId ? { childIds: [childId] } : {}) },
      ...(childId ? [{ id: childId, definitionId: TEXT_DEFINITION.id, data: courseAuthorData(createTextComponentData('章节内容')) }] : [])], placement,
    childId && !target.project.definitions[TEXT_DEFINITION.id] ? [{ type: 'definition.set', definition: TEXT_DEFINITION }] : [], [id])
}
