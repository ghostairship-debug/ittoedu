import { componentContainers } from '../../../shared/contracts/component-platform/project'
export type FlowInsertDestination = 'document' | 'paper'
export type FlowInsertKind = DocumentBlockKind | 'formula' | 'chart' | 'image' | 'video' | 'audio' | 'component' | 'text-box' | 'shape'

export interface FlowInsertCommand {
  readonly destination: FlowInsertDestination
  readonly kind: FlowInsertKind
  readonly label: string
}

export const FLOW_DOCUMENT_INSERT_COMMANDS: readonly FlowInsertCommand[] = [
  ...DOCUMENT_BLOCK_KINDS.map(({ kind, label }) => ({ destination: 'document' as const, kind, label })),
  { destination: 'document', kind: 'formula', label: '公式' },
  { destination: 'document', kind: 'chart', label: '图表' },
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
import { DOCUMENT_BLOCK_KINDS, createDocumentBlock, type DocumentBlockKind } from '../../document/documentBlockCommands'
import { TEXT_DEFINITION } from '../../../components/text/adapters'
import { createTextComponentData } from '../../../components/text/data'
import { captureFlowMenuPage, drainFlowWorkspace, type FlowMenuPageCapture } from '../../document/flowWorkspaceRegistry'
import { DocumentInsertionTargetError, documentInsertionBlockId } from '../../../shared/document/blockInsertion'
import { projectFlowDocument } from '../../../core/components/document/flowDocumentProjection'
import { flowMenuPaperPlacement } from './flowMenuPaperPlacement'
import { containerChildIds, owningContainer } from '../../../shared/contracts/component-platform/project'
import { captureCourseInsertionTarget, commitCourseInsertion, insertCourseElement, insertCourseLibraryAsset, courseAuthorData,
  type CourseInsertionOptions, type CourseInsertionResult } from '../../media/commitCourseMediaAuthoring'


export type CapturedFlowMenuTarget = CapturedCourseTarget & { flowMenuPage?: Extract<FlowMenuPageCapture, { ok: true }> }
export function captureFlowMenuTarget(kernel: EditorStoreKernel, captureInsertion = true): CapturedFlowMenuTarget {
  const target = captureCourseInsertionTarget(kernel)
  if (componentContainers(target.project).find(surface => surface.id === target.surfaceId)?.kind !== 'flow') throw new Error('请先选择讲义页面')
  const page = captureFlowMenuPage(captureInsertion)
  if (!page.ok) throw new Error(page.reason)
  if (page.documentId !== target.documentId || page.surfaceId !== target.surfaceId || page.epoch && page.epoch !== target.epoch) {
    page.insertionSelection?.release()
    throw new DocumentInsertionTargetError('讲义插入位置已改变，请重新选择')
  }
  return { ...target, flowMenuPage: page }
}
export function releaseFlowMenuTarget(target: CapturedFlowMenuTarget): void { target.flowMenuPage?.insertionSelection?.release() }
export function flowInsertionBoundaryBlockId(target: CapturedFlowMenuTarget): string | null {
  const content = target.surfaceId ? projectFlowDocument(target.project, target.surfaceId).content : undefined
  const selection = target.flowMenuPage?.insertionSelection?.read(content)
  return selection && target.surfaceId ? documentInsertionBlockId(projectFlowDocument(target.project, target.surfaceId).content, selection)
    : target.flowMenuPage?.selectedBlockId ?? null
}
/** The input owner must finish its ACK before a new formal baseline is read. */
export async function refreshFlowMenuTarget(kernel: EditorStoreKernel, captured: CapturedFlowMenuTarget): Promise<CapturedFlowMenuTarget> {
  const input = captured.flowMenuPage?.insertionSelection
  const ready = input?.drain ? { ok: await input.drain() } : await drainFlowWorkspace(captured.documentId)
  if (!ready.ok) throw new DocumentInsertionTargetError(ready.reason ?? '原讲义输入尚未确认，请完成输入后重新选择位置')
  let target: CapturedCourseTarget
  try { await kernel.bridge.drain([captured.documentId]); target = kernel.captureTarget(captured.documentId) }
  catch { throw new DocumentInsertionTargetError('原讲义已关闭，请重新打开并选择插入位置') }
  if (target.epoch !== captured.epoch || target.project.id !== captured.project.id || target.surfaceId !== captured.surfaceId
    || target.rootInstanceId !== captured.rootInstanceId || target.editingContainerId !== captured.editingContainerId || target.activeStateId !== captured.activeStateId) {
    throw new DocumentInsertionTargetError('原讲义编辑范围已改变，请在原讲义重新选择插入位置')
  }
  captured.flowMenuPage?.insertionSelection?.read(target.surfaceId ? projectFlowDocument(target.project, target.surfaceId).content : undefined)
  return { ...target, flowMenuPage: captured.flowMenuPage }
}
export interface FlowInsertionOptions extends CourseInsertionOptions { assetId?: string }
/** Resolve the mapped bookmark after the input ACK; explicit block-boundary callers keep their placement. */
export function resolveFlowMenuInsertionOptions(target: CapturedFlowMenuTarget, command: FlowInsertCommand, options: FlowInsertionOptions = {}): FlowInsertionOptions {
  const page = target.flowMenuPage
  if (!page) return { ...options, destination: command.destination }
  if (command.destination === 'paper') {
    const preferred = { width: options.width ?? (command.kind === 'image' ? 480 : 320), height: options.height ?? (command.kind === 'image' ? 320 : 180) }
    const { frame } = flowMenuPaperPlacement(page, preferred)
    return { ...options, destination: 'paper', x: options.x ?? frame.x, y: options.y ?? frame.y,
      ...(options.width === undefined ? {} : { width: frame.width }), ...(options.height === undefined ? {} : { height: frame.height }) }
  }
  if (options.flowSelection !== undefined || page.insertionSelection && options.container === undefined && options.index === undefined) {
    return { ...options, destination: 'document', flowSelection: options.flowSelection !== undefined ? options.flowSelection
      : page.insertionSelection!.read(projectFlowDocument(target.project, page.surfaceId).content) }
  }
  const selected = page.selectedBlockId
  const container = selected ? owningContainer(target.project, selected) : { kind: 'surface' as const, surfaceId: page.surfaceId }
  if (!container) throw new Error('正文插入位置已不存在')
  return { ...options, destination: 'document', container: options.container ?? container,
    index: options.index ?? (selected ? containerChildIds(target.project, container).indexOf(selected) + 1 : containerChildIds(target.project, container).length) }
}
/** The original menu enters the canonical component writer, retaining the captured document. */
export async function insertFlowMenu(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  command: FlowInsertCommand, options: FlowInsertionOptions = {}): Promise<CourseInsertionResult> {
  const placement = resolveFlowMenuInsertionOptions(target, command, options)
  if (['image', 'video', 'audio'].includes(command.kind)) {
    if (!options.assetId) throw new Error('请先选择要插入的媒体素材')
    // Library insertion also fixes the target before asynchronous image metadata reads.
    return insertCourseLibraryAsset(kernel, options.assetId, placement, target)
  }
  if (command.kind === 'component') throw new Error('请选择组件库条目后使用组件库的原目标插入入口')
  if (command.kind === 'text-box') return insertCourseElement(kernel, target, 'text', placement)
  if (command.kind === 'shape' || command.kind === 'table' || command.kind === 'formula' || command.kind === 'chart') return insertCourseElement(kernel, target, command.kind, placement)
  if (!DOCUMENT_BLOCK_KINDS.some(value => value.kind === command.kind)) throw new Error(`未知讲义插入类型：${command.kind}`)
  const defaultText = { heading: '新标题', list: '列表内容', callout: '提示内容', section: '新章节' }
  const block = createDocumentBlock(command.kind as DocumentBlockKind, () => `block_${nanoid()}`,
    { text: options.text ?? defaultText[command.kind as keyof typeof defaultText] })
  const id = block.id
  if (block.type === 'paragraph') return commitCourseInsertion(kernel, target, TEXT_DEFINITION,
    [{ id, definitionId: TEXT_DEFINITION.id, data: courseAuthorData({ ...createTextComponentData(), content: block.content }) }], placement)
  const childId = command.kind === 'section' ? `instance_${nanoid()}` : null
  return commitCourseInsertion(kernel, target, DOCUMENT_BLOCK_DEFINITION,
    [{ id, definitionId: DOCUMENT_BLOCK_DEFINITION.id, name: command.label, data: documentBlockData(block), ...(childId ? { childIds: [childId] } : {}) },
      ...(childId ? [{ id: childId, definitionId: TEXT_DEFINITION.id, data: courseAuthorData(createTextComponentData('章节内容')) }] : [])], placement,
    childId && !target.project.definitions[TEXT_DEFINITION.id] ? [{ type: 'definition.set', definition: TEXT_DEFINITION }] : [], [id])
}
