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
