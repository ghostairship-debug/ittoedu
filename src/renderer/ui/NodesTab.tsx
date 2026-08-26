import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CancelDrop,
  type CollisionDetection,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  Box,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Layers3,
  Lock,
  Square,
  Trash2,
  Type,
  Unlock,
  Video,
  SlidersHorizontal,
  Sigma,
} from 'lucide-react'
import type { CourseSurfaceType } from '../../shared/courseProjectTypes'
import type { SceneNode } from '../../shared/projectTypes'
import {
  SPATIAL_CROSS_COORDINATE_MOVE_REASON,
  isSpatialCrossCoordinateOwnerMove,
} from '../course/effectiveLayerCommands'
import {
  indentFlowEditorBlock,
  outdentFlowEditorBlock,
  reorderFlowEditorBlock,
  type FlowCommandResult,
} from '../course/flowEditorCommands'
import { buildFlowEditorView, type FlowBlockView } from '../course/flowEditorView'
import {
  courseLayerItemToSceneNode,
  describeLayerImpact,
  visualFrontToBackRows,
  type EffectiveLayerProjectionRow,
} from '../course/read-model'
import { selectFlowEditorBlocks } from '../course/flowEditorSlice'
import {
  selectActiveScene,
  selectEditingNodes,
  selectEffectiveLayerProjection,
  selectSlideBackendKind,
  useEditorStore,
} from '../store/editorStore'

const nodeIcon = {
  text: Type,
  formula: Sigma,
  image: ImageIcon,
  video: Video,
  shape: Square,
  'teacher-controller': SlidersHorizontal,
  'external-component': Box,
} as const

type NodesTabRowNode = Pick<SceneNode, 'id' | 'name' | 'type' | 'visible' | 'locked'>

type FlowOutlineAction = 'move-up' | 'move-down' | 'indent' | 'outdent'

interface FlowOutlineActionSpec {
  readonly action: FlowOutlineAction
  readonly label: string
  readonly title: string
  readonly Icon: typeof ArrowUp
}

function flowOutlineActionSpecs(
  block: FlowBlockView,
  blocks: readonly FlowBlockView[],
): FlowOutlineActionSpec[] {
  const siblings = blocks.filter((candidate) => candidate.parentId === block.parentId)
  const previous = siblings.find((candidate) => candidate.index === block.index - 1)
  return [
    block.index > 0
      ? { action: 'move-up', label: '上移', title: '在同级正文中上移', Icon: ArrowUp }
      : null,
    siblings.some((candidate) => candidate.index === block.index + 1)
      ? { action: 'move-down', label: '下移', title: '在同级正文中下移', Icon: ArrowDown }
      : null,
    previous?.block.type === 'section'
      ? { action: 'indent', label: '缩进', title: '缩进到上一分节', Icon: IndentIncrease }
      : null,
    block.parentId !== null
      ? { action: 'outdent', label: '取消缩进', title: '移出当前分节', Icon: IndentDecrease }
      : null,
  ].filter((spec): spec is FlowOutlineActionSpec => spec !== null)
}

const FLOW_BLOCK_TYPE_LABELS: Readonly<Record<string, string>> = {
  heading: '标题', paragraph: '段落', list: '列表', quote: '引用', divider: '分隔线',
  media: '媒体', table: '表格', formula: '公式', code: '代码', callout: '提示',
  section: '分节', component: '组件',
}

function flowBlockTypeLabel(block: FlowBlockView): string {
  return FLOW_BLOCK_TYPE_LABELS[block.block.type] ?? '正文块'
}

interface FlowOutlineRowProps {
  readonly block: FlowBlockView
  readonly blocks: readonly FlowBlockView[]
  readonly selected: boolean
  onSelect(): void
  onAction(action: FlowOutlineAction): void
}

function FlowOutlineRow({
  block,
  blocks,
  selected,
  onSelect,
  onAction,
}: FlowOutlineRowProps) {
  const actionSpecs = flowOutlineActionSpecs(block, blocks)
  const Icon = block.block.type === 'media' ? ImageIcon : block.block.type === 'section' ? Box : Type
  return (
    <div
      className={`node-item${selected ? ' node-item--selected' : ''}`}
      data-testid={`flow-outline-block-${block.blockId}`}
      data-depth={block.depth}
      style={{
        marginLeft: `${Math.min(block.depth, 6) * 12}px`,
        width: `calc(100% - ${Math.min(block.depth, 6) * 12}px)`,
      }}
      onClick={onSelect}
    >
      <span aria-hidden="true" />
      <span className="node-type-icon" title={block.block.type}>
        <Icon size={15} />
      </span>
      <div className="node-label node-label--with-source">
        <span
          className="node-name"
          role="button"
          tabIndex={0}
          aria-label={`选择正文块“${block.label}”`}
          onClick={(event) => {
            event.stopPropagation()
            onSelect()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onSelect()
          }}
        >
          {block.label}
        </span>
        <small className="node-source">
          {flowBlockTypeLabel(block)} · 嵌套第 {block.depth + 1} 级
        </small>
      </div>
      {actionSpecs.map(({ action, label, title, Icon: ActionIcon }) => (
        <button
          key={action}
          type="button"
          className="icon-button"
          data-testid={`flow-outline-${action}-${block.blockId}`}
          title={title}
          aria-label={`${label}正文块“${block.label}”`}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation()
            onAction(action)
          }}
        >
          <ActionIcon size={14} />
        </button>
      ))}
    </div>
  )
}

interface SortableNodeProps {
  node: NodesTabRowNode
  selected: boolean
  sourceLabel?: string
  impactLabel?: string
  onSelect(additive: boolean): void
  onDelete(): void
  onDuplicate(): void
  onRename(name: string): void
  onToggleVisible(): void
  onToggleLocked(): void
}

function SortableNode({
  node,
  selected,
  sourceLabel,
  impactLabel,
  onSelect,
  onDelete,
  onDuplicate,
  onRename,
  onToggleVisible,
  onToggleLocked,
}: SortableNodeProps) {
  const Icon = node.type in nodeIcon
    ? nodeIcon[node.type as keyof typeof nodeIcon]
    : Box
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(node.name)
  const selectTimerRef = useRef<number | null>(null)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id })

  useEffect(() => setDraftName(node.name), [node.name])
  useEffect(() => () => {
    if (selectTimerRef.current !== null) window.clearTimeout(selectTimerRef.current)
  }, [])

  const commitName = () => {
    const nextName = draftName.trim()
    if (nextName && nextName !== node.name) onRename(nextName)
    else setDraftName(node.name)
    setEditing(false)
  }

  return (
    <div
      ref={setNodeRef}
      className={`node-item${selected ? ' node-item--selected' : ''}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      data-testid={`node-item-${node.id}`}
    >
      <button
        type="button"
        className="drag-handle"
        title="拖动调整前后层级"
        aria-label={`调整“${node.name}”层级`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <span className="node-type-icon" title={node.type}>
        <Icon size={15} />
      </span>
      {editing ? (
        <input
          autoFocus
          className="node-name-input"
          value={draftName}
          maxLength={80}
          aria-label={`重命名“${node.name}”`}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitName}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setDraftName(node.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <div className={`node-label${sourceLabel ? ' node-label--with-source' : ''}`}>
          <span
            className="node-name"
            title={`${node.name}（双击改名，Ctrl / Shift 单击可多选）`}
            onClick={(event) => {
              const additive = event.ctrlKey || event.metaKey || event.shiftKey
              // Synthetic/keyboard activation and additive selection cannot be
              // mistaken for rename, so keep those paths immediate. A real
              // primary click is briefly deferred so the second click can claim
              // the gesture for in-place rename before selecting the layer opens
              // the Properties tab and unmounts this list.
              if (event.detail === 0 || additive) {
                onSelect(additive)
                return
              }
              if (selectTimerRef.current !== null) {
                window.clearTimeout(selectTimerRef.current)
              }
              selectTimerRef.current = window.setTimeout(() => {
                selectTimerRef.current = null
                onSelect(false)
              }, 250)
            }}
            onDoubleClick={(event) => {
              event.preventDefault()
              if (selectTimerRef.current !== null) {
                window.clearTimeout(selectTimerRef.current)
                selectTimerRef.current = null
              }
              setEditing(true)
            }}
          >
            {node.name}
          </span>
          {sourceLabel ? (
            <small className="node-source" data-testid={`node-source-${node.id}`}>
              {sourceLabel}
              {impactLabel ? ` · ${impactLabel}` : ''}
            </small>
          ) : null}
        </div>
      )}
      <button
        type="button"
        className="icon-button"
        title={node.visible ? '隐藏图层' : '显示图层'}
        aria-label={`${node.visible ? '隐藏' : '显示'}“${node.name}”`}
        onClick={onToggleVisible}
      >
        {node.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <button
        type="button"
        className="icon-button"
        title={node.locked ? '解锁图层' : '锁定图层'}
        aria-label={`${node.locked ? '解锁' : '锁定'}“${node.name}”`}
        onClick={onToggleLocked}
      >
        {node.locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>
      <button
        type="button"
        className="icon-button"
        title="复制图层"
        aria-label={`复制“${node.name}”`}
        onClick={onDuplicate}
      >
        <Copy size={14} />
      </button>
      <button
        type="button"
        className="icon-button icon-button--danger"
        title="删除节点"
        aria-label={`删除“${node.name}”`}
        onClick={onDelete}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function listedTeacherControllerRow(
  visualRows: readonly EffectiveLayerProjectionRow[],
): EffectiveLayerProjectionRow | undefined {
  return visualRows.find((row) => row.isTeacherController && row.owner === 'global')
    ?? visualRows.find((row) => row.isTeacherController)
}

export function groupedVisualRows(visualRows: readonly EffectiveLayerProjectionRow[]): readonly {
  readonly id: 'global' | 'surface' | 'scene' | 'world'
  readonly label: string
  readonly rows: readonly EffectiveLayerProjectionRow[]
}[] {
  const specs = [
    { id: 'global' as const, label: '全局', owner: 'global' as const },
    { id: 'surface' as const, label: '本页', owner: 'surface' as const },
    { id: 'scene' as const, label: '场景', owner: 'scene' as const },
    { id: 'world' as const, label: '世界', owner: 'world' as const },
  ]
  const listedController = listedTeacherControllerRow(visualRows)
  return specs.flatMap((spec) => {
    const rows = visualRows.filter((row) => {
      if (row.isTeacherController) {
        return spec.id === 'global' && row === listedController
      }
      return row.owner === spec.owner
    })
    return rows.length === 0 ? [] : [{ id: spec.id, label: spec.label, rows }]
  })
}

function rowAsNode(row: EffectiveLayerProjectionRow): NodesTabRowNode {
  const projected = courseLayerItemToSceneNode(row.item)
  if (projected) return projected
  return {
    id: row.id,
    name: row.name,
    type: row.isTeacherController ? 'teacher-controller' : 'shape',
    visible: !row.hidden,
    locked: row.locked,
  }
}

export function isForeignTeacherControllerDrop(
  from: EffectiveLayerProjectionRow,
  to: EffectiveLayerProjectionRow,
): boolean {
  if (!from.isTeacherController && !to.isTeacherController) return false
  return from.owner !== 'global' || to.owner !== 'global' || from.ownerKey !== to.ownerKey
}

export function isRejectedSpatialOwnerDrop(
  surfaceType: CourseSurfaceType,
  from: EffectiveLayerProjectionRow,
  to: EffectiveLayerProjectionRow,
): boolean {
  if (surfaceType !== 'spatial-2d' || from.ownerKey === to.ownerKey) return false
  return (from.isTeacherController && from.owner === 'global' && to.owner !== 'global') ||
    isSpatialCrossCoordinateOwnerMove(from.item, from.owner, to.owner)
}

function sameOwnerDropRow(
  visualRows: readonly EffectiveLayerProjectionRow[],
  fromIndex: number,
  overIndex: number,
): EffectiveLayerProjectionRow | null {
  const from = visualRows[fromIndex]
  const over = visualRows[overIndex]
  if (!from || !over) return null
  if (from.ownerKey === over.ownerKey && !isForeignTeacherControllerDrop(from, over)) {
    return over
  }
  if (!isForeignTeacherControllerDrop(from, over)) return null
  const direction = overIndex > fromIndex ? 1 : -1
  for (let index = overIndex; index >= 0 && index < visualRows.length; index += direction) {
    const candidate = visualRows[index]
    if (!candidate || candidate.id === from.id) continue
    if (isForeignTeacherControllerDrop(from, candidate)) continue
    if (candidate.ownerKey === from.ownerKey) return candidate
  }
  return null
}

function layerKeyboardCoordinates(
  rowsRef: { current: readonly EffectiveLayerProjectionRow[] | null },
  preserveRawSpatialTargetsRef: { current: boolean },
): KeyboardCoordinateGetter {
  return (event, args) => {
    const rows = rowsRef.current
    const activeId = String(args.context.active?.id ?? args.active)
    const activeRow = rows?.find((row) => row.id === activeId)
    if (!rows || !activeRow || preserveRawSpatialTargetsRef.current) {
      return sortableKeyboardCoordinates(event, args)
    }
    const droppableContainers = args.context.droppableContainers
    return sortableKeyboardCoordinates(event, {
      ...args,
      context: {
        ...args.context,
        droppableContainers: {
          get: (id) => droppableContainers.get(id),
          getEnabled: () => droppableContainers.getEnabled().filter((entry) => {
            const row = rows.find((candidate) => candidate.id === String(entry.id))
            if (!row) return true
            return !isForeignTeacherControllerDrop(activeRow, row)
          }),
          toArray: () => droppableContainers.toArray(),
          getNodeFor: (id) => droppableContainers.getNodeFor(id),
        } as typeof droppableContainers,
      },
    })
  }
}

function layerCollisionDetection(
  rowsRef: { current: readonly EffectiveLayerProjectionRow[] | null },
  preserveRawSpatialTargetsRef: { current: boolean },
): CollisionDetection {
  return (args) => {
    const rows = rowsRef.current
    const activeRow = rows?.find((row) => row.id === String(args.active.id))
    if (!rows || !activeRow || preserveRawSpatialTargetsRef.current) return closestCenter(args)
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((container) => {
        const row = rows.find((candidate) => candidate.id === String(container.id))
        if (!row) return true
        return !isForeignTeacherControllerDrop(activeRow, row)
      }),
    })
  }
}

function flowOverlaySourceLabel(row: EffectiveLayerProjectionRow): string {
  const owner = row.owner === 'global' ? '全课' : '当前 Flow 页面'
  return `归属：${owner} · 定位：钉在视口${row.isTeacherController ? ' · 不可下沉' : ''}`
}

export function NodesTab() {
  const scene = useEditorStore(selectActiveScene)
  const v8Nodes = useEditorStore(selectEditingNodes)
  const projection = useEditorStore(selectEffectiveLayerProjection)
  const backendKind = useEditorStore(selectSlideBackendKind)
  const spatialSession = useEditorStore((state) => state.spatialSession)
  const flowSession = useEditorStore((state) => state.flowSession)
  const editingScope = useEditorStore((state) => state.editingScope)
  const candidate = (backendKind === 'slide-authoring' || Boolean(spatialSession) || Boolean(flowSession)) && projection !== null
  const unifiedRows = candidate ? projection.unifiedRows : null
  const visualRows = unifiedRows ? visualFrontToBackRows(unifiedRows) : null
  const rawLayerGroups = visualRows ? groupedVisualRows(visualRows) : null
  const layerGroups = rawLayerGroups
    ? rawLayerGroups.flatMap((group) => {
        const rows = editingScope === 'global'
          ? group.rows
          : group.rows.filter((row) => !row.isTeacherController)
        return rows.length === 0 ? [] : [{ ...group, rows }]
      })
    : null
  const nodes = layerGroups
    ? layerGroups.flatMap((group) => group.rows.map(rowAsNode))
    : [...v8Nodes].reverse()
  const flowView = useMemo(() => flowSession && editingScope !== 'global'
    ? buildFlowEditorView({
        project: flowSession.history.present,
        locationId: flowSession.selection.locationId,
      })
    : null, [editingScope, flowSession])
  const selectedNodeIds = useEditorStore((state) => state.selectedNodeIds)
  const selectNode = useEditorStore((state) => state.selectNode)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const deleteNode = useEditorStore((state) => state.deleteNode)
  const duplicateNode = useEditorStore((state) => state.duplicateNode)
  const updateNode = useEditorStore((state) => state.updateNode)
  const reorderNodes = useEditorStore((state) => state.reorderNodes)
  const moveCandidateLayerOwner = useEditorStore((state) => state.moveCandidateLayerOwner)
  const visualRowsRef = useRef(visualRows)
  visualRowsRef.current = visualRows
  const preserveRawSpatialTargetsRef = useRef(projection?.surfaceType === 'spatial-2d')
  preserveRawSpatialTargetsRef.current = projection?.surfaceType === 'spatial-2d'
  const skipControllerCoordinates = useMemo(
    () => layerKeyboardCoordinates(visualRowsRef, preserveRawSpatialTargetsRef),
    [],
  )
  const skipControllerCollision = useMemo(
    () => layerCollisionDetection(visualRowsRef, preserveRawSpatialTargetsRef),
    [],
  )
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: skipControllerCoordinates }),
  )

  const cancelRejectedSpatialDrop: CancelDrop = ({ active, over }) => {
    if (!over || !visualRows || projection?.surfaceType !== 'spatial-2d') return false
    const from = visualRows.find((row) => row.id === String(active.id))
    const to = visualRows.find((row) => row.id === String(over.id))
    if (!from || !to || !isRejectedSpatialOwnerDrop(projection.surfaceType, from, to)) {
      return false
    }
    moveCandidateLayerOwner(from.id, to.id)
    return true
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    if (visualRows && unifiedRows) {
      const oldIndex = visualRows.findIndex((row) => row.id === active.id)
      const newIndex = visualRows.findIndex((row) => row.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return
      const from = visualRows[oldIndex]!
      const overRow = visualRows[newIndex]!
      let to = overRow
      if (
        projection?.surfaceType === 'spatial-2d' &&
        isRejectedSpatialOwnerDrop(projection.surfaceType, from, overRow)
      ) {
        moveCandidateLayerOwner(from.id, overRow.id)
        return
      } else if (isForeignTeacherControllerDrop(from, overRow)) {
        const snapped = sameOwnerDropRow(visualRows, oldIndex, newIndex)
        if (!snapped) return
        to = snapped
      } else if (from.ownerKey !== overRow.ownerKey) {
        moveCandidateLayerOwner(from.id, overRow.id)
        return
      }
      const ownerVisual = visualRows.filter((row) => row.ownerKey === from.ownerKey)
      const ownerOld = ownerVisual.findIndex((row) => row.id === from.id)
      const ownerNew = ownerVisual.findIndex((row) => row.id === to.id)
      if (ownerOld < 0 || ownerNew < 0) return
      reorderNodes(
        arrayMove(ownerVisual, ownerOld, ownerNew)
          .reverse()
          .map((row) => row.id),
      )
      return
    }
    const visualNodes = [...v8Nodes].reverse()
    const oldIndex = visualNodes.findIndex((node) => node.id === active.id)
    const newIndex = visualNodes.findIndex((node) => node.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    reorderNodes(
      arrayMove(visualNodes, oldIndex, newIndex)
        .reverse()
        .map((node) => node.id),
    )
  }

  const selectFlowOutlineBlock = (blockId: string) => {
    const flow = useEditorStore.getState().flowSession
    if (!flow) return
    useEditorStore.getState().applyFlowSelection(
      selectFlowEditorBlocks(flow.history.present, flow.selection.locationId, [blockId]),
    )
  }

  const runFlowOutlineAction = (block: FlowBlockView, action: FlowOutlineAction) => {
    const state = useEditorStore.getState()
    const flow = state.flowSession
    if (!flow) return
    const target = {
      surfaceId: flow.selection.surfaceId,
      blockId: block.blockId,
      parentId: block.parentId,
    }
    const options = { expectedRevision: flow.history.present.revision }
    let result: FlowCommandResult
    if (action === 'move-up') {
      result = reorderFlowEditorBlock(flow.history.present, target, block.index - 1, options)
    } else if (action === 'move-down') {
      result = reorderFlowEditorBlock(flow.history.present, target, block.index + 1, options)
    } else if (action === 'indent') {
      result = indentFlowEditorBlock(flow.history.present, target, options)
    } else {
      result = outdentFlowEditorBlock(flow.history.present, target, options)
    }
    if (result.ok && result.nextDocument) {
      result = {
        ...result,
        selection: selectFlowEditorBlocks(
          result.nextDocument,
          flow.selection.locationId,
          [block.blockId],
        ),
      }
    }
    state.applyFlowCommand(result, {
      statusMessage: result.ok ? (result.reason ?? null) : null,
    })
  }

  return (
    <div className="nodes-tree" data-testid="nodes-tab">
      <div className="tree-root" onClick={() => selectNode(null)}>
        <ChevronDown size={14} />
        <Layers3 size={15} />
        <span>
          {flowSession
            ? (editingScope === 'global' ? '全课浮层' : '正文与浮层')
            : candidate
              ? '有效图层'
              : editingScope === 'global' ? '全局元素' : scene.name}
        </span>
        {selectedNodeIds.length > 0 && <span className="tree-selection-count">已选 {selectedNodeIds.length}</span>}
      </div>
      {flowView ? (
        <section
          className="nodes-layer-group"
          data-testid="flow-content-outline"
        >
          <h3 className="nodes-layer-group__title">正文大纲</h3>
          <div className="tree-order-note" data-testid="flow-content-placement">
            归属：当前 Flow 页面 · 定位：跟随稿纸
          </div>
          <div className="nodes-list">
            {flowView.blocks.map((block) => (
              <FlowOutlineRow
                key={block.blockId}
                block={block}
                blocks={flowView.blocks}
                selected={flowSession?.selection.selectedBlockIds.includes(block.blockId) === true}
                onSelect={() => selectFlowOutlineBlock(block.blockId)}
                onAction={(action) => runFlowOutlineAction(block, action)}
              />
            ))}
          </div>
        </section>
      ) : null}
      <div data-testid={flowSession ? 'flow-overlay-layers' : undefined}>
        {flowSession ? (
          <>
            <h3 className="nodes-layer-group__title">浮层</h3>
            <div className="tree-order-note" data-testid="flow-overlay-placement">
              {editingScope === 'global'
                ? '归属：全课 · 定位：钉在视口'
                : '归属：全课 / 当前 Flow 页面 · 定位：钉在视口'}
            </div>
          </>
        ) : null}
        {nodes.length === 0 ? (
          <div className="empty-state">
            {flowSession
              ? editingScope === 'global'
                ? '全课还没有可管理的浮层。'
                : '当前页面没有浮层。正文内容在上方大纲中按阅读顺序管理。'
              : editingScope === 'global' ? '全局层还没有组件' : '当前场景还没有节点'}
            {flowSession ? null : (
              <>
                <br />
                从“元素”面板加入{editingScope === 'global' ? '全局内容' : '内容'}
              </>
            )}
          </div>
        ) : (
          <>
          <DndContext
            sensors={sensors}
            collisionDetection={skipControllerCollision}
            cancelDrop={cancelRejectedSpatialDrop}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={nodes.map((node) => node.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="nodes-list">
                {layerGroups ? layerGroups.map((group) => (
                  <section
                    key={group.id}
                    className="nodes-layer-group"
                    data-testid={`nodes-layer-group-${group.id}`}
                  >
                    <h3 className="nodes-layer-group__title">
                      {flowSession
                        ? group.id === 'global' ? '全课浮层' : '当前 Flow 页面浮层'
                        : group.label}
                    </h3>
                    {group.rows.map((row) => {
                      const node = rowAsNode(row)
                      return (
                        <SortableNode
                          key={node.id}
                          node={node}
                          selected={selectedNodeIds.includes(node.id)}
                          sourceLabel={flowSession
                            ? flowOverlaySourceLabel(row)
                            : row.isTeacherController ? '全课、不可下沉' : row.sourceLabel}
                          impactLabel={describeLayerImpact(row.impact)}
                          onSelect={(additive) => {
                            selectNode(node.id, additive)
                            if (additive) setActiveTab('layers')
                          }}
                          onDelete={() => deleteNode(node.id)}
                          onDuplicate={() => duplicateNode(node.id)}
                          onRename={(name) => updateNode(node.id, { name })}
                          onToggleVisible={() => updateNode(node.id, { visible: !node.visible })}
                          onToggleLocked={() => updateNode(node.id, { locked: !node.locked })}
                        />
                      )
                    })}
                  </section>
                )) : nodes.map((node) => (
                  <SortableNode
                    key={node.id}
                    node={node}
                    selected={selectedNodeIds.includes(node.id)}
                    onSelect={(additive) => {
                      selectNode(node.id, additive)
                      if (additive) setActiveTab('layers')
                    }}
                    onDelete={() => deleteNode(node.id)}
                    onDuplicate={() => duplicateNode(node.id)}
                    onRename={(name) => updateNode(node.id, { name })}
                    onToggleVisible={() => updateNode(node.id, { visible: !node.visible })}
                    onToggleLocked={() => updateNode(node.id, { locked: !node.locked })}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <div
            className="tree-order-note"
            data-testid={spatialSession ? 'spatial-layer-move-note' : undefined}
          >
            {flowSession
              ? editingScope === 'global'
                ? '这里只管理归属全课、钉在视口的浮层；可拖动调整前后层级。'
                : '这里只管理钉在视口的浮层；可拖动调整前后层级。正文顺序使用上方大纲的结构按钮。'
              : spatialSession
              ? `同一定位内可拖动排序；${SPATIAL_CROSS_COORDINATE_MOVE_REASON}`
              : candidate
              ? '同一来源内可拖动排序；跨来源放置会改存储范围。教师控制器必须留在全课。'
              : editingScope === 'global'
                ? '列表顺序控制同一全局层级内的前后关系；underlay / overlay 在属性中设置。'
                : '列表最上方就是画面最上层；拖动条目可改变层级。'}
          </div>
          </>
        )}
      </div>
    </div>
  )
}
