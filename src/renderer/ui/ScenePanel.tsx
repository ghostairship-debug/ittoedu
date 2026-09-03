import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
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
import { FileText, Globe2, GripVertical, Layers3, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { COURSE_LAST_LOCATION_REASON } from '../course/courseLocationCommands'
import { deriveCourseEditorLayout, type CourseEditorLayoutResult } from '../course/courseEditorLayout'
import {
  buildSpatialEditorView,
  captureSpatialEditorAuthoringTarget,
  type SpatialEditorAuthoringTargetInput,
} from '../course/spatialEditorView'
import {
  COURSE_AUTHORING_STALE_SESSION_REASON,
  type CourseAuthoringSessionToken,
  type CourseAuthoringTarget,
} from '../authoring/courseAuthoringSession'
import type { SpatialWorldContentEditSession } from '../authoring/spatialWorldAuthoring'
import type {
  SpatialAuthoringIntent,
  SpatialAuthoringIntentInput,
} from '../authoring/spatialAuthoringIntents'
import { selectFlowEditorBlock } from '../course/flowEditorSlice'
import {
  buildCourseTreeView,
  SPATIAL_CAMERA_GROUP_LABEL,
  type CourseTreeNode,
} from '../course/courseTreeView'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectCandidateGlobalLayerItems,
  useEditorStore,
} from '../store/editorStore'
import { AddCourseContentMenu } from './AddCourseContentMenu'
import { ConfirmDialog } from './ConfirmDialog'

const COURSE_TREE_ROOT_KEY = '__course-tree-root__'

const SORTABLE_PAGE_KINDS = new Set(['slide-page', 'flow-page', 'spatial-page'])

export type CourseTreeReorderPlan =
  | { readonly kind: 'surfaces'; readonly surfaceIds: string[] }
  | { readonly kind: 'scenes'; readonly sceneIds: string[] }
  | { readonly kind: 'migrate-scene'; readonly locationId: string; readonly targetSurfaceId: string; readonly toIndex: number }
  | { readonly kind: 'cameras'; readonly surfaceId: string; readonly frameId: string; readonly toIndex: number }

interface PendingSpatialCameraDelete {
  readonly projectId: string
  readonly revision: number
  readonly locationId: string
  readonly surfaceId: string
  readonly frameId: string
  readonly label: string
  readonly authoringToken: CourseAuthoringSessionToken
  readonly target: CourseAuthoringTarget | null
  readonly contentEdit: SpatialWorldContentEditSession | null
}

function sameCourseAuthoringToken(
  left: CourseAuthoringSessionToken | null | undefined,
  right: CourseAuthoringSessionToken,
): boolean {
  return Boolean(
    left
    && left.locationId === right.locationId
    && left.surfaceType === right.surfaceType
    && left.revision === right.revision
    && left.generation === right.generation,
  )
}

type CourseTreeSortableKind = 'page' | 'slide-scene' | 'spatial-camera'

interface CourseTreeSortableSlot {
  readonly id: string
  readonly kind: CourseTreeSortableKind
  readonly parentKey: string
  readonly surfaceId: string
}

function indexCourseTreeSlots(pages: readonly CourseTreeNode[]): Map<string, CourseTreeSortableSlot> {
  const slots = new Map<string, CourseTreeSortableSlot>()
  for (const page of pages) {
    if (SORTABLE_PAGE_KINDS.has(page.kind)) {
      slots.set(page.id, {
        id: page.id,
        kind: 'page',
        parentKey: COURSE_TREE_ROOT_KEY,
        surfaceId: page.surfaceId,
      })
    }
    if (page.kind === 'slide-page') {
      for (const child of page.children) {
        if (child.kind !== 'slide-scene') continue
        slots.set(child.id, {
          id: child.id,
          kind: 'slide-scene',
          parentKey: page.id,
          surfaceId: page.surfaceId,
        })
      }
    }
    if (page.kind === 'spatial-page') {
      for (const group of page.children) {
        if (group.kind !== 'spatial-camera-group') continue
        for (const camera of group.children) {
          if (camera.kind !== 'spatial-camera') continue
          slots.set(camera.id, {
            id: camera.id,
            kind: 'spatial-camera',
            parentKey: group.id,
            surfaceId: page.surfaceId,
          })
        }
      }
    }
  }
  return slots
}

function slideSceneIdOf(
  project: Pick<CourseProjectDocument, 'locations'>,
  locationId: string,
): string | null {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  return location?.kind === 'slide-scene' ? location.sceneId : null
}

export function planCourseTreeReorder(
  project: Pick<CourseProjectDocument, 'locations' | 'surfaces'>,
  pages: readonly CourseTreeNode[],
  activeId: string,
  overId: string,
): CourseTreeReorderPlan | null {
  if (!activeId || !overId || activeId === overId) return null
  const slots = indexCourseTreeSlots(pages)
  const active = slots.get(activeId)
  const over = slots.get(overId)
  if (!active || !over) return null

  if (active.kind === 'slide-scene' && active.surfaceId !== over.surfaceId) {
    const targetSurface = project.surfaces.find((candidate) => candidate.id === over.surfaceId)
    if (!targetSurface || targetSurface.type !== 'slide') return null
    if (over.kind !== 'page' && over.kind !== 'slide-scene') return null
    const fromSceneId = slideSceneIdOf(project, activeId)
    if (!fromSceneId) return null
    let toIndex = targetSurface.scenes.length
    if (over.kind === 'slide-scene') {
      const toSceneId = slideSceneIdOf(project, overId)
      if (!toSceneId) return null
      const overIndex = targetSurface.scenes.findIndex((scene) => scene.id === toSceneId)
      if (overIndex < 0) return null
      toIndex = overIndex
    }
    return {
      kind: 'migrate-scene',
      locationId: activeId,
      targetSurfaceId: over.surfaceId,
      toIndex,
    }
  }

  if (active.parentKey !== over.parentKey) return null
  if (active.kind !== over.kind) return null

  if (active.kind === 'page') {
    const surfaceIds = pages.map((page) => page.id)
    const oldIndex = surfaceIds.indexOf(activeId)
    const newIndex = surfaceIds.indexOf(overId)
    if (oldIndex < 0 || newIndex < 0) return null
    return { kind: 'surfaces', surfaceIds: arrayMove(surfaceIds, oldIndex, newIndex) }
  }

  if (active.kind === 'slide-scene') {
    const surface = project.surfaces.find((candidate) => candidate.id === active.surfaceId)
    if (!surface || surface.type !== 'slide') return null
    const fromSceneId = slideSceneIdOf(project, activeId)
    const toSceneId = slideSceneIdOf(project, overId)
    if (!fromSceneId || !toSceneId) return null
    const sceneIds = surface.scenes.map((scene) => scene.id)
    const oldIndex = sceneIds.indexOf(fromSceneId)
    const newIndex = sceneIds.indexOf(toSceneId)
    if (oldIndex < 0 || newIndex < 0) return null
    return { kind: 'scenes', sceneIds: arrayMove(sceneIds, oldIndex, newIndex) }
  }

  const surface = project.surfaces.find((candidate) => candidate.id === active.surfaceId)
  if (!surface || surface.type !== 'spatial-2d') return null
  const frameIdOf = (locationId: string) => {
    const location = project.locations.find((candidate) => candidate.id === locationId)
    return location?.kind === 'spatial-camera' ? location.cameraFrameId : null
  }
  const frameId = frameIdOf(activeId)
  const overFrameId = frameIdOf(overId)
  if (!frameId || !overFrameId) return null
  const toIndex = surface.camera.frames.findIndex((frame) => frame.id === overFrameId)
  if (toIndex < 0) return null
  return { kind: 'cameras', surfaceId: active.surfaceId, frameId, toIndex }
}

function isSortableCourseTreeNode(kind: CourseTreeNode['kind']): boolean {
  return kind === 'slide-page'
    || kind === 'flow-page'
    || kind === 'spatial-page'
    || kind === 'slide-scene'
    || kind === 'spatial-camera'
}

function thumbnailStateNameForTreeNode(
  project: CourseProjectDocument,
  node: CourseTreeNode,
): string | null {
  if (node.kind !== 'slide-scene' || !node.locationId) return null
  const location = project.locations.find((candidate) => candidate.id === node.locationId)
  if (location?.kind !== 'slide-scene') return null
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (surface?.type !== 'slide') return null
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  const presentation = scene?.presentation
  if (!presentation) return '初始'
  const stateId = presentation.thumbnailStateId ?? presentation.initialStateId
  return presentation.states.find((state) => state.id === stateId)?.name ?? '初始'
}

function slideSceneCountOnSamePage(
  project: CourseProjectDocument,
  node: CourseTreeNode,
): number {
  if (node.kind !== 'slide-scene') return 0
  const surface = project.surfaces.find((candidate) => candidate.id === node.surfaceId)
  return surface?.type === 'slide' ? surface.scenes.length : 0
}

function slideSceneIdFromLocation(
  project: CourseProjectDocument,
  locationId: string,
): string | null {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  return location?.kind === 'slide-scene' ? location.sceneId : null
}

function panelLayoutForActiveLocation(
  project: NonNullable<ReturnType<typeof selectActiveCourseProjectDocument>>,
  activeLocationId: string | null,
): CourseEditorLayoutResult {
  const base = deriveCourseEditorLayout(project, activeLocationId ?? undefined)
  if (base.kind !== 'mixed' || !activeLocationId) return base
  const location = project.locations.find((candidate) => candidate.id === activeLocationId)
  const surface = project.surfaces.find((candidate) => candidate.id === location?.surfaceId)
  if (surface?.type === 'flow') {
    return {
      ...base,
      primary: { action: 'flow-page' },
      dropdown: ['slide-page', 'spatial-page'],
    }
  }
  if (surface?.type === 'spatial-2d') {
    return {
      ...base,
      primary: { action: 'spatial-page' },
      dropdown: ['slide-page', 'flow-page'],
    }
  }
  return base
}

function SortableCourseTreeNode({
  node,
  depth,
  row,
  nested,
}: {
  node: CourseTreeNode
  depth: number
  row: ReactNode
  nested: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id })
  return (
    <div
      ref={setNodeRef}
      className="course-page-tree__node"
      data-kind={node.kind}
      data-testid={`course-page-node-${node.id}`}
      style={{
        marginLeft: depth * 14,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
    >
      <div className="course-page-tree__row">
        <button
          type="button"
          className="drag-handle"
          title="拖动调整顺序"
          aria-label={`拖动“${node.label}”`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={15} />
        </button>
        {row}
      </div>
      {nested}
    </div>
  )
}

function CourseTreeNodeRow({
  node,
  activeLocationId,
  depth,
  onActivateLocation,
  onRenameFlowPage,
  onRenameFlowHeading,
  onAddSpatialCamera,
  onDeleteSpatialCamera,
  onDeleteSlideScene,
  onDeleteSurface,
}: {
  node: CourseTreeNode
  activeLocationId: string | null
  depth: number
  onActivateLocation(locationId: string): void
  onRenameFlowPage?(surfaceId: string, title: string): void
  onRenameFlowHeading?(locationId: string, title: string): void
  onAddSpatialCamera?(surfaceId: string): void
  onDeleteSpatialCamera?(locationId: string): void
  onDeleteSlideScene?(locationId: string): void
  onDeleteSurface?(surfaceId: string): void
}) {
  const editingScope = useEditorStore((state) => state.editingScope)
  const project = useEditorStore(selectActiveCourseProjectDocument)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const active = Boolean(
    node.locationId &&
    node.locationId === activeLocationId &&
    editingScope !== 'global',
  )
  const thumbnailStateName = project ? thumbnailStateNameForTreeNode(project, node) : null
  const canDeleteSlideScene = Boolean(
    project &&
    node.kind === 'slide-scene' &&
    (
      slideSceneCountOnSamePage(project, node) > 1 ||
      project.locations.some((location) => location.surfaceId !== node.surfaceId)
    ),
  )
  const canDeleteSurface = Boolean(
    project
    && (node.kind === 'slide-page' || node.kind === 'flow-page' || node.kind === 'spatial-page')
    && project.locations.some((location) => location.surfaceId !== node.surfaceId),
  )

  const commitRename = () => {
    if (!editingKey) return
    const next = draft.trim()
    if (editingKey.startsWith('page:') && next) {
      onRenameFlowPage?.(editingKey.slice('page:'.length), next)
    } else if (editingKey.startsWith('heading:') && next) {
      onRenameFlowHeading?.(editingKey.slice('heading:'.length), next)
    }
    setEditingKey(null)
  }

  const renderChild = (child: CourseTreeNode) => (
    <CourseTreeNodeRow
      key={child.id}
      node={child}
      activeLocationId={activeLocationId}
      depth={depth + 1}
      onActivateLocation={onActivateLocation}
      onRenameFlowPage={onRenameFlowPage}
      onRenameFlowHeading={onRenameFlowHeading}
      onAddSpatialCamera={onAddSpatialCamera}
      onDeleteSpatialCamera={onDeleteSpatialCamera}
      onDeleteSlideScene={onDeleteSlideScene}
      onDeleteSurface={onDeleteSurface}
    />
  )

  if (node.kind === 'spatial-camera-group') {
    return (
      <div
        className="course-page-tree__node course-page-tree__node--camera-group"
        data-kind={node.kind}
        data-testid={`course-page-node-${node.id}`}
        style={{ marginLeft: depth * 14 }}
      >
        <div className="spatial-page-tree__group course-page-tree__group-row">
          <span>{SPATIAL_CAMERA_GROUP_LABEL}</span>
          <button
            type="button"
            className="icon-button"
            data-testid="add-spatial-camera"
            aria-label="添加镜头"
            title="从当前画面添加镜头"
            onClick={() => onAddSpatialCamera?.(node.surfaceId)}
          >
            <Plus size={14} />
          </button>
        </div>
        <SortableContext
          items={node.children.map((child) => child.id)}
          strategy={verticalListSortingStrategy}
        >
          {node.children.map(renderChild)}
        </SortableContext>
      </div>
    )
  }

  const labelContent = editingKey === node.id ? (
    <input
      autoFocus
      className="scene-name-input"
      value={draft}
      maxLength={80}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitRename}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setEditingKey(null)
      }}
    />
  ) : (
    <span>{node.label}</span>
  )

  const row = (
    <>
      <button
        type="button"
        className={`course-page-tree__label${active ? ' is-active' : ''}${
          node.kind === 'flow-heading' || node.kind === 'flow-section'
            ? ' course-page-tree__label--heading'
            : ''
        }`}
        disabled={!node.locationId}
        aria-current={active ? 'page' : undefined}
        aria-label={
          node.kind === 'slide-scene' && thumbnailStateName
            ? `打开场景“${node.label}”；缩略图使用状态“${thumbnailStateName}”`
            : undefined
        }
        data-testid={
          node.kind === 'flow-page'
            ? `flow-page-${node.surfaceId}`
            : node.kind === 'flow-heading' || node.kind === 'flow-section'
              ? `flow-heading-${node.locationId}`
              : node.kind === 'spatial-camera'
                ? `spatial-camera-${node.id}`
                : node.kind === 'slide-scene'
                  ? `scene-item-${node.id}`
                  : undefined
        }
        data-heading-level={
          node.kind === 'flow-heading' || node.kind === 'flow-section'
            ? node.kind === 'flow-section' ? 2 : 1
            : undefined
        }
        onClick={() => {
          if (node.locationId) onActivateLocation(node.locationId)
        }}
        onDoubleClick={(event) => {
          if (node.kind === 'flow-page') {
            event.preventDefault()
            setEditingKey(`page:${node.surfaceId}`)
            setDraft(node.label)
            return
          }
          if (node.kind === 'flow-heading' || node.kind === 'flow-section') {
            event.preventDefault()
            setEditingKey(`heading:${node.locationId}`)
            setDraft(node.label)
          }
        }}
      >
        {node.kind === 'flow-page' || node.kind === 'spatial-page' || node.kind === 'slide-page' ? (
          <FileText size={14} />
        ) : null}
        {labelContent}
        {node.kind === 'slide-scene' && thumbnailStateName ? (
          <small>缩略图 · {thumbnailStateName}</small>
        ) : null}
      </button>
      {node.kind === 'spatial-camera' && onDeleteSpatialCamera && node.locationId ? (
        <button
          type="button"
          className="icon-button"
          aria-label={`删除镜头 ${node.label}`}
          onClick={() => onDeleteSpatialCamera(node.locationId!)}
        >
          <Trash2 size={14} />
        </button>
      ) : null}
      {node.kind === 'slide-page' || node.kind === 'flow-page' || node.kind === 'spatial-page' ? (
        <button
          type="button"
          className="icon-button icon-button--danger"
          title={canDeleteSurface ? '删除页面' : COURSE_LAST_LOCATION_REASON}
          aria-label={`删除页面“${node.label}”`}
          disabled={!canDeleteSurface}
          onClick={(event) => {
            event.stopPropagation()
            if (canDeleteSurface) onDeleteSurface?.(node.surfaceId)
          }}
        >
          <Trash2 size={14} />
        </button>
      ) : null}
      {node.kind === 'slide-scene' && node.locationId ? (
        <button
          type="button"
          className="icon-button icon-button--danger"
          title={canDeleteSlideScene ? '删除场景' : COURSE_LAST_LOCATION_REASON}
          aria-label={`删除“${node.label}”`}
          disabled={!canDeleteSlideScene}
          onClick={(event) => {
            event.stopPropagation()
            if (canDeleteSlideScene) onDeleteSlideScene?.(node.locationId!)
          }}
        >
          <Trash2 size={14} />
        </button>
      ) : null}
    </>
  )

  const nested = node.kind === 'slide-page' ? (
    <SortableContext
      items={node.children.map((child) => child.id)}
      strategy={verticalListSortingStrategy}
    >
      {node.children.map(renderChild)}
    </SortableContext>
  ) : (
    node.children.map(renderChild)
  )

  if (isSortableCourseTreeNode(node.kind)) {
    return (
      <SortableCourseTreeNode node={node} depth={depth} row={row} nested={nested} />
    )
  }

  return (
    <div
      className="course-page-tree__node"
      data-kind={node.kind}
      data-testid={`course-page-node-${node.id}`}
      style={{ marginLeft: depth * 14 }}
    >
      <div className="course-page-tree__row">
        {row}
      </div>
      {nested}
    </div>
  )
}

export function ScenePanel() {
  const project = useEditorStore(selectActiveCourseProjectDocument)
  const activeLocationId = useEditorStore(selectActiveCourseLocationId)
  const editingScope = useEditorStore((state) => state.editingScope)
  const globalLayerCount = useEditorStore(selectCandidateGlobalLayerItems)?.length ?? 0
  const setEditingScope = useEditorStore((state) => state.setEditingScope)
  const activateCourseLocation = useEditorStore((state) => state.activateCourseLocation)
  const addCourseContent = useEditorStore((state) => state.addCourseContent)
  const reorderCourseSurfaces = useEditorStore((state) => state.reorderCourseSurfaces)
  const deleteCourseSurface = useEditorStore((state) => state.deleteCourseSurface)
  const moveCourseSlideScene = useEditorStore((state) => state.moveCourseSlideScene)
  const reorderScenes = useEditorStore((state) => state.reorderScenes)
  const applyFlowSelection = useEditorStore((state) => state.applyFlowSelection)
  const renameFlowHeading = useEditorStore((state) => state.renameFlowHeading)
  const renameFlowPage = useEditorStore((state) => state.renameFlowPage)
  const flowSession = useEditorStore((state) => state.flowSession)
  const [pendingDeleteCamera, setPendingDeleteCamera] = useState<PendingSpatialCameraDelete | null>(null)
  const [pendingDeleteSceneId, setPendingDeleteSceneId] = useState<string | null>(null)
  const [pendingDeleteSurfaceId, setPendingDeleteSurfaceId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const treeView = useMemo(
    () => (project ? buildCourseTreeView(project) : null),
    [project],
  )
  const layout = useMemo(
    () => (project ? panelLayoutForActiveLocation(project, activeLocationId) : null),
    [project, activeLocationId],
  )

  const pendingSceneName = useMemo(() => {
    if (!project || !pendingDeleteSceneId) return null
    for (const surface of project.surfaces) {
      if (surface.type !== 'slide') continue
      const scene = surface.scenes.find((candidate) => candidate.id === pendingDeleteSceneId)
      if (scene) return scene.name
    }
    return pendingDeleteSceneId
  }, [project, pendingDeleteSceneId])

  const pendingSurfaceName = useMemo(() => {
    if (!project || !pendingDeleteSurfaceId) return null
    return project.surfaces.find((surface) => surface.id === pendingDeleteSurfaceId)?.title
      ?? pendingDeleteSurfaceId
  }, [project, pendingDeleteSurfaceId])

  if (!project || !treeView || !layout) {
    return null
  }

  const activateLocation = (locationId: string) => {
    const location = project.locations.find((candidate) => candidate.id === locationId)
    if (!location) return
    if (location.kind === 'flow-block') {
      if (flowSession) {
        applyFlowSelection(selectFlowEditorBlock(project, locationId, location.blockId))
      } else {
        activateCourseLocation(locationId)
      }
      return
    }
    activateCourseLocation(locationId)
  }

  const captureLiveSpatialTarget = (
    locationId: string,
    targetInput: SpatialEditorAuthoringTargetInput,
  ): {
    readonly target: CourseAuthoringTarget
    readonly contentEdit: SpatialWorldContentEditSession | null
    readonly camera: { readonly x: number; readonly y: number; readonly zoom: number }
  } | null => {
    const requested = project.locations.find((location) => location.id === locationId)
    if (requested?.kind !== 'spatial-camera') return null
    const before = useEditorStore.getState().spatialSession
    if (
      !before
      || before.selection.surfaceId !== requested.surfaceId
    ) {
      activateCourseLocation(requested.id)
    }
    const store = useEditorStore.getState()
    const session = store.spatialSession
    const token = store.courseAuthoringSession?.token
    if (
      !session
      || !token
      || token.surfaceType !== 'spatial-2d'
      || session.selection.surfaceId !== requested.surfaceId
      || token.locationId !== session.selection.locationId
      || token.revision !== session.history.present.revision
    ) return null
    const view = buildSpatialEditorView({
      project: session.history.present,
      locationId: session.selection.locationId,
      sessionCamera: session.sessionCamera,
    })
    try {
      return {
        target: captureSpatialEditorAuthoringTarget({ view, sessionToken: token, target: targetInput }),
        contentEdit: store.spatialContentEdit,
        camera: view.sessionCamera,
      }
    } catch {
      return null
    }
  }

  const runLiveSpatialIntent = (
    locationId: string,
    targetInput: SpatialEditorAuthoringTargetInput,
    buildIntent: (captured: ReturnType<typeof captureLiveSpatialTarget> & {}) => SpatialAuthoringIntentInput,
  ) => {
    const captured = captureLiveSpatialTarget(locationId, targetInput)
    if (!captured) return
    useEditorStore.getState().runSpatialAuthoringIntent(captured.target, {
      ...buildIntent(captured),
      expectedContentEdit: captured.contentEdit,
    } as SpatialAuthoringIntent)
  }

  const handlePrimaryAdd = () => {
    if (layout.primary.action === 'scene' && layout.primary.surfaceId) {
      addCourseContent('scene', { surfaceId: layout.primary.surfaceId })
      return
    }
    addCourseContent(layout.primary.action)
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const plan = planCourseTreeReorder(
      project,
      treeView.pages,
      String(active.id),
      String(over.id),
    )
    if (!plan) return
    if (plan.kind === 'surfaces') {
      reorderCourseSurfaces(plan.surfaceIds)
      return
    }
    if (plan.kind === 'scenes') {
      if (flowSession || useEditorStore.getState().spatialSession) {
        const dragged = project.locations.find((location) => location.id === String(active.id))
        if (dragged) activateCourseLocation(dragged.id)
      }
      reorderScenes(plan.sceneIds)
      return
    }
    if (plan.kind === 'migrate-scene') {
      moveCourseSlideScene(plan.locationId, plan.targetSurfaceId, plan.toIndex)
      return
    }
    const location = project.locations.find((candidate) =>
      candidate.kind === 'spatial-camera'
      && candidate.surfaceId === plan.surfaceId
      && candidate.cameraFrameId === plan.frameId,
    )
    if (!location) return
    const expectedFrameIds = project.surfaces.find((surface) => surface.id === plan.surfaceId)
    const expectedCameraFrameIds = expectedFrameIds?.type === 'spatial-2d'
      ? expectedFrameIds.camera.frames.map((frame) => frame.id)
      : []
    runLiveSpatialIntent(
      location.id,
      { kind: 'camera-frame', frameId: plan.frameId, field: 'camera.frames.order' },
      () => ({
        kind: 'reorder-camera-frame',
        toIndex: plan.toIndex,
        expectedFrameIds: expectedCameraFrameIds,
      }),
    )
  }

  return (
    <aside className="panel scene-panel" aria-label="课程结构">
      <div className="panel-header">
        <h2 className="panel-title">{treeView.shared.label}</h2>
      </div>
      <div className="global-layer-entry-wrap">
        <button
          type="button"
          className={`global-layer-entry${editingScope === 'global' ? ' global-layer-entry--active' : ''}`}
          aria-pressed={editingScope === 'global'}
          data-testid="global-layer-entry"
          onClick={() => setEditingScope('global')}
        >
          <span className="global-layer-entry__icon"><Globe2 size={19} /></span>
          <span className="global-layer-entry__content">
            <strong>{treeView.shared.globalEntry.label}（{treeView.shared.globalEntry.rangeLabel}）</strong>
            <small>{globalLayerCount} 个元素</small>
          </span>
          <Layers3 size={16} />
        </button>
      </div>
      <div className="scene-panel__divider" role="separator" />
      <div className="panel-header panel-header--course-structure">
        <h2 className="panel-title">课程结构</h2>
        <AddCourseContentMenu
          layout={layout}
          onPrimary={handlePrimaryAdd}
          onAddSlidePage={layout.dropdown.includes('slide-page')
            ? () => addCourseContent('slide-page')
            : undefined}
          onAddFlowPage={layout.dropdown.includes('flow-page')
            ? () => addCourseContent('flow-page')
            : undefined}
          onAddSpatialPage={layout.dropdown.includes('spatial-page')
            ? () => addCourseContent('spatial-page')
            : undefined}
        />
      </div>
      <div className="course-page-tree" data-testid="course-page-tree">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={treeView.pages.map((page) => page.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="course-page-tree__list">
              {treeView.pages.map((page) => (
                <CourseTreeNodeRow
                  key={page.id}
                  node={page}
                  activeLocationId={activeLocationId}
                  depth={0}
                  onActivateLocation={activateLocation}
                  onRenameFlowPage={renameFlowPage}
                  onRenameFlowHeading={renameFlowHeading}
                  onAddSpatialCamera={(surfaceId) => {
                    const location = project.locations.find((candidate) =>
                      candidate.surfaceId === surfaceId && candidate.kind === 'spatial-camera',
                    )
                    if (!location) return
                    runLiveSpatialIntent(
                      location.id,
                      { kind: 'world', field: 'camera.frames' },
                      (captured) => ({
                        kind: 'add-camera-frame',
                        expectedCamera: captured.camera,
                      }),
                    )
                  }}
                  onDeleteSpatialCamera={(locationId) => {
                    const spatialLocation = project.locations.find((location) => location.id === locationId)
                    if (spatialLocation?.kind === 'spatial-camera') {
                      const store = useEditorStore.getState()
                      const authoringToken = store.courseAuthoringSession?.token
                      if (!authoringToken) {
                        store.setError(COURSE_AUTHORING_STALE_SESSION_REASON)
                        return
                      }
                      const surface = project.surfaces.find(
                        (candidate) => candidate.id === spatialLocation.surfaceId,
                      )
                      const frame = surface?.type === 'spatial-2d'
                        ? surface.camera.frames.find((candidate) => candidate.id === spatialLocation.cameraFrameId)
                        : null
                      const captured = store.spatialSession?.selection.surfaceId === spatialLocation.surfaceId
                        ? captureLiveSpatialTarget(locationId, {
                            kind: 'camera-frame',
                            frameId: spatialLocation.cameraFrameId,
                            field: 'camera.frames',
                          })
                        : null
                      setPendingDeleteSceneId(null)
                      setPendingDeleteSurfaceId(null)
                      setPendingDeleteCamera({
                        projectId: project.id,
                        revision: project.revision,
                        locationId,
                        surfaceId: spatialLocation.surfaceId,
                        frameId: spatialLocation.cameraFrameId,
                        label: frame?.name ?? spatialLocation.cameraFrameId,
                        authoringToken: { ...authoringToken },
                        target: captured?.target ?? null,
                        contentEdit: captured?.contentEdit ?? store.spatialContentEdit,
                      })
                    }
                  }}
                  onDeleteSlideScene={(locationId) => {
                    const sceneId = slideSceneIdFromLocation(project, locationId)
                    if (sceneId) {
                      setPendingDeleteCamera(null)
                      setPendingDeleteSurfaceId(null)
                      setPendingDeleteSceneId(sceneId)
                    }
                  }}
                  onDeleteSurface={(surfaceId) => {
                    setPendingDeleteCamera(null)
                    setPendingDeleteSceneId(null)
                    setPendingDeleteSurfaceId(surfaceId)
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
      <ConfirmDialog
        open={Boolean(pendingDeleteCamera)}
        title="删除镜头？"
        message={pendingDeleteCamera ? `“${pendingDeleteCamera.label}”将被删除。此操作可以撤销。` : ''}
        confirmLabel="删除镜头"
        danger
        onCancel={() => setPendingDeleteCamera(null)}
        onConfirm={() => {
          if (pendingDeleteCamera) {
            const store = useEditorStore.getState()
            const liveProject = selectActiveCourseProjectDocument(store)
            if (
              !liveProject
              || liveProject.id !== pendingDeleteCamera.projectId
              || liveProject.revision !== pendingDeleteCamera.revision
              || !sameCourseAuthoringToken(
                store.courseAuthoringSession?.token,
                pendingDeleteCamera.authoringToken,
              )
              || !Object.is(store.spatialContentEdit, pendingDeleteCamera.contentEdit)
            ) {
              store.setError(COURSE_AUTHORING_STALE_SESSION_REASON)
            } else if (!pendingDeleteCamera.target && pendingDeleteCamera.contentEdit) {
              store.setError('请先完成当前文字编辑')
            } else {
              const captured = pendingDeleteCamera.target
                ? {
                    target: pendingDeleteCamera.target,
                    contentEdit: pendingDeleteCamera.contentEdit,
                  }
                : captureLiveSpatialTarget(pendingDeleteCamera.locationId, {
                    kind: 'camera-frame',
                    frameId: pendingDeleteCamera.frameId,
                    field: 'camera.frames',
                  })
              if (captured && Object.is(captured.contentEdit, pendingDeleteCamera.contentEdit)) {
                useEditorStore.getState().runSpatialAuthoringIntent(captured.target, {
                  kind: 'delete-camera-frame',
                  expectedContentEdit: pendingDeleteCamera.contentEdit,
                })
              } else if (captured) {
                useEditorStore.getState().setError(COURSE_AUTHORING_STALE_SESSION_REASON)
              }
            }
          }
          setPendingDeleteCamera(null)
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDeleteSceneId)}
        title="删除场景？"
        message={pendingSceneName ? `“${pendingSceneName}”及其中的全部节点将被删除。此操作可以撤销。` : ''}
        confirmLabel="删除场景"
        danger
        onCancel={() => setPendingDeleteSceneId(null)}
        onConfirm={() => {
          if (pendingDeleteSceneId) {
            useEditorStore.getState().deleteScene(pendingDeleteSceneId)
          }
          setPendingDeleteSceneId(null)
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDeleteSurfaceId)}
        title="删除页面？"
        message={pendingSurfaceName ? `“${pendingSurfaceName}”整组将被删除。此操作可以撤销。` : ''}
        confirmLabel="删除页面"
        danger
        onCancel={() => setPendingDeleteSurfaceId(null)}
        onConfirm={() => {
          if (pendingDeleteSurfaceId) {
            deleteCourseSurface(pendingDeleteSurfaceId)
          }
          setPendingDeleteSurfaceId(null)
        }}
      />
    </aside>
  )
}
