import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  Table,
  BarChart3,
  Globe,
  Folder,
  Volume2,
  Code2,
  TextCursorInput,
  ListChecks,
  PanelTop,
  FileText,
  Zap,
  MessageSquare,
} from 'lucide-react'
import { containerChildIds, owningContainer, type ComponentFlowPlacement } from '../../shared/contracts/component-platform/project'
import { componentIsLocked } from '../composition/crossSurfaceCommands'
import { componentDefinitionPresentation } from './properties/componentDefinitionPresentation'
import {
  selectEditingScope,
  useEditorStore,
} from '../store/editorStore'

const nodeIcon = {
  'guoling.text': Type,
  'guoling.formula': Sigma,
  'guoling.image': ImageIcon,
  'guoling.video': Video,
  'guoling.shape': Square,
  'guoling.navigation': SlidersHorizontal,
  'guoling.table': Table,
  'guoling.chart': BarChart3,
  'guoling.audio': Volume2,
  'guoling.web': Globe,
  'guoling.html-program': Globe,
  'guoling.group': Folder,
  'guoling.input': TextCursorInput,
  'guoling.choice': ListChecks,
  'guoling.disclosure': ChevronDown,
  'guoling.popover': PanelTop,
  'guoling.document-block': FileText,
  'guoling.interactions': Zap,
  'guoling.feedback': MessageSquare,
  'guoling.visibility': Eye,
  source: Code2,
  behavior: Zap,
  component: Box,
} as const

interface NodesTabRowNode {
  id: string
  name: string
  type: string
  typeLabel: string
  visible: boolean
  locked: boolean
}

interface SortableNodeProps {
  node: NodesTabRowNode
  selected: boolean
  dragDisabled?: boolean
  sourceLabel?: string
  impactLabel?: string
  bodyPlane?: ComponentFlowPlacement['plane']
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
  dragDisabled,
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
    useSortable({ id: node.id, disabled: node.locked || dragDisabled })

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
      <span className="node-type-icon" title={node.typeLabel}>
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

export function NodesTab() {
  const view = useEditorStore(state => state.courseView)
  const scope = useEditorStore(selectEditingScope)
  const selectNode = useEditorStore(state => state.selectNode)
  const setActiveTab = useEditorStore(state => state.setActiveTab)
  const deleteNode = useEditorStore(state => state.deleteNode)
  const duplicateNode = useEditorStore(state => state.duplicateNode)
  const updateNode = useEditorStore(state => state.updateNode)
  const reorderNodes = useEditorStore(state => state.reorderNodes)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const project=view.editingProject, surface=project?.surfaces.find(value=>value.id===view.surfaceId)
  if(!project || !surface) return <div className="nodes-tree" data-testid="nodes-tab"><div className="empty-state">当前没有可编辑页面</div></div>
  const flowPage=surface.kind==='flow'&&scope!=='global'
  const flowOverlays=(plane:'overlay'|'underlay')=>surface.childIds.filter(id=>project.instances[id]?.flowPlacement?.plane===plane)
  const groups = [
    {id:'global-overlay',label:'全局 Overlay',ids:project.global.overlay},
    ...(scope==='global'?[]:flowPage?[
      {id:'surface-overlay',label:'正文上方',ids:flowOverlays('overlay')},
      {id:'flow-body',label:'正文',ids:[]},
      {id:'surface-underlay',label:'正文下方',ids:flowOverlays('underlay')},
    ]:[{id:'surface',label:surface.title,ids:surface.childIds}]),
    {id:'global-underlay',label:'全局 Underlay',ids:project.global.underlay},
  ]
  const allIds=groups.flatMap(group=>group.ids)
  const sortableIds=allIds.flatMap(function collect(id:string):string[]{ return [id,...(project.instances[id]?.childIds??[]).flatMap(collect)] })
  const updatePlacement=(id:string,plane:'underlay'|'overlay')=>{
    const state=useEditorStore.getState(),target=state.courseKernel.captureTarget(),item=target.project.instances[id]
    if(!item?.flowPlacement) return
    void state.courseKernel.editCaptured(state.courseKernel.capture([{type:'instance.flowPlacement.set',instanceId:id,flowPlacement:{...item.flowPlacement,plane}}],target)).catch(error=>state.setError(error instanceof Error?error.message:String(error)))
  }
  const onDragEnd=({active,over}:DragEndEvent)=>{
    if(!over || active.id===over.id) return
    const owner = owningContainer(project,String(active.id))
    const from=project.instances[String(active.id)],to=project.instances[String(over.id)]
    if(flowPage&&from?.flowPlacement && String(over.id)==='flow-body-boundary') {
      updatePlacement(String(active.id),from.flowPlacement.plane==='overlay'?'underlay':'overlay');return
    }
    if(flowPage&&(from?.flowPlacement?.plane!==to?.flowPlacement?.plane||from?.flowPlacement?.space!==to?.flowPlacement?.space)) { useEditorStore.getState().setError('不同正文平面或定位的浮层需要分别调整'); return }
    const ids = owner ? containerChildIds(project,owner).filter(id=>!flowPage || (project.instances[id]?.flowPlacement?.plane===from?.flowPlacement?.plane&&project.instances[id]?.flowPlacement?.space===from?.flowPlacement?.space)) : []
    const group={ids}
    if(!group || !group.ids.includes(String(over.id))) { useEditorStore.getState().setError('只能在同一归属和平面内调整层级'); return }
    const visual=[...group.ids].reverse()
    const next=arrayMove(visual,visual.indexOf(String(active.id)),visual.indexOf(String(over.id))).reverse()
    reorderNodes(next)
  }
  const renderItem=(id:string,depth=0):ReactNode=>{
    const item=project.instances[id]
    if(!item) return null
    const definition=project.definitions[item.definitionId]
    const presentation=componentDefinitionPresentation(definition)
    const node={id,name:item.name??presentation.title,type:presentation.iconType,
      typeLabel:`${presentation.title} · ${presentation.category}`,visible:item.visible!==false,locked:item.locked===true}
    return <div key={id} style={depth?{paddingLeft:depth*16}:undefined}>
      <SortableNode node={node} dragDisabled={componentIsLocked(project,id)} selected={view.selectedInstanceIds.includes(id)} sourceLabel={depth?'编组内对象':item.flowPlacement?.space==='viewport'?'钉在视口':item.flowPlacement?'跟随稿纸':undefined}
        {...(flowPage&&item.flowPlacement?{bodyPlane:item.flowPlacement.plane,onMoveAcrossBody:()=>updatePlacement(id,item.flowPlacement!.plane==='overlay'?'underlay':'overlay')}:{})}
        onSelect={additive=>{selectNode(id,additive);if(additive)setActiveTab('layers')}}
        onDelete={()=>deleteNode(id)} onDuplicate={()=>duplicateNode(id)} onRename={name=>updateNode(id,{name})}
        onToggleVisible={()=>updateNode(id,{visible:!node.visible})} onToggleLocked={()=>updateNode(id,{locked:!node.locked})}/>
      {item.childIds?.slice().reverse().map(child=>renderItem(child,depth+1))}
    </div>
  }
  return <div className="nodes-tree" data-testid="nodes-tab">
    <div className="tree-root" onClick={()=>selectNode(null)}><ChevronDown size={14}/><Layers3 size={15}/><span>{scope==='global'?'全局元素':surface.title}</span>
      {view.selectedInstanceIds.length>0&&<span className="tree-selection-count">已选 {view.selectedInstanceIds.length}</span>}</div>
    {!allIds.length&&!flowPage?<div className="empty-state">当前还没有对象<br/>从“元素”面板加入内容</div>:<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="nodes-list">{groups.filter(group=>group.ids.length||group.id==='flow-body').map(group=>group.id==='flow-body'?<FlowBodyBoundaryRow key={group.id}/>:<section key={group.id} className="nodes-layer-group" data-testid={`nodes-layer-group-${group.id}`}>
          <h3 className="nodes-layer-group__title">{group.label}</h3>{group.ids.slice().reverse().map(id=>renderItem(id))}
        </section>)}</div>
      </SortableContext>
    </DndContext>}
    <div className="tree-order-note">{flowPage?'正文内部顺序在稿纸中编辑；浮层可移到正文上方或下方，同一定位和平面内可拖动排序。':'列表最上方就是同一归属的最上层；隐藏对象仍可从这里显示，锁定对象仍可选择。'}</div>
  </div>
}




