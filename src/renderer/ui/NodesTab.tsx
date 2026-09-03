import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
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
import { useEffect, useMemo, useRef, useState } from 'react'
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
import type { CourseSurfaceType, FlowBodyLayerPlane } from '../../shared/courseProjectTypes'
import type { EditorCanvasNode } from '../phaser/editorCanvasNode'
import {
  SPATIAL_CROSS_COORDINATE_MOVE_REASON,
  isSpatialCrossCoordinateOwnerMove,
} from '../course/effectiveLayerCommands'
import { patchFlowOverlayBodyPlane } from '../course/flowSharedAuthoringAdapters'
import {
  courseLayerItemToEditorCanvasNode,
  describeLayerImpact,
  visualFrontToBackRows,
  type EffectiveLayerProjectionRow,
} from '../course/read-model'
import { selectFlowOverlay } from '../course/flowEditorSlice'
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

type NodesTabRowNode = Pick<EditorCanvasNode, 'id' | 'name' | 'type' | 'visible' | 'locked'>

interface SortableNodeProps {
  node: NodesTabRowNode
  selected: boolean
  sourceLabel?: string
  impactLabel?: string
  bodyPlane?: FlowBodyLayerPlane
  onMoveAcrossBody?: () => void
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
  bodyPlane,
  onMoveAcrossBody,
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
      className={`node-item${selected ? ' node-item--selected' : ''}${bodyPlane ? ' node-item--flow-plane' : ''}`}
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
      {bodyPlane && onMoveAcrossBody ? (
        <button
          type="button"
          className="icon-button"
          data-testid={`flow-move-across-body-${node.id}`}
          title={bodyPlane === 'overlay' ? '移到正文下方' : '移到正文上方'}
          aria-label={`${bodyPlane === 'overlay' ? '移到正文下方' : '移到正文上方'}“${node.name}”`}
          onClick={onMoveAcrossBody}
        >
          {bodyPlane === 'overlay' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
        </button>
      ) : null}
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
  readonly id: 'global-overlay' | 'surface' | 'scene' | 'world' | 'global-underlay'
  readonly label: string
  readonly rows: readonly EffectiveLayerProjectionRow[]
}[] {
  const specs = [
    { id: 'global-overlay' as const, label: '全局 Overlay', owner: 'global' as const },
    { id: 'surface' as const, label: '本页', owner: 'surface' as const },
    { id: 'scene' as const, label: '场景', owner: 'scene' as const },
    { id: 'world' as const, label: '世界', owner: 'world' as const },
    { id: 'global-underlay' as const, label: '全局 Underlay', owner: 'global' as const },
  ]
  const listedController = listedTeacherControllerRow(visualRows)
  return specs.flatMap((spec) => {
    const rows = visualRows.filter((row) => {
      if (row.isTeacherController) {
        return spec.id === 'global-overlay' && row === listedController
      }
      if (spec.id === 'global-overlay') {
        return row.owner === 'global' && row.globalPlane === 'overlay'
      }
      if (spec.id === 'global-underlay') {
        return row.owner === 'global' && row.globalPlane === 'underlay'
      }
      return row.owner === spec.owner
    })
    return rows.length === 0 ? [] : [{ id: spec.id, label: spec.label, rows }]
  })
}

type FlowLayerGroupId =
  | 'global-overlay'
  | 'surface-overlay'
  | 'surface-underlay'
  | 'global-underlay'

interface FlowLayerGroup {
  readonly id: FlowLayerGroupId
  readonly label: string
  readonly rows: readonly EffectiveLayerProjectionRow[]
}

export function groupedFlowVisualRows(
  visualRows: readonly EffectiveLayerProjectionRow[],
): readonly FlowLayerGroup[] {
  const specs = [
    { id: 'global-overlay' as const, label: '全课 Overlay' },
    { id: 'surface-overlay' as const, label: '正文上方' },
    { id: 'surface-underlay' as const, label: '正文下方' },
    { id: 'global-underlay' as const, label: '全课 Underlay' },
  ]
  return specs.flatMap((spec) => {
    const rows = visualRows.filter((row) => {
      if (row.isTeacherController) return false
      if (spec.id === 'global-overlay') {
        return row.owner === 'global' && row.globalPlane !== 'underlay'
      }
      if (spec.id === 'global-underlay') {
        return row.owner === 'global' && row.globalPlane === 'underlay'
      }
      if (spec.id === 'surface-underlay') {
        return row.owner === 'surface' && row.flowBodyPlane === 'underlay'
      }
      return row.owner === 'surface' && row.flowBodyPlane !== 'underlay'
    })
    return rows.length === 0 ? [] : [{ ...spec, rows }]
  })
}

const FLOW_BODY_BOUNDARY_ID = 'flow-body-boundary'

function FlowBodyBoundaryRow() {
  const { isOver, setNodeRef } = useDroppable({ id: FLOW_BODY_BOUNDARY_ID })
  return (
    <div
      ref={setNodeRef}
      className={`node-item flow-body-boundary${isOver ? ' flow-body-boundary--over' : ''}`}
      data-testid="flow-body-boundary"
      aria-label="Flow 正文合成边界"
    >
      <span aria-hidden="true" />
      <span className="node-type-icon" title="正文">
        <Type size={15} />
      </span>
      <div className="node-label node-label--with-source">
        <span className="node-name">正文</span>
        <small className="node-source">全部 FlowBlock · 跟随稿纸</small>
      </div>
    </div>
  )
}

function rowAsNode(row: EffectiveLayerProjectionRow): NodesTabRowNode {
  const projected = courseLayerItemToEditorCanvasNode(row.item)
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

export function isCrossGlobalPlaneDrop(
  from: EffectiveLayerProjectionRow,
  to: EffectiveLayerProjectionRow,
): boolean {
  return from.owner === 'global' && to.owner === 'global' &&
    from.globalPlane !== null && to.globalPlane !== null &&
    from.globalPlane !== to.globalPlane
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

function layerKeyboardCoordinates(
  rowsRef: { current: readonly EffectiveLayerProjectionRow[] | null },
): KeyboardCoordinateGetter {
  return (event, args) => {
    const rows = rowsRef.current
    const activeId = String(args.context.active?.id ?? args.active)
    const activeRow = rows?.find((row) => row.id === activeId)
    if (!rows || !activeRow) {
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
            return row.reorderGroupKey === activeRow.reorderGroupKey
          }),
          toArray: () => droppableContainers.toArray(),
          getNodeFor: (id) => droppableContainers.getNodeFor(id),
        } as typeof droppableContainers,
      },
    })
  }
}

function flowOverlaySourceLabel(row: EffectiveLayerProjectionRow): string {
  const owner = row.owner === 'global'
    ? `全课 ${row.globalPlane === 'underlay' ? 'Underlay' : 'Overlay'}`
    : `当前 Flow 页面 · 正文${row.flowBodyPlane === 'underlay' ? '下方' : '上方'}`
  const positioning = row.item.paperSpace === 'paper' ? '跟随稿纸' : '钉在视口'
  return `归属：${owner} · 定位：${positioning}${row.isTeacherController ? ' · 不可下沉' : ''}`
}

function effectiveLayerSourceLabel(row: EffectiveLayerProjectionRow): string {
  if (row.owner !== 'global') return row.sourceLabel
  const plane = row.globalPlane === 'underlay' ? 'Underlay' : 'Overlay'
  return row.isTeacherController ? `全课 ${plane}、不可下沉` : `全课 ${plane}`
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
  const flowPageMode = Boolean(flowSession) && editingScope !== 'global'
  const flowLayerGroups = flowPageMode && visualRows ? groupedFlowVisualRows(visualRows) : null
  const displayedLayerGroups = flowLayerGroups ?? layerGroups
  const nodes = displayedLayerGroups
    ? displayedLayerGroups.flatMap((group) => group.rows.map(rowAsNode))
    : [...v8Nodes].reverse()
  const selectedNodeIds = useEditorStore((state) => state.selectedNodeIds)
  const selectNode = useEditorStore((state) => state.selectNode)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const deleteNode = useEditorStore((state) => state.deleteNode)
  const duplicateNode = useEditorStore((state) => state.duplicateNode)
  const updateNode = useEditorStore((state) => state.updateNode)
  const reorderNodes = useEditorStore((state) => state.reorderNodes)
  const visualRowsRef = useRef(visualRows)
  visualRowsRef.current = visualRows
  const skipControllerCoordinates = useMemo(
    () => layerKeyboardCoordinates(visualRowsRef),
    [],
  )
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: skipControllerCoordinates }),
  )

  const moveFlowSurfaceRow = (
    row: EffectiveLayerProjectionRow,
    bodyPlane: FlowBodyLayerPlane,
  ) => {
    const state = useEditorStore.getState()
    const flow = state.flowSession
    if (!flow || row.owner !== 'surface') return
    const selection = selectFlowOverlay(
      flow.history.present,
      flow.selection.locationId,
      [row.id],
      'page',
    )
    const result = patchFlowOverlayBodyPlane(
      flow.history.present,
      selection,
      bodyPlane,
      { expectedRevision: flow.history.present.revision },
    )
    state.applyFlowCommand(result, {
      statusMessage: result.ok ? (result.reason ?? null) : null,
    })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    if (visualRows && unifiedRows) {
      const oldIndex = visualRows.findIndex((row) => row.id === active.id)
      if (flowPageMode && over.id === FLOW_BODY_BOUNDARY_ID) {
        if (oldIndex < 0) return
        const from = visualRows[oldIndex]!
        if (from.owner !== 'surface') return
        moveFlowSurfaceRow(
          from,
          from.flowBodyPlane === 'underlay' ? 'overlay' : 'underlay',
        )
        return
      }
      const newIndex = visualRows.findIndex((row) => row.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return
      const from = visualRows[oldIndex]!
      const overRow = visualRows[newIndex]!
      if (
        flowPageMode &&
        from.owner === 'surface' &&
        overRow.owner === 'surface' &&
        from.flowBodyPlane !== overRow.flowBodyPlane
      ) {
        moveFlowSurfaceRow(from, overRow.flowBodyPlane ?? 'overlay')
        return
      }
      if (from.reorderGroupKey !== overRow.reorderGroupKey) {
        reorderNodes([from.id, overRow.id])
        return
      }
      const ownerVisual = visualRows.filter(
        (row) => row.reorderGroupKey === from.reorderGroupKey,
      )
      const ownerOld = ownerVisual.findIndex((row) => row.id === from.id)
      const ownerNew = ownerVisual.findIndex((row) => row.id === overRow.id)
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

  const renderLayerRow = (row: EffectiveLayerProjectionRow) => {
    const node = rowAsNode(row)
    const bodyPlane = row.owner === 'surface' && row.flowBodyPlane !== null
      ? row.flowBodyPlane
      : null
    return (
      <SortableNode
        key={node.id}
        node={node}
        selected={selectedNodeIds.includes(node.id)}
        sourceLabel={flowSession
          ? flowOverlaySourceLabel(row)
          : effectiveLayerSourceLabel(row)}
        impactLabel={describeLayerImpact(row.impact)}
        {...(flowPageMode && bodyPlane
          ? {
              bodyPlane,
              onMoveAcrossBody: () => moveFlowSurfaceRow(
                row,
                bodyPlane === 'overlay' ? 'underlay' : 'overlay',
              ),
            }
          : {})}
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
  }

  const renderLayerGroup = (group: {
    readonly id: string
    readonly label: string
    readonly rows: readonly EffectiveLayerProjectionRow[]
  }) => (
    <section
      key={group.id}
      className="nodes-layer-group"
      data-testid={`nodes-layer-group-${group.id}`}
    >
      <h3 className="nodes-layer-group__title">{group.label}</h3>
      {group.rows.map(renderLayerRow)}
    </section>
  )

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
      <div data-testid={flowSession ? 'flow-overlay-layers' : undefined}>
        {flowSession ? (
          <>
            <h3 className="nodes-layer-group__title">
              {editingScope === 'global' ? '全课浮层' : '合成顺序'}
            </h3>
            <div className="tree-order-note" data-testid="flow-overlay-placement">
              {editingScope === 'global'
                ? '归属：全课 · 定位：钉在视口'
                : '页面浮层可排在正文上方或下方；正文内部顺序在稿纸中编辑。'}
            </div>
          </>
        ) : null}
        {!flowPageMode && nodes.length === 0 ? (
          <div className="empty-state">
            {flowSession
              ? '全课还没有可管理的浮层。'
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
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={nodes.map((node) => node.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="nodes-list">
                {flowPageMode ? (
                  <>
                    {flowLayerGroups?.filter((group) => group.id === 'global-overlay').map(renderLayerGroup)}
                    {flowLayerGroups?.filter((group) => group.id === 'surface-overlay').map(renderLayerGroup)}
                    <FlowBodyBoundaryRow />
                    {flowLayerGroups?.filter((group) => group.id === 'surface-underlay').map(renderLayerGroup)}
                    {flowLayerGroups?.filter((group) => group.id === 'global-underlay').map(renderLayerGroup)}
                  </>
                ) : displayedLayerGroups ? displayedLayerGroups.map(renderLayerGroup) : nodes.map((node) => (
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
                ? '这里只管理归属全课的浮层；可在同一 Underlay / Overlay 分组内调整前后层级。'
                : '拖到“正文”边界或使用上下按钮即可跨越正文；同一侧内可拖动排序。全课浮层仍只在各自平面内排序。'
              : spatialSession
              ? `同一定位内可拖动排序；${SPATIAL_CROSS_COORDINATE_MOVE_REASON}`
              : candidate
              ? '同一来源内可拖动排序；全课图层还必须位于同一 Underlay / Overlay 分组。跨来源不能通过排序移动。'
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
