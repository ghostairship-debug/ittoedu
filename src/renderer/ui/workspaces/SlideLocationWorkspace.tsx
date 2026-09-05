import {
  Hand,
  LoaderCircle,
  Maximize2,
  Minus,
  MousePointer2,
  Play,
  Plus,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  ComponentAuthoringTextTarget,
  ComponentPackageData,
} from '../../../shared/componentTypes'
import { getComponentPropValue } from '../../../shared/componentProps'
import type { RuntimeAuthoringTarget } from '../../../shared/runtimeTypes'
import {
  PLAYER_AUTHORING_MESSAGE_TYPES,
  PLAYER_AUTHORING_PROTOCOL_VERSION,
  isPlayerAuthoringSnapshotAck,
  parsePlayerAuthoringReadyMessage,
  playerAuthoringSnapshotBarrierForCommand,
  type PlayerAuthoringPatch,
  type PlayerAuthoringPatchCommand,
  type PlayerAuthoringHostMessage,
  type PlayerAuthoringSnapshotBarrier,
  type PlayerComponentAuthoringTargetsMessage,
  type PlayerRuntimeAuthoringTargetsMessage,
} from '../../../shared/playerAuthoringProtocol'
import { createEditorGame, type EditorGameHandle } from '../../phaser/createEditorGame'
import { onElementAnimationPreviewRequested } from '../../phaser/elementAnimationPreviewBus'
import { hitTestV9SlideLayerItems } from '../../phaser/v9SlideHitAdapter'
import {
  commitV9SlideContentEdit,
  updateV9SlideContentFormulaDraft,
  type V9SlideContentEditSession,
} from '../../authoring/v9SlideContentEdit'
import {
  createSlideWorkspaceAuthoringController,
  listSlideWorkspaceHitTargets,
  mergeSlidePreviewIntoNodes,
  type SlideLinePreview,
  type SlideWorkspaceCommandPort,
} from '../workspaceSlideAuthoring'
import { buildSlideEditorView, type SlideEditorLayerView, type SlideEditorView } from '../../course/slideEditorView'
import { materializeNativeLayerItem } from '../../../shared/courseProjectSchema'
import { nativeRenderInputFromV9Item } from '../../../player/surfaces/slide/publishedNativeRendering'
import { TextEditOverlay } from '../TextEditOverlay'
import { SlideLayerSelectionOverlay } from './SlideLayerSelectionOverlay'
import { useSlideNativeTextEditor } from './useSlideNativeTextEditor'
import { FormulaEditDialog } from '../FormulaEditDialog'
import { renderTextNodeCanvas } from '../../../shared/textLayout'
import {
  clientToWorld,
  createStageViewportTransform,
  rotatedRectIntersectsStage,
  STAGE_RESIZE_HANDLE_DIRECTIONS,
  STAGE_VIEWPORT_HEIGHT,
  STAGE_VIEWPORT_WIDTH,
  type StageRect,
  type StageSelectionOverlayGeometry,
} from '../../authoring/stageViewportTransform'
import { createV9TeacherControllerAuthoringController } from '../../authoring/v9TeacherControllerAuthoring'
import {
  type attachPublishedCourseStageFit,
  type mountPublishedCourseAuthoring,
  type mountPublishedCourseTryRun,
} from '../coursePlayerTryRun'
import {
  beginSerializedSessionMount,
  enqueueSerial,
} from '../serializedSessionMount'
import type { PublishedCourseSession } from '../../../player/surfaces/publishedDynamicHosts'
import { courseLayerItemToEditorCanvasNode } from '../../store/slideEditorProjection'
import type { LayerItem, NativeLayerItem } from '../../../shared/courseProjectTypes'
import { isTeacherControllerLayerItem } from '../../course/globalLayerCommands'
import { runtimeTargetMatchesEditingContext } from '../../authoring/runtimeAuthoringContext'
import {
  beginComponentTextEditSession,
  componentTextEditSessionMatchesContext,
  componentTextTargetMatchesSession,
  resolveComponentTextEdit,
  type ComponentTextEditContext,
  type ComponentTextEditSession,
} from '../../authoring/componentTextEditSession'
import { isAuthoringCanvasInteractive } from '../../authoring/authoringReadiness'
import {
  beginRuntimeTargetEditSession,
  runtimeTargetEditSessionMatchesContext,
  runtimeTargetMatchesEditSession,
  validateRuntimeTargetEditSession,
  type RuntimeTargetEditContext,
  type RuntimeTargetEditSession,
} from '../../authoring/runtimeTargetEditSession'
import type { CourseRuntimeContentTextTarget } from '../../runtime/runtimeContentTextAuthoringCommands'
import type { CourseRuntimeAssetReplacementTarget } from '../../runtime/courseRuntimeTransactions'
import type { ImportedImageAsset } from '../../project/assetManager'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { FormulaNode, TextNode, TextRun } from '../../../shared/contracts/native-v1'
import type { NativeLineGeometry } from '../../../shared/contracts/native-v1/types'
import { resolveNativeLinePoints } from '../../../shared/nativeLineGeometry'
import {
  collectLineSnapAxes,
  drawLineAuthoringGeometry,
  snapLinePoint,
} from '../../authoring/slideLineAuthoring'
import type {
  SlideAuthoringBackend,
  SlideAuthoringSession,
  SlideCommandResult,
} from '../../course/slideAuthoringBackend'
import {
  SlideDynamicAuthoringOverlay,
  type SlidePreviewFeedback,
  type SlideRuntimeTextEditSession,
} from './SlideDynamicAuthoringOverlay'

export const SLIDE_SESSIONLESS_ERROR = '没有活动的 Slide 编辑会话，不能从旧工程恢复界面'

export type SlidePhaserNode = NonNullable<ReturnType<typeof courseLayerItemToEditorCanvasNode>>
type AuthoringPatchNode = Extract<PlayerAuthoringPatch, { kind: 'native-node' }>['node']
type SlidePhaserDocument = Parameters<EditorGameHandle['bridge']['loadScene']>[0]

export type SlideCanvasMode = 'edit' | 'run'
export type SlideEditingScope = 'scene' | 'global'

export interface SlideWorkspaceSnapshot {
  readonly view: SlideEditorView | null
  readonly locationId: string | null
  readonly backend: SlideAuthoringBackend | null
  readonly backendKind: 'slide-authoring' | 'unavailable'
  readonly componentPackages: Record<string, ComponentPackageData>
  readonly sidecarFileIds: readonly string[]
  readonly editingScope: SlideEditingScope
  readonly presentationStateId: string | null
  readonly canvasMode: SlideCanvasMode
  readonly editingNodes: readonly SlidePhaserNode[]
  readonly selectedNodeIds: readonly string[]
  readonly selectedNode: SlidePhaserNode | undefined
  readonly editingTextNodeId: string | null
  readonly contentEdit: V9SlideContentEditSession | null
  readonly sceneId: string
  readonly projectId: string
  readonly projectRevision: number
  readonly previewRebuildKey: string
  readonly tryRunMountKey: string | null
  /** Armed direct-draw tool; `null` keeps the canvas in select mode. */
  readonly drawTool: SlideLineDrawTool
}

export type SlideLineDrawTool = 'line' | 'elbow-arrow' | null

export interface SlideLineDrawCommit {
  readonly shapeType: 'line' | 'elbow-arrow'
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly lineGeometry: NativeLineGeometry
}

export interface SlideWorkspaceCanvasPort {
  readonly setCanvasMode: (mode: SlideCanvasMode) => void
  readonly setStatus: (message: string) => void
  readonly setDrawTool: (tool: SlideLineDrawTool) => void
}

export interface SlideWorkspaceSelectionPort {
  readonly selectNodes: (ids: readonly string[]) => void
  readonly selectNode: (id: string) => void
}

export interface SlideWorkspaceContentPort {
  readonly beginTextEdit: (nodeId: string, origin: 'canvas') => void
  readonly commitTextEdit: () => void
  readonly cancelTextEdit: () => void
  readonly updateTextEditDraft: (
    nodeId: string,
    text: string,
    runs: TextRun[],
    height?: number,
    width?: number,
  ) => void
  readonly setTextEditComposing: (composing: boolean) => void
  readonly updateNode: (nodeId: string, patch: Record<string, unknown>) => void
  readonly updateNodes: (
    nodes: ReadonlyArray<{ nodeId: string; patch: Record<string, unknown> }>,
  ) => void
  readonly addTextNode: (x: number, y: number) => void
  readonly addFormulaNode: (x: number, y: number) => void
  readonly addRectangleNode: (x: number, y: number) => void
  readonly addShapeNode: (shapeType: string, x: number, y: number) => void
  /** Commits one completed direct line draw as a single history transaction. */
  readonly drawShapeNode: (input: SlideLineDrawCommit) => void
  readonly addTableNode: (x: number, y: number) => void
  readonly addChartNode: (
    chartType: 'bar' | 'line' | 'area' | 'pie' | 'donut',
    x: number,
    y: number,
  ) => void
  readonly addExternalComponentNode: (
    packageId: string,
    x: number,
    y: number,
    presetId?: string,
  ) => void
}

export interface SlideWorkspaceRuntimePort {
  readonly captureRuntimeContentTextTarget: (
    session: Readonly<RuntimeTargetEditSession>,
  ) => CourseRuntimeContentTextTarget | null
  readonly updateRuntimeContentTextAtTarget: (
    target: CourseRuntimeContentTextTarget,
    value: string,
  ) => { ok: false; reason: string } | { ok: true; status: 'unchanged' | 'updated' }
  readonly captureRuntimeAssetReplacementTarget: (
    session: Readonly<RuntimeTargetEditSession>,
  ) => CourseRuntimeAssetReplacementTarget | null
  readonly replaceRuntimeAssetAtTarget: (
    target: CourseRuntimeAssetReplacementTarget,
    asset: AssetMeta,
    bytes: Uint8Array,
  ) => { ok: false; reason: string } | { ok: true; status: 'unchanged' | 'replaced' }
}

export interface SlideWorkspaceAuthoringPort extends SlideWorkspaceCommandPort {
  readonly applySlideCommand: (
    run: (session: SlideAuthoringSession) => SlideCommandResult,
    extra?: { clearContentEdit?: boolean },
  ) => SlideCommandResult
}

export interface SlideWorkspacePreviewPort {
  readonly mount: (
    input: Pick<
      Parameters<typeof mountPublishedCourseAuthoring>[0],
      'container' | 'sessionId' | 'scope' | 'onSessionCreated' | 'onMessage'
    >,
  ) => ReturnType<typeof mountPublishedCourseAuthoring>
}

export interface SlideWorkspaceTryRunPort {
  readonly mount: (
    container: HTMLElement,
  ) => ReturnType<typeof mountPublishedCourseTryRun>
  readonly attachStageFit: typeof attachPublishedCourseStageFit
}

export interface SlideWorkspacePorts {
  readonly canvas: SlideWorkspaceCanvasPort
  readonly selection: SlideWorkspaceSelectionPort
  readonly content: SlideWorkspaceContentPort
  readonly runtime: SlideWorkspaceRuntimePort
  readonly authoring: SlideWorkspaceAuthoringPort
  readonly preview: SlideWorkspacePreviewPort
  readonly tryRun: SlideWorkspaceTryRunPort
}

export interface SlideLocationWorkspaceProps {
  readonly snapshot: SlideWorkspaceSnapshot
  readonly ports: SlideWorkspacePorts
  readonly onAddImage: (x?: number, y?: number) => void
  readonly onAddVideo: (x?: number, y?: number) => void
  readonly onSelectImageAsset: () => Promise<ImportedImageAsset | null>
}

interface FormulaEditSession {
  projectId: string
  scope: 'scene' | 'global'
  sceneId: string
  stateId: string | null
  nodeId: string
}

function phaserDocumentFromView(
  view: SlideEditorView,
  editingScope: SlideEditingScope,
): SlidePhaserDocument {
  const source = editingScope === 'global' ? 'global' : 'scene'
  const nodes = view.layers.flatMap((layer) => {
    if (layer.source !== source) return []
    const node = courseLayerItemToEditorCanvasNode(layer.item as LayerItem)
    return node ? [node] : []
  })
  if (editingScope === 'global') {
    return {
      id: '__editor_global_layer__',
      name: '全局层',
      backgroundColor: view.backgroundColor,
      backgroundAssetId: view.backgroundAssetId ?? undefined,
      nodes,
    }
  }
  return {
    id: view.sceneId,
    name: view.sceneName,
    backgroundColor: view.backgroundColor,
    backgroundAssetId: view.backgroundAssetId ?? undefined,
    nodes,
  }
}

function nodesEqual(
  previous: SlidePhaserNode,
  next: SlidePhaserNode,
) {
  return JSON.stringify(previous) === JSON.stringify(next)
}

function withDirectionAwareTextAutoSize(
  node: SlidePhaserNode | undefined,
  patch: Partial<Pick<SlidePhaserNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>>,
): typeof patch {
  const overflow = node?.style?.overflow
  if (node?.type !== 'text' || overflow !== 'auto-height') {
    return patch
  }
  const candidate = {
    ...node,
    ...patch,
  }
  const rendered = renderTextNodeCanvas(candidate as TextNode, candidate.width)
  return {
    ...patch,
    width: rendered.width,
    height: rendered.height,
  }
}

function pointInsideRotatedBounds(
  point: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
  rotation: number,
): boolean {
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const radians = -rotation * Math.PI / 180
  const dx = point.x - centerX
  const dy = point.y - centerY
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians)
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians)
  return Math.abs(localX) <= bounds.width / 2 &&
    Math.abs(localY) <= bounds.height / 2
}

function nativeSlideLayer(
  layers: readonly SlideEditorLayerView[],
  layerItemId: string,
  nativeType: NativeLayerItem['content']['nativeType'],
): NativeLayerItem | null {
  const layer = layers.find((candidate) => candidate.selectionId === layerItemId)
  if (!layer || layer.item.kind !== 'native') return null
  if (layer.item.content.nativeType !== nativeType) return null
  return layer.item as NativeLayerItem
}

function localPublishedAuthoringSource(
  scope: 'scene' | 'surface' | 'global' | undefined,
): 'scene' | 'surface' {
  return scope === 'surface' ? 'surface' : 'scene'
}

/** V9/r11-031 paint frame for a complete Published authoring patch. Not a Scene snapshot. */
function publishedAuthoringNodeFromLayerItem(item: LayerItem): AuthoringPatchNode | null {
  if (item.kind === 'native') {
    return nativeRenderInputFromV9Item(item)
  }
  if (item.kind === 'component') {
    return {
      id: item.layerItemId,
      name: item.label,
      type: 'external-component',
      x: item.frame.x,
      y: item.frame.y,
      width: item.frame.width,
      height: item.frame.height,
      rotation: item.rotation,
      opacity: item.opacity,
      visible: item.visible,
      locked: item.locked,
      playbackInitialVisibility: item.playbackInitialVisibility,
      component: structuredClone(item.component),
      props: structuredClone(item.props),
    }
  }
  return null
}

interface PublishedAuthoringSnapshotState {
  readonly localNodes: AuthoringPatchNode[]
  readonly globalNodes: AuthoringPatchNode[]
  readonly backgroundColor: string
  readonly backgroundAssetId: string | null
}

function extractPublishedAuthoringState(
  view: ReturnType<typeof buildSlideEditorView> | null,
  localSource: 'scene' | 'surface',
): PublishedAuthoringSnapshotState {
  if (!view) {
    return {
      localNodes: [],
      globalNodes: [],
      backgroundColor: '#ffffff',
      backgroundAssetId: null,
    }
  }
  const localNodes: AuthoringPatchNode[] = []
  const globalNodes: AuthoringPatchNode[] = []
  for (const layer of view.layers) {
    const node = publishedAuthoringNodeFromLayerItem(layer.item as LayerItem)
    if (!node) continue
    if (layer.source === 'global') globalNodes.push(node)
    else if (layer.source === localSource) localNodes.push(node)
  }
  return {
    localNodes,
    globalNodes,
    backgroundColor: view.backgroundColor,
    backgroundAssetId: view.backgroundAssetId ?? null,
  }
}

function publishedAuthoringPatchesFromSlideView(
  view: ReturnType<typeof buildSlideEditorView>,
  localSource: 'scene' | 'surface',
): PlayerAuthoringPatch[] {
  const { localNodes, globalNodes, backgroundColor, backgroundAssetId } =
    extractPublishedAuthoringState(view, localSource)
  return [
    ...localNodes.map((node): PlayerAuthoringPatch => ({
      kind: 'native-node',
      target: { kind: 'native-node', scope: 'scene', nodeId: node.id },
      node,
    })),
    ...globalNodes.map((node): PlayerAuthoringPatch => ({
      kind: 'native-node',
      target: { kind: 'native-node', scope: 'global', nodeId: node.id },
      node,
    })),
    {
      kind: 'scene-background',
      target: { kind: 'scene-background', scope: 'scene' },
      backgroundColor,
      backgroundAssetId,
    },
    {
      kind: 'scene-order',
      target: { kind: 'scene-order', scope: 'scene' },
      nodeIds: localNodes.map((node) => node.id),
    },
  ]
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

type RuntimePreviewFeedback = {
  kind: 'loading' | 'error'
  title: string
  message: string
} | null

function sanitizeRuntimeAuthoringTargets(
  update: PlayerRuntimeAuthoringTargetsMessage['update'],
  hostKey: string,
): ReadonlyArray<Readonly<RuntimeAuthoringTarget>> {
  if (
    (update.scope !== 'scene' && update.scope !== 'global') ||
    (update.scope === 'scene' &&
      (typeof update.sceneId !== 'string' || !update.sceneId.trim()))
  ) {
    return []
  }
  const sanitized: RuntimeAuthoringTarget[] = []
  for (const candidate of update.targets) {
    if (
      !candidate ||
      candidate.scope !== update.scope ||
      candidate.sceneId !== update.sceneId ||
      (candidate.kind !== 'text' && candidate.kind !== 'asset') ||
      (candidate.layer !== 'underlay' && candidate.layer !== 'overlay') ||
      (candidate.source !== 'registered' && candidate.source !== 'dom') ||
      typeof candidate.targetId !== 'string' ||
      !candidate.targetId ||
      candidate.targetId.length > 256 ||
      typeof candidate.nodeId !== 'string' ||
      !candidate.nodeId ||
      candidate.nodeId.length > 256 ||
      typeof candidate.key !== 'string' ||
      !candidate.key ||
      candidate.key.length > 256
    ) {
      continue
    }
    if (!candidate.bounds || typeof candidate.bounds !== 'object') continue
    const { x, y, width, height } = candidate.bounds
    if (![x, y, width, height].every(Number.isFinite)) continue
    const left = Math.max(0, x)
    const top = Math.max(0, y)
    const right = Math.min(STAGE_VIEWPORT_WIDTH, x + width)
    const bottom = Math.min(STAGE_VIEWPORT_HEIGHT, y + height)
    if (right <= left || bottom <= top) continue
    sanitized.push(Object.freeze({
      ...candidate,
      targetId: `${hostKey}:${candidate.nodeId}:${candidate.targetId}`,
      ...(typeof candidate.label === 'string'
        ? { label: candidate.label.slice(0, 120) }
        : { label: undefined }),
      bounds: Object.freeze({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      }),
    }))
  }
  return Object.freeze(sanitized)
}

function sanitizeComponentAuthoringTargets(
  update: PlayerComponentAuthoringTargetsMessage['update'],
  hostKey: string,
): ReadonlyArray<Readonly<ComponentAuthoringTextTarget>> {
  if (
    (update.scope !== 'scene' && update.scope !== 'global') ||
    typeof update.nodeId !== 'string' ||
    !update.nodeId ||
    update.nodeId.length > 256 ||
    (update.scope === 'scene' &&
      (typeof update.sceneId !== 'string' || !update.sceneId.trim()))
  ) {
    return []
  }
  const sanitized: ComponentAuthoringTextTarget[] = []
  for (const candidate of update.targets) {
    if (
      !candidate ||
      candidate.kind !== 'component-text' ||
      candidate.scope !== update.scope ||
      candidate.sceneId !== update.sceneId ||
      candidate.nodeId !== update.nodeId ||
      (candidate.source !== 'registered' && candidate.source !== 'dom') ||
      typeof candidate.targetId !== 'string' ||
      !candidate.targetId ||
      candidate.targetId.length > 256 ||
      typeof candidate.componentId !== 'string' ||
      !candidate.componentId ||
      candidate.componentId.length > 256 ||
      typeof candidate.key !== 'string' ||
      !candidate.key ||
      candidate.key.length > 256 ||
      typeof candidate.multiline !== 'boolean' ||
      !Number.isFinite(candidate.rotation)
    ) {
      continue
    }
    if (!candidate.bounds || typeof candidate.bounds !== 'object') continue
    const { x, y, width, height } = candidate.bounds
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0
    ) {
      continue
    }
    if (!rotatedRectIntersectsStage(candidate.bounds, candidate.rotation)) {
      continue
    }
    const maxLength = candidate.maxLength
    sanitized.push(Object.freeze({
      ...candidate,
      targetId: `component:${hostKey}:${candidate.targetId}`,
      label: typeof candidate.label === 'string' && candidate.label.trim()
        ? candidate.label.slice(0, 120)
        : candidate.key.slice(0, 120),
      ...(
        maxLength === undefined ||
        (Number.isSafeInteger(maxLength) && maxLength > 0 && maxLength <= 1_000_000)
          ? { maxLength }
          : { maxLength: undefined }
      ),
      bounds: Object.freeze({
        x,
        y,
        width,
        height,
      }),
    }))
  }
  return Object.freeze(sanitized)
}

type CanvasAuthoringHit =
  | { kind: 'runtime'; target: Readonly<RuntimeAuthoringTarget> }
  | { kind: 'component'; target: Readonly<ComponentAuthoringTextTarget> }

function controllerGestureConsumed(
  overlay: StageSelectionOverlayGeometry | null | undefined,
  preview: unknown,
  target: unknown,
): boolean {
  return Boolean(overlay && (preview || target))
}

function TeacherControllerAuthoringOverlay({
  overlay,
}: {
  overlay: StageSelectionOverlayGeometry
}) {
  const box = overlay.selectionBox
  return (
    <div
      className="teacher-controller-overlay"
      data-testid="teacher-controller-overlay"
      aria-hidden="true"
    >
      <div
        className="teacher-controller-overlay__box"
        style={{
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
        }}
      />
      {STAGE_RESIZE_HANDLE_DIRECTIONS.map((direction) => {
        const point = overlay.handles[direction]
        return (
          <div
            key={direction}
            className="teacher-controller-overlay__handle"
            data-handle={direction}
            style={{ left: point.x - 4, top: point.y - 4 }}
          />
        )
      })}
    </div>
  )
}

export function SlideLocationWorkspace({
  snapshot,
  ports,
  onAddImage,
  onAddVideo,
  onSelectImageAsset,
}: SlideLocationWorkspaceProps) {
  const {
    view: slideEditorView,
    locationId: courseLocationId,
    backend,
    backendKind: slideBackendKind,
    canvasMode,
    editingScope,
    selectedNodeIds,
    selectedNode,
    editingTextNodeId,
    presentationStateId: activePresentationStateId,
    componentPackages,
    sidecarFileIds,
    contentEdit,
  } = snapshot
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const readSnapshot = () => snapshotRef.current
  const workspaceRef = useRef<HTMLDivElement>(null)
  const stageViewportRef = useRef<HTMLDivElement>(null)
  const gameHostRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<EditorGameHandle | null>(null)
  const publishedAuthoringHostRef = useRef<HTMLDivElement>(null)
  const publishedAuthoringSessionRef = useRef<PublishedCourseSession | null>(null)
  const publishedAuthoringMountChainRef = useRef(Promise.resolve())
  const publishedAuthoringInitRef = useRef<{
    token: string
    initialSceneId: string
    initialStateId: string | null
    authoringScope: 'scene' | 'surface' | 'global'
  } | null>(null)
  const previousSceneRef = useRef<SlidePhaserDocument | null>(null)
  const previousPublishedStateRef = useRef<PublishedAuthoringSnapshotState | null>(null)
  const previousComponentPackagesRef = useRef<
    Record<string, ComponentPackageData> | null
  >(null)
  const authoringReadyRef = useRef(false)
  const authoringRevisionRef = useRef(0)
  const authoringSnapshotBarrierRef =
    useRef<PlayerAuthoringSnapshotBarrier | null>(null)
  const lastAuthoringTargetsRevisionRef = useRef(-1)
  const pendingAuthoringNodesRef = useRef(new Map<string, {
    scope: 'scene' | 'global'
    node: AuthoringPatchNode
  }>())
  const authoringFrameRef = useRef<number | null>(null)
  const runtimeTargetsByHostRef = useRef(new Map<
    string,
    ReadonlyArray<Readonly<RuntimeAuthoringTarget>>
  >())
  const componentTargetsByHostRef = useRef(new Map<
    string,
    ReadonlyArray<Readonly<ComponentAuthoringTextTarget>>
  >())
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [previewFeedback, setPreviewFeedback] = useState<RuntimePreviewFeedback>(null)
  const [previewRetryRevision, setPreviewRetryRevision] = useState(0)
  const [acknowledgedPreviewGeneration, setAcknowledgedPreviewGeneration] =
    useState<object | null>(null)
  const [runtimeTargets, setRuntimeTargets] =
    useState<ReadonlyArray<Readonly<RuntimeAuthoringTarget>>>([])
  const [componentTargets, setComponentTargets] =
    useState<ReadonlyArray<Readonly<ComponentAuthoringTextTarget>>>([])
  const [activeRuntimeTextSession, setActiveRuntimeTextSession] =
    useState<Readonly<SlideRuntimeTextEditSession> | null>(null)
  const [activeComponentTextSession, setActiveComponentTextSession] =
    useState<Readonly<ComponentTextEditSession> | null>(null)
  const [activeFormulaEditSession, setActiveFormulaEditSession] =
    useState<Readonly<FormulaEditSession> | null>(null)
  const [replacingRuntimeAssetTargetId, setReplacingRuntimeAssetTargetId] =
    useState<string | null>(null)
  const [hoveredAuthoringTargetId, setHoveredAuthoringTargetId] =
    useState<string | null>(null)
  const [stageViewportSize, setStageViewportSize] = useState({
    width: STAGE_VIEWPORT_WIDTH,
    height: STAGE_VIEWPORT_HEIGHT,
  })
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const spacePressedRef = useRef(false)
  const backendRef = useRef(backend)
  backendRef.current = backend
  const commandPortRef = useRef(ports.authoring)
  commandPortRef.current = ports.authoring
  const slideAuthoringRef = useRef(createSlideWorkspaceAuthoringController({
    getBackend: () => backendRef.current,
    commandPort: {
      run: (run) => commandPortRef.current.run(run),
      afterSelectLayers: (command) => commandPortRef.current.afterSelectLayers?.(command),
    },
  }))
  const controllerAuthoringRef = useRef(createV9TeacherControllerAuthoringController({
    readBackend: () => backendRef.current,
    commit: (run) => commandPortRef.current.run((live) => run(live.getSession())),
  }))
  const candidatePointerActiveRef = useRef(false)
  const controllerPointerActiveRef = useRef(false)
  const courseTryRunRef = useRef<HTMLDivElement>(null)
  const courseTryRunSessionRef = useRef<PublishedCourseSession | null>(null)
  const courseTryRunFitRef = useRef<(() => void) | null>(null)
  const courseTryRunMountChainRef = useRef(Promise.resolve())
  const [tryRunFeedback, setTryRunFeedback] = useState<RuntimePreviewFeedback>(null)
  const [tryRunEpoch, setTryRunEpoch] = useState(0)
  const [controllerOverlay, setControllerOverlay] =
    useState<StageSelectionOverlayGeometry | null>(null)
  const [layerOverlay, setLayerOverlay] = useState<StageSelectionOverlayGeometry | null>(null)
  const needsLayerOverlay = Boolean(slideEditorView?.layers.some(layer =>
    selectedNodeIds.includes(layer.selectionId) && layer.item.kind === 'native' &&
    ['table', 'chart', 'input'].includes(layer.item.content.nativeType)))
  const drawTool = snapshot.drawTool
  const drawGestureRef = useRef<{
    pointerId: number
    shapeType: 'line' | 'elbow-arrow'
    startWorld: { x: number; y: number }
  } | null>(null)
  const [drawPreview, setDrawPreview] = useState<{
    readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>
    readonly guides: { readonly x?: number; readonly y?: number } | null
  } | null>(null)
  const [lineDragGuides, setLineDragGuides] = useState<{
    readonly x?: number
    readonly y?: number
  } | null>(null)
  const panRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    originX: number
    originY: number
  } | null>(null)
  const portsRef = useRef(ports)
  portsRef.current = ports

  useEffect(() => {
    // Draw-tool arming belongs to one Slide scene canvas: switching scene,
    // scope or canvas mode disarms it and drops any in-flight draw preview
    // without writing history.
    drawGestureRef.current = null
    setDrawPreview(null)
    setLineDragGuides(null)
    if (readSnapshot().drawTool !== null) portsRef.current.canvas.setDrawTool(null)
  }, [canvasMode, editingScope, courseLocationId])

  const useCoursePlayerTryRun = Boolean(snapshot.projectId && canvasMode === 'run')
  const usePublishedAuthoring = Boolean(snapshot.projectId && canvasMode === 'edit')
  const publishedAuthoringOwnerScope = backend?.getSnapshot().scope ?? editingScope
  const tryRunMountKey = snapshot.tryRunMountKey
  const readCandidateViewport = useCallback(() => {
    const viewport = stageViewportRef.current
    if (!viewport) return null
    const rect = viewport.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      viewport: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      zoom: view.zoom,
      pan: { x: view.x, y: view.y },
    }
  }, [view.x, view.y, view.zoom])

  useEffect(() => {
    if (
      slideBackendKind !== 'slide-authoring' ||
      canvasMode !== 'edit' ||
      editingScope !== 'global'
    ) {
      setControllerOverlay(null)
      return
    }
    if (controllerPointerActiveRef.current) return
    const viewport = readCandidateViewport()
    if (!viewport) return
    if (isTeacherControllerLayerItem(
      slideEditorView?.layers.find((layer) => selectedNodeIds.includes(layer.selectionId))?.item,
    )) {
      setControllerOverlay(controllerAuthoringRef.current.overlayGeometry(viewport))
      return
    }
    setControllerOverlay(null)
  }, [
    canvasMode,
    editingScope,
    readCandidateViewport,
    selectedNodeIds,
    slideBackendKind,
    slideEditorView,
  ])

  useLayoutEffect(() => {
    if (candidatePointerActiveRef.current) return
    const viewport = readCandidateViewport()
    setLayerOverlay(needsLayerOverlay && canvasMode === 'edit' && viewport
      ? slideAuthoringRef.current.overlayGeometry(viewport) : null)
  }, [needsLayerOverlay, canvasMode, slideEditorView, selectedNodeIds, readCandidateViewport, stageViewportSize])

  const stageTransform = useMemo(() => createStageViewportTransform({
    viewport: {
      x: 0,
      y: 0,
      width: stageViewportSize.width,
      height: stageViewportSize.height,
    },
    zoom: view.zoom,
    pan: { x: view.x, y: view.y },
  }), [stageViewportSize.height, stageViewportSize.width, view.x, view.y, view.zoom])
  const previewRebuildKey = snapshot.previewRebuildKey
  const previewGeneration = useMemo<object>(() => ({}), [
    canvasMode,
    publishedAuthoringOwnerScope,
    previewRebuildKey,
    previewRetryRevision,
  ])
  const authoringCanvasInteractive = isAuthoringCanvasInteractive({
    canvasMode,
    playerReady: authoringReadyRef.current,
    snapshotPending: authoringSnapshotBarrierRef.current !== null,
    hasPreviewFeedback: previewFeedback !== null,
    generationCurrent: acknowledgedPreviewGeneration === previewGeneration,
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isEditableKeyboardTarget(event.target)) {
        spacePressedRef.current = true
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePressedRef.current = false
    }
    const onBlur = () => {
      spacePressedRef.current = false
      panRef.current = null
      setPanning(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const setZoom = useCallback((zoom: number) => {
    setView((current) => ({
      ...current,
      zoom: Math.max(0.5, Math.min(2, Math.round(zoom * 20) / 20)),
    }))
  }, [])

  const resetView = useCallback(() => {
    setView({ zoom: 1, x: 0, y: 0 })
  }, [])

  useLayoutEffect(() => {
    const viewport = stageViewportRef.current
    if (!viewport) return
    const update = () => {
      const rect = viewport.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      setStageViewportSize((current) => (
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height }
      ))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const failPublishedAuthoring = useCallback((token: string, message: string) => {
    if (publishedAuthoringInitRef.current?.token !== token) return
    publishedAuthoringInitRef.current = null
    authoringReadyRef.current = false
    authoringSnapshotBarrierRef.current = null
    setAcknowledgedPreviewGeneration(null)
    if (authoringFrameRef.current !== null) {
      window.cancelAnimationFrame(authoringFrameRef.current)
      authoringFrameRef.current = null
    }
    pendingAuthoringNodesRef.current.clear()
    previousPublishedStateRef.current = null
    runtimeTargetsByHostRef.current.clear()
    componentTargetsByHostRef.current.clear()
    lastAuthoringTargetsRevisionRef.current = -1
    setRuntimeTargets([])
    setComponentTargets([])
    setActiveRuntimeTextSession(null)
    setActiveComponentTextSession(null)
    setHoveredAuthoringTargetId(null)
    setReplacingRuntimeAssetTargetId(null)
    setPreviewFeedback({
      kind: 'error',
      title: '统一画布启动失败',
      message,
    })
  }, [])

  const retryRuntimePreview = useCallback(() => {
    setPreviewFeedback({
      kind: 'loading',
      title: '正在重新准备画布',
      message: '正在重新创建 Published 编辑宿主…',
    })
    setPreviewRetryRevision((revision) => revision + 1)
  }, [])

  const postAuthoringPatch = useCallback((patch: PlayerAuthoringPatch) => {
    const init = publishedAuthoringInitRef.current
    const session = publishedAuthoringSessionRef.current
    if (
      !init ||
      !session ||
      !authoringReadyRef.current
    ) {
      if (init && authoringSnapshotBarrierRef.current) {
        failPublishedAuthoring(
          init.token,
          '编辑画布在初始同步期间失去连接。请重新载入画布。',
        )
      }
      return null
    }
    const currentSnapshot = readSnapshot()
    const sceneId = currentSnapshot.sceneId
    if (!sceneId) {
      if (init && authoringSnapshotBarrierRef.current) {
        failPublishedAuthoring(
          init.token,
          '当前 Slide 位置没有可用的 V9 场景，无法同步编辑画布。',
        )
      }
      return null
    }
    authoringRevisionRef.current += 1
    const command: PlayerAuthoringPatchCommand = {
      type: PLAYER_AUTHORING_MESSAGE_TYPES.patch,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId: init.token,
      requestId: crypto.randomUUID(),
      revision: authoringRevisionRef.current,
      context: {
        sceneId,
        stateId: currentSnapshot.presentationStateId,
      },
      patch,
    }
    try {
      void session.applyAuthoringCommand(command).catch((error) => {
        failPublishedAuthoring(
          command.sessionId,
          error instanceof Error
            ? `编辑画布更新失败：${error.message}`
            : '编辑画布更新失败。',
        )
      })
    } catch {
      if (authoringSnapshotBarrierRef.current) {
        failPublishedAuthoring(
          init.token,
          '编辑画布在初始同步期间无法继续发送更新。请重新载入画布。',
        )
      }
      return null
    }
    // Property-panel edits may arrive while the initial snapshot is still
    // applying. Move the gate forward so an older snapshot ACK cannot expose
    // a canvas that is still catching up with the editor store.
    if (authoringSnapshotBarrierRef.current) {
      authoringSnapshotBarrierRef.current =
        playerAuthoringSnapshotBarrierForCommand(command)
    }
    return command
  }, [failPublishedAuthoring])

  useEffect(() => onElementAnimationPreviewRequested(({ action, delayMs }) => {
    const currentSnapshot = readSnapshot()
    const currentNode = currentSnapshot.editingNodes.find(
      (node) => node.id === action.nodeId,
    )
    if (!currentNode) {
      ports.canvas.setStatus('动画预览目标已失效，请重新选择')
      return
    }
    const posted = postAuthoringPatch({
      kind: 'preview-node-motion',
      target: {
        kind: 'native-node',
        scope: currentSnapshot.editingScope,
        nodeId: currentNode.id,
      },
      action,
      delayMs,
    })
    if (!posted) {
      ports.canvas.setStatus('编辑画布尚未就绪，请稍后重试动画预览')
    }
  }), [postAuthoringPatch])

  const flushAuthoringNodePatches = useCallback(() => {
    authoringFrameRef.current = null
    const pending = [...pendingAuthoringNodesRef.current.values()]
    pendingAuthoringNodesRef.current.clear()
    for (const { scope, node } of pending) {
      postAuthoringPatch({
        kind: 'native-node',
        target: {
          kind: 'native-node',
          scope,
          nodeId: node.id,
        },
        node,
      })
    }
  }, [postAuthoringPatch])

  const queueAuthoringNodePatch = useCallback((
    scope: 'scene' | 'global',
    node: AuthoringPatchNode,
  ) => {
    pendingAuthoringNodesRef.current.set(
      `${scope}:${node.id}`,
      { scope, node: structuredClone(node) },
    )
    if (authoringFrameRef.current !== null) return
    authoringFrameRef.current = window.requestAnimationFrame(
      flushAuthoringNodePatches,
    )
  }, [flushAuthoringNodePatches])

  const paintSlideTransformPreview = useCallback((
    preview: Parameters<typeof mergeSlidePreviewIntoNodes>[1],
  ) => {
    const currentSnapshot = readSnapshot()
    const painted = mergeSlidePreviewIntoNodes(currentSnapshot.editingNodes, preview)
    // New Native content is not a legacy Phaser node. Paint its transient frame
    // through the same formal render input used for initial/committed content.
    for (const transform of preview ?? []) {
      const layer = currentSnapshot.view?.layers.find(item => item.selectionId === transform.nodeId)
      if (!layer || layer.item.kind !== 'native' ||
        !['table', 'chart', 'input'].includes(layer.item.content.nativeType)) continue
      const item = structuredClone(layer.item) as NativeLayerItem
      item.frame = { ...item.frame, x:transform.x, y:transform.y, width:transform.width, height:transform.height }
      item.rotation = transform.rotation
      queueAuthoringNodePatch(currentSnapshot.editingScope, nativeRenderInputFromV9Item(item))
    }
    const handle = gameRef.current
    for (const node of painted) {
      const current = currentSnapshot.editingNodes.find((item) => item.id === node.id)
      const normalized = {
        ...node,
        ...withDirectionAwareTextAutoSize(current, {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          rotation: node.rotation,
        }),
      } as AuthoringPatchNode
      handle?.bridge.applyNode(normalized)
      queueAuthoringNodePatch(currentSnapshot.editingScope, normalized)
    }
  }, [queueAuthoringNodePatch])

  const syncCommittedTextNode = useCallback((nodeId: string) => {
    const node = readSnapshot().editingNodes.find((item) => item.id === nodeId)
    if (node) {
      gameRef.current?.bridge.applyNode(node)
      queueAuthoringNodePatch(readSnapshot().editingScope, node)
    }
    gameRef.current?.bridge.setTextEditing(null)
  }, [queueAuthoringNodePatch])

  /** Live paint for one line handle drag: frame + geometry follow the pointer. */
  const paintSlideLinePreview = useCallback((
    linePreview: SlideLinePreview,
  ) => {
    const currentSnapshot = readSnapshot()
    const current = currentSnapshot.editingNodes.find((item) => item.id === linePreview.nodeId)
    if (!current) return
    const normalized = {
      ...current,
      x: linePreview.frame.x,
      y: linePreview.frame.y,
      width: linePreview.frame.width,
      height: linePreview.frame.height,
      lineGeometry: structuredClone(linePreview.lineGeometry),
    } as AuthoringPatchNode
    gameRef.current?.bridge.applyNode(normalized)
    queueAuthoringNodePatch(currentSnapshot.editingScope, normalized)
  }, [queueAuthoringNodePatch])

  const revertSlideDragPreview = useCallback(() => {
    const currentSnapshot = readSnapshot()
    // Pointer cancellation must repaint every transient Native frame as well as
    // the line geometry. The project was never mutated during the gesture.
    for (const layer of currentSnapshot.view?.layers ?? []) {
      if (layer.source === (currentSnapshot.backend?.getSession().scope ?? currentSnapshot.editingScope) &&
        layer.item.kind === 'native' && ['table', 'chart', 'input'].includes(layer.item.content.nativeType)) {
        queueAuthoringNodePatch(currentSnapshot.editingScope, nativeRenderInputFromV9Item(layer.item as NativeLayerItem))
      }
    }
    for (const node of currentSnapshot.editingNodes) {
      gameRef.current?.bridge.applyNode(node)
      queueAuthoringNodePatch(currentSnapshot.editingScope, node as AuthoringPatchNode)
    }
  }, [queueAuthoringNodePatch])

  useLayoutEffect(() => {
    if (!candidatePointerActiveRef.current) return
    // A navigation, scope switch or external commit cannot retarget a gesture
    // that started from different geometry. Pointer-up must then write nothing.
    candidatePointerActiveRef.current = false
    revertSlideDragPreview()
    const viewport = readCandidateViewport()
    if (viewport) {
      slideAuthoringRef.current.cancelGesture(viewport)
      setLayerOverlay(slideAuthoringRef.current.overlayGeometry(viewport))
    }
    setLineDragGuides(null)
  }, [snapshot.projectId, courseLocationId, activePresentationStateId, publishedAuthoringOwnerScope,
    canvasMode, backend?.getSession().history.present.revision])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (isEditableKeyboardTarget(event.target)) return
      if (drawGestureRef.current || readSnapshot().drawTool !== null) {
        drawGestureRef.current = null
        setDrawPreview(null)
        portsRef.current.canvas.setDrawTool(null)
        return
      }
      if (candidatePointerActiveRef.current) {
        revertSlideDragPreview()
        const viewport = readCandidateViewport()
        if (viewport) {
          slideAuthoringRef.current.cancelGesture(viewport)
          setLayerOverlay(slideAuthoringRef.current.overlayGeometry(viewport))
        }
        candidatePointerActiveRef.current = false
        setLineDragGuides(null)
      }
    }
    const onBlur = () => {
      if (candidatePointerActiveRef.current) {
        revertSlideDragPreview()
        const viewport = readCandidateViewport()
        if (viewport) {
          slideAuthoringRef.current.cancelGesture(viewport)
          setLayerOverlay(slideAuthoringRef.current.overlayGeometry(viewport))
        }
        candidatePointerActiveRef.current = false
        setLineDragGuides(null)
      }
      if (drawGestureRef.current) {
        drawGestureRef.current = null
        setDrawPreview(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [revertSlideDragPreview])

  const syncCompleteAuthoringSnapshot = useCallback(() => {
    const currentSnapshot = readSnapshot()
    const view = currentSnapshot.view
    if (!view) return null
    const authoringScope = publishedAuthoringInitRef.current?.authoringScope
      ?? currentSnapshot.backend?.getSnapshot().scope
      ?? currentSnapshot.editingScope
    if (authoringFrameRef.current !== null) {
      window.cancelAnimationFrame(authoringFrameRef.current)
      authoringFrameRef.current = null
    }
    pendingAuthoringNodesRef.current.clear()
    const localSource = localPublishedAuthoringSource(authoringScope)
    const currentState = extractPublishedAuthoringState(view, localSource)
    previousPublishedStateRef.current = structuredClone(currentState)
    const patches = publishedAuthoringPatchesFromSlideView(
      view,
      localSource,
    )
    let lastCommand: PlayerAuthoringPatchCommand | null = null
    for (const patch of patches) {
      lastCommand = postAuthoringPatch(patch)
      if (!lastCommand) return null
    }
    return lastCommand
  }, [postAuthoringPatch])

  useEffect(() => () => {
    if (authoringFrameRef.current !== null) {
      window.cancelAnimationFrame(authoringFrameRef.current)
      authoringFrameRef.current = null
    }
    pendingAuthoringNodesRef.current.clear()
    previousPublishedStateRef.current = null
  }, [])

  const handlePublishedAuthoringMessage = useCallback((
    message: PlayerAuthoringHostMessage,
  ) => {
    const init = publishedAuthoringInitRef.current
    if (!init || message.sessionId !== init.token) return
    if (message.type === PLAYER_AUTHORING_MESSAGE_TYPES.ready) {
      if (authoringReadyRef.current) return
      const parsed = parsePlayerAuthoringReadyMessage(message)
      if (!parsed.ok) {
        failPublishedAuthoring(
          init.token,
          `编辑画布握手无效：${parsed.message}。请重新载入画布。`,
        )
        return
      }
      if (
        parsed.ready.context.sceneId !== init.initialSceneId ||
        parsed.ready.context.stateId !== init.initialStateId
      ) {
        failPublishedAuthoring(
          init.token,
          '编辑画布返回了不一致的场景或状态。请重新载入画布。',
        )
        return
      }
      authoringReadyRef.current = true
      setPreviewFeedback({
        kind: 'loading',
        title: '正在同步编辑画布',
        message: 'Published 宿主已启动，正在应用当前画面的完整快照…',
      })
      const lastCommand = syncCompleteAuthoringSnapshot()
      if (!lastCommand) {
        failPublishedAuthoring(
          init.token,
          '当前画面的完整快照未能发送。请重新载入画布。',
        )
        return
      }
      authoringSnapshotBarrierRef.current =
        playerAuthoringSnapshotBarrierForCommand(lastCommand)
      return
    }
    if (message.type === PLAYER_AUTHORING_MESSAGE_TYPES.ack) {
      const barrier = authoringSnapshotBarrierRef.current
      if (!barrier || !isPlayerAuthoringSnapshotAck(message, barrier)) return
      if (pendingAuthoringNodesRef.current.size > 0) {
        if (authoringFrameRef.current !== null) {
          window.cancelAnimationFrame(authoringFrameRef.current)
        }
        flushAuthoringNodePatches()
        return
      }
      authoringSnapshotBarrierRef.current = null
      setAcknowledgedPreviewGeneration(previewGeneration)
      setPreviewFeedback(null)
      return
    }
    if (message.type === PLAYER_AUTHORING_MESSAGE_TYPES.runtimeTargets) {
      if (message.revision <= lastAuthoringTargetsRevisionRef.current) return
      lastAuthoringTargetsRevisionRef.current = message.revision
      const hostKey = `${message.update.scope}:${message.update.sceneId ?? ''}`
      runtimeTargetsByHostRef.current.set(
        hostKey,
        sanitizeRuntimeAuthoringTargets(message.update, hostKey),
      )
      setRuntimeTargets([...runtimeTargetsByHostRef.current.values()].flat())
      return
    }
    if (message.type === PLAYER_AUTHORING_MESSAGE_TYPES.componentTargets) {
      if (message.revision <= lastAuthoringTargetsRevisionRef.current) return
      lastAuthoringTargetsRevisionRef.current = message.revision
      const hostKey = [
        message.update.scope,
        message.update.sceneId ?? '',
        message.update.nodeId,
      ].join(':')
      componentTargetsByHostRef.current.set(
        hostKey,
        sanitizeComponentAuthoringTargets(message.update, hostKey),
      )
      setComponentTargets([...componentTargetsByHostRef.current.values()].flat())
      return
    }
    if (message.type !== PLAYER_AUTHORING_MESSAGE_TYPES.error) return
    if (authoringSnapshotBarrierRef.current) {
      failPublishedAuthoring(
        init.token,
        `初始画面同步失败：${message.message}。请重新载入画布。`,
      )
      return
    }
    ports.canvas.setStatus(`画布同步未应用：${message.message}`)
  }, [
    failPublishedAuthoring,
    flushAuthoringNodePatches,
    previewGeneration,
    syncCompleteAuthoringSnapshot,
  ])

  useEffect(() => {
    const container = publishedAuthoringHostRef.current
    if (!usePublishedAuthoring || !container) {
      const leftover = publishedAuthoringSessionRef.current
      publishedAuthoringSessionRef.current = null
      publishedAuthoringInitRef.current = null
      if (leftover) {
        enqueueSerial(publishedAuthoringMountChainRef, () => leftover.destroy())
      }
      return
    }

    const mountSnapshot = readSnapshot()
    const locationId = mountSnapshot.locationId
    if (!locationId || !mountSnapshot.sceneId) {
      setPreviewFeedback({
        kind: 'error',
        title: '统一画布创建失败',
        message: '当前 Slide 场景没有可用的 V9 Published 位置。',
      })
      return
    }
    authoringReadyRef.current = false
    authoringRevisionRef.current = 0
    authoringSnapshotBarrierRef.current = null
    lastAuthoringTargetsRevisionRef.current = -1
    runtimeTargetsByHostRef.current.clear()
    componentTargetsByHostRef.current.clear()
    setRuntimeTargets([])
    setComponentTargets([])
    setAcknowledgedPreviewGeneration(null)
    setPreviewFeedback({
      kind: 'loading',
      title: '正在准备编辑画布',
      message: '正在挂载 Published V2 编辑宿主…',
    })
    const token = crypto.randomUUID()
    const authoringScope = publishedAuthoringOwnerScope
    publishedAuthoringInitRef.current = {
      token,
      initialSceneId: mountSnapshot.sceneId,
      initialStateId: mountSnapshot.presentationStateId,
      authoringScope,
    }

    return beginSerializedSessionMount(
      publishedAuthoringMountChainRef,
      () => ports.preview.mount({
        container,
        sessionId: token,
        scope: authoringScope,
        onSessionCreated: (session) => {
          if (publishedAuthoringInitRef.current?.token === token) {
            publishedAuthoringSessionRef.current = session
          }
        },
        onMessage: handlePublishedAuthoringMessage,
      }),
      {
        onReady: (session) => {
          if (publishedAuthoringInitRef.current?.token !== token) return
          publishedAuthoringSessionRef.current = session
          container.dataset.coursePlayerReady = 'true'
        },
        onError: (error) => {
          console.error('Published 编辑宿主启动失败', error)
          failPublishedAuthoring(
            token,
            error instanceof Error ? error.message : 'Published 编辑宿主未能完成启动。',
          )
        },
        onCleanup: () => {
          container.dataset.coursePlayerReady = 'false'
          if (publishedAuthoringInitRef.current?.token === token) {
            publishedAuthoringInitRef.current = null
          }
          publishedAuthoringSessionRef.current = null
          authoringReadyRef.current = false
          authoringSnapshotBarrierRef.current = null
          runtimeTargetsByHostRef.current.clear()
          componentTargetsByHostRef.current.clear()
          setRuntimeTargets([])
          setComponentTargets([])
          setAcknowledgedPreviewGeneration(null)
        },
      },
    )
  }, [
    publishedAuthoringOwnerScope,
    failPublishedAuthoring,
    handlePublishedAuthoringMessage,
    previewGeneration,
    usePublishedAuthoring,
  ])

  useEffect(() => {
    const container = courseTryRunRef.current
    if (!useCoursePlayerTryRun || !snapshot.projectId || !container || !tryRunMountKey) {
      courseTryRunFitRef.current?.()
      courseTryRunFitRef.current = null
      const leftover = courseTryRunSessionRef.current
      courseTryRunSessionRef.current = null
      if (leftover) {
        enqueueSerial(courseTryRunMountChainRef, () => leftover.destroy())
      }
      setTryRunFeedback(null)
      return
    }
    setTryRunFeedback({
      kind: 'loading',
      title: '正在准备当前位置试运行',
      message: '正在载入 CoursePlayer…',
    })
    const mountSnapshot = readSnapshot()
    const locationId = mountSnapshot.locationId
    if (!mountSnapshot.projectId) {
      setTryRunFeedback(null)
      return
    }
    return beginSerializedSessionMount(courseTryRunMountChainRef, () => ports.tryRun.mount(container), {
      onReady: (session) => {
        courseTryRunFitRef.current?.()
        courseTryRunFitRef.current = ports.tryRun.attachStageFit(container)
        courseTryRunSessionRef.current = session
        container.dataset.coursePlayerReady = 'true'
        setTryRunFeedback(null)
        setTryRunEpoch((current) => current + 1)
      },
      onError: (error) => {
        console.error('CoursePlayer 试运行启动失败', error)
        setTryRunFeedback({
          kind: 'error',
          title: '当前位置试运行启动失败',
          message: error instanceof Error ? error.message : '播放器未能完成启动。请重试。',
        })
      },
      onCleanup: () => {
        container.dataset.coursePlayerReady = 'false'
        courseTryRunFitRef.current?.()
        courseTryRunFitRef.current = null
        courseTryRunSessionRef.current = null
      },
    })
  }, [tryRunMountKey, useCoursePlayerTryRun])

  useEffect(() => {
    const session = courseTryRunSessionRef.current
    if (!useCoursePlayerTryRun || !session || !courseLocationId) return
    void session.goToLocation(courseLocationId).catch((error) => {
      console.error('CoursePlayer 试运行跳转失败', error)
    })
  }, [courseLocationId, tryRunEpoch, useCoursePlayerTryRun])

  const document = useMemo<SlidePhaserDocument>(() => {
    if (!slideEditorView) {
      return {
        id: '__editor_empty_slide__',
        name: '',
        backgroundColor: '#ffffff',
        interactions: [],
        nodes: [],
      }
    }
    return phaserDocumentFromView(slideEditorView, editingScope)
  }, [editingScope, slideEditorView])

  const slideSceneId = slideEditorView?.sceneId ?? ''
  const courseProjectId = snapshot.projectId || undefined

  const editingNode = useMemo(() => {
    if (!editingTextNodeId || !slideEditorView) return undefined
    const item = nativeSlideLayer(slideEditorView.layers, editingTextNodeId, 'text')
    return item ? materializeNativeLayerItem(item) as TextNode : undefined
  }, [editingTextNodeId, slideEditorView])
  const editingFormulaNode = useMemo<FormulaNode | undefined>(() => {
    const session = activeFormulaEditSession
    if (
      !session ||
      !slideEditorView ||
      !courseProjectId ||
      canvasMode !== 'edit' ||
      session.projectId !== courseProjectId ||
      session.scope !== editingScope ||
      session.sceneId !== slideSceneId ||
      session.stateId !== activePresentationStateId
    ) {
      return undefined
    }
    const item = nativeSlideLayer(slideEditorView.layers, session.nodeId, 'formula')
    return item ? materializeNativeLayerItem(item) as FormulaNode : undefined
  }, [
    activeFormulaEditSession,
    activePresentationStateId,
    canvasMode,
    courseProjectId,
    editingScope,
    slideEditorView,
    slideSceneId,
  ])

  useEffect(() => {
    if (activeFormulaEditSession && !editingFormulaNode) {
      setActiveFormulaEditSession(null)
    }
  }, [activeFormulaEditSession, editingFormulaNode])
  const visibleRuntimeTargets = useMemo(
    () => runtimeTargets.filter((target) => (
      (target.kind === 'text' || target.kind === 'asset') &&
      runtimeTargetMatchesEditingContext(target, editingScope, slideSceneId)
    )),
    [editingScope, runtimeTargets, slideSceneId],
  )
  const visibleComponentTargets = useMemo(
    () => componentTargets.filter((target) => {
      if (target.scope !== editingScope) return false
      if (target.scope === 'scene' && target.sceneId !== slideSceneId) return false
      const layer = slideEditorView?.layers.find((candidate) => candidate.selectionId === target.nodeId)
      return Boolean(
        layer &&
        layer.item.kind === 'component' &&
        layer.item.visible &&
        !layer.item.locked,
      )
    }),
    [componentTargets, editingScope, slideEditorView, slideSceneId],
  )
  const activeComponentTextTarget = useMemo(() => {
    if (
      !activeComponentTextSession ||
      !courseProjectId ||
      !componentTextEditSessionMatchesContext(activeComponentTextSession, {
        projectId: courseProjectId,
        scope: editingScope,
        sceneId: slideSceneId,
        stateId: activePresentationStateId,
      })
    ) {
      return undefined
    }
    return visibleComponentTargets.find((target) => (
      componentTextTargetMatchesSession(target, activeComponentTextSession)
    ))
  }, [
    activeComponentTextSession,
    activePresentationStateId,
    courseProjectId,
    editingScope,
    slideSceneId,
    visibleComponentTargets,
  ])
  const componentEditingLayer = useMemo(() => {
    if (!activeComponentTextSession || !activeComponentTextTarget || !slideEditorView) {
      return null
    }
    const layer = slideEditorView.layers.find((candidate) => (
      candidate.selectionId === activeComponentTextSession.nodeId
    ))
    if (!layer || layer.item.kind !== 'component') return null
    if (
      layer.item.component.packageId !== activeComponentTextSession.componentId ||
      layer.item.component.version !== activeComponentTextSession.componentVersion
    ) {
      return null
    }
    return layer
  }, [activeComponentTextSession, activeComponentTextTarget, slideEditorView])
  const componentEditingValue = activeComponentTextSession?.initialValue ?? ''
  const activeRuntimeTextTarget = useMemo(() => {
    if (
      !activeRuntimeTextSession ||
      !courseProjectId ||
      activeRuntimeTextSession.liveSession.kind !== 'text' ||
      !runtimeTargetEditSessionMatchesContext(activeRuntimeTextSession.liveSession, {
        projectId: courseProjectId,
        scope: editingScope,
        sceneId: slideSceneId,
      })
    ) {
      return undefined
    }
    return visibleRuntimeTargets.find((target) => (
      runtimeTargetMatchesEditSession(target, activeRuntimeTextSession.liveSession)
    ))
  }, [
    activeRuntimeTextSession,
    courseProjectId,
    editingScope,
    slideSceneId,
    visibleRuntimeTargets,
  ])
  const activeRuntimeTextValue = activeRuntimeTextSession?.courseTarget.initialValue ?? ''

  useEffect(() => {
    if (
      canvasMode !== 'edit' ||
      !activeRuntimeTextSession ||
      !activeRuntimeTextTarget
    ) {
      setActiveRuntimeTextSession(null)
    }
  }, [activeRuntimeTextSession, activeRuntimeTextTarget, canvasMode])

  useEffect(() => {
    if (
      canvasMode !== 'edit' ||
      !activeComponentTextSession ||
      !activeComponentTextTarget
    ) {
      setActiveComponentTextSession(null)
    }
  }, [activeComponentTextSession, activeComponentTextTarget, canvasMode])

  const currentComponentTextEditContext = useCallback(
    (): ComponentTextEditContext => {
      const currentSnapshot = readSnapshot()
      const nodes = currentSnapshot.editingNodes
      const visibleComponentNodeIds = new Set(nodes.flatMap((node) => (
        node.type === 'external-component' && node.visible && !node.locked
          ? [node.id]
          : []
      )))
      return {
        projectId: currentSnapshot.projectId,
        scope: currentSnapshot.editingScope,
        sceneId: currentSnapshot.sceneId,
        stateId: currentSnapshot.presentationStateId,
        nodes,
        componentPackages: currentSnapshot.componentPackages,
        // Read the synchronous host registry rather than React render state so
        // a blur racing with target cleanup can never commit a retired target.
        targets: [...componentTargetsByHostRef.current.values()]
          .flat()
          .filter((target) => (
            target.scope === currentSnapshot.editingScope &&
            (target.scope === 'global' ||
              target.sceneId === currentSnapshot.sceneId) &&
            visibleComponentNodeIds.has(target.nodeId)
          )),
      }
    },
    [],
  )

  const currentRuntimeTargetEditContext = useCallback(
    (): RuntimeTargetEditContext => {
      const currentSnapshot = readSnapshot()
      return {
        projectId: currentSnapshot.projectId,
        scope: currentSnapshot.editingScope,
        sceneId: currentSnapshot.sceneId,
        stateId: currentSnapshot.presentationStateId,
        // Read the synchronous host registry so a commit racing with target
        // cleanup cannot write into a replacement Runtime that happens to use
        // the same content or asset key.
        targets: [...runtimeTargetsByHostRef.current.values()]
          .flat()
          .filter((target) => (
            (target.kind === 'text' || target.kind === 'asset') &&
            runtimeTargetMatchesEditingContext(
              target,
              currentSnapshot.editingScope,
              currentSnapshot.sceneId,
            )
          )),
      }
    },
    [],
  )

  const beginComponentTextEdit = useCallback((
    target: Readonly<ComponentAuthoringTextTarget>,
  ) => {
    ports.content.commitTextEdit()
    const result = beginComponentTextEditSession(
      target,
      currentComponentTextEditContext(),
    )
    if (!result.ok) {
      ports.canvas.setStatus(
        result.reason === 'context-changed'
          ? '组件文字编辑上下文已切换，请重新选择'
          : '组件文字目标已失效，请重新选择',
      )
      setActiveComponentTextSession(null)
      return
    }
    ports.selection.selectNode(result.session.nodeId)
    setActiveRuntimeTextSession(null)
    setActiveComponentTextSession(result.session)
  }, [currentComponentTextEditContext])

  const commitComponentText = useCallback((
    session: Readonly<ComponentTextEditSession>,
    value: string,
  ) => {
    const result = resolveComponentTextEdit(
      session,
      value,
      currentComponentTextEditContext(),
    )
    if (!result.ok) {
      ports.canvas.setStatus(
        result.reason === 'context-changed'
          ? '组件文字编辑上下文已切换，未写入修改'
          : '组件文字目标已失效，未写入修改',
      )
      setActiveComponentTextSession(null)
      return
    }
    ports.content.updateNode(result.nodeId, {
      props: result.props,
    })
    const updatedNode = readSnapshot().editingNodes.find((node) => (
      node.id === result.nodeId && node.type === 'external-component'
    ))
    if (
      !updatedNode
      || updatedNode.type !== 'external-component'
      || updatedNode.locked
      || getComponentPropValue(updatedNode.props ?? {}, session.key) !== value
    ) {
      ports.canvas.setStatus(
        updatedNode?.locked
          ? '组件已锁定，未写入文字修改'
          : '组件文字未写入，请重新选择后重试',
      )
      setActiveComponentTextSession(null)
      return
    }
    queueAuthoringNodePatch(session.scope === 'global' ? 'global' : 'scene', updatedNode)
    ports.canvas.setStatus(
      session.stateId === null || session.scope === 'global'
        ? '已更新组件文字'
        : '已更新当前演示状态中的组件文字',
    )
    setActiveComponentTextSession(null)
  }, [currentComponentTextEditContext, queueAuthoringNodePatch])

  const beginRuntimeTextEdit = useCallback((
    target: Readonly<RuntimeAuthoringTarget>,
  ) => {
    if (target.kind !== 'text') return
    ports.content.commitTextEdit()
    const result = beginRuntimeTargetEditSession(
      target,
      currentRuntimeTargetEditContext(),
    )
    if (!result.ok) {
      ports.canvas.setStatus(
        result.reason === 'context-changed'
          ? '运行时文字编辑上下文已切换，请重新选择'
          : '运行时文字目标已失效，请重新选择',
      )
      setActiveRuntimeTextSession(null)
      return
    }
    const courseTarget = ports.runtime.captureRuntimeContentTextTarget(result.session)
    if (!courseTarget) {
      ports.canvas.setStatus('运行时文字目标没有可提交的 V9 作者地址，或当前 Runtime 已锁定')
      setActiveRuntimeTextSession(null)
      return
    }
    setActiveComponentTextSession(null)
    setActiveRuntimeTextSession(Object.freeze({
      liveSession: result.session,
      courseTarget,
    }))
  }, [currentRuntimeTargetEditContext])

  const commitRuntimeText = useCallback((
    session: Readonly<SlideRuntimeTextEditSession>,
    value: string,
  ) => {
    const result = validateRuntimeTargetEditSession(
      session.liveSession,
      currentRuntimeTargetEditContext(),
    )
    if (!result.ok) {
      ports.canvas.setStatus(
        result.reason === 'context-changed'
          ? '运行时文字编辑上下文已切换，未写入修改'
          : '运行时文字目标已失效，未写入修改',
      )
      setActiveRuntimeTextSession(null)
      return
    }
    const committed = ports.runtime.updateRuntimeContentTextAtTarget(
      session.courseTarget,
      value,
    )
    if (!committed.ok) {
      ports.canvas.setStatus(`${committed.reason} 未写入修改`)
    } else if (committed.status === 'unchanged') {
      ports.canvas.setStatus('运行时文字没有变化')
    } else if (session.courseTarget.courseTarget.owner === 'global') {
      ports.canvas.setStatus('已更新全局运行时文字；此内容由整课共享')
    } else {
      ports.canvas.setStatus('已更新运行时文字；此内容由当前场景的所有状态共享')
    }
    if (committed.ok && committed.status === 'updated') {
      const target = session.courseTarget.courseTarget
      postAuthoringPatch({
        kind: 'runtime-content',
        target: {
          kind: 'runtime-content',
          scope: target.owner === 'global' ? 'global' : 'scene',
          nodeId: target.itemId,
          key: session.courseTarget.contentKey,
        },
        value,
      })
    }
    setActiveRuntimeTextSession(null)
  }, [currentRuntimeTargetEditContext, postAuthoringPatch])

  const replaceRuntimeAsset = useCallback(async (
    target: Readonly<RuntimeAuthoringTarget>,
  ) => {
    if (target.kind !== 'asset' || replacingRuntimeAssetTargetId) return
    const started = beginRuntimeTargetEditSession(
      target,
      currentRuntimeTargetEditContext(),
    )
    if (!started.ok) {
      ports.canvas.setStatus(
        started.reason === 'context-changed'
          ? '运行时图片编辑上下文已切换，请重新选择'
          : '运行时图片目标已失效，请重新选择',
      )
      return
    }
    const session = started.session
    const courseTarget = ports.runtime.captureRuntimeAssetReplacementTarget(session)
    if (!courseTarget) {
      ports.canvas.setStatus('运行时图片目标没有可提交的 V9 作者地址，请重新选择')
      return
    }
    setReplacingRuntimeAssetTargetId(session.targetId)
    try {
      const imported = await onSelectImageAsset()
      if (!imported) return
      const result = validateRuntimeTargetEditSession(
        session,
        currentRuntimeTargetEditContext(),
      )
      if (!result.ok) {
        ports.canvas.setStatus(
          result.reason === 'context-changed'
            ? '运行时图片编辑上下文已切换，未写入修改'
            : '运行时图片目标已失效，未写入修改',
        )
        return
      }
      const committed = ports.runtime.replaceRuntimeAssetAtTarget(
        courseTarget,
        imported.meta,
        imported.bytes,
      )
      if (!committed.ok) {
        ports.canvas.setStatus(`${committed.reason} 未写入修改`)
        return
      }
      if (committed.status === 'unchanged') {
        ports.canvas.setStatus('运行时图片未改变')
        return
      }
      ports.canvas.setStatus(
        courseTarget.courseTarget.owner === 'global'
          ? '已替换全局运行时图片；此素材由整课共享'
          : '已替换运行时图片；此素材由当前场景的所有状态共享',
      )
    } finally {
      setReplacingRuntimeAssetTargetId(null)
    }
  }, [
    currentRuntimeTargetEditContext,
    onSelectImageAsset,
    replacingRuntimeAssetTargetId,
  ])

  const canvasAuthoringHitAtClientPoint = useCallback((
    clientX: number,
    clientY: number,
  ): CanvasAuthoringHit | null => {
    const viewport = stageViewportRef.current
    if (!viewport || !authoringCanvasInteractive) return null
    const rect = viewport.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const transform = createStageViewportTransform({
      viewport: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      zoom: view.zoom,
      pan: { x: view.x, y: view.y },
    })
    const point = clientToWorld(transform, { x: clientX, y: clientY })
    const ordered = [...visibleRuntimeTargets].sort((left, right) => (
      (left.layer === 'overlay' ? 1 : 0) -
      (right.layer === 'overlay' ? 1 : 0)
    ))
    const runtimeTarget = ordered.reverse().find((candidate) => (
      point.x >= candidate.bounds.x &&
      point.x <= candidate.bounds.x + candidate.bounds.width &&
      point.y >= candidate.bounds.y &&
      point.y <= candidate.bounds.y + candidate.bounds.height
    )) ?? null
    if (runtimeTarget?.layer === 'overlay') {
      return { kind: 'runtime', target: runtimeTarget }
    }
    const componentTarget = [...visibleComponentTargets].reverse().find(
      (candidate) => pointInsideRotatedBounds(
        point,
        candidate.bounds,
        candidate.rotation,
      ),
    )
    if (componentTarget) {
      return { kind: 'component', target: componentTarget }
    }
    if (
      runtimeTarget?.layer === 'underlay' &&
      (slideEditorView?.layers ?? []).some((layer) => (
        layer.effectiveVisible &&
        pointInsideRotatedBounds(point, {
          x: layer.item.frame.x,
          y: layer.item.frame.y,
          width: layer.item.frame.width,
          height: layer.item.frame.height,
        }, layer.item.rotation)
      ))
    ) {
      return null
    }
    return runtimeTarget ? { kind: 'runtime', target: runtimeTarget } : null
  }, [
    authoringCanvasInteractive,
    slideEditorView,
    visibleRuntimeTargets,
    view.x,
    view.y,
    view.zoom,
    visibleComponentTargets,
  ])

  useLayoutEffect(() => {
    const host = gameHostRef.current
    if (!host) return
    const handle = createEditorGame(host, {
      fixedLogicalSize: true,
    })
    gameRef.current = handle
    const findCanvas = () => {
      const element = host.querySelector('canvas')
      if (element) setCanvas(element)
    }
    findCanvas()
    const observer = new MutationObserver(findCanvas)
    observer.observe(host, { childList: true })

    const unsubscribers = [
      handle.bridge.onNodeSelected(({ nodeIds, additive }) => {
        const currentSnapshot = readSnapshot()
        if (!additive) {
          ports.selection.selectNodes(nodeIds)
          return
        }
        const merged = new Set(currentSnapshot.selectedNodeIds)
        for (const nodeId of nodeIds) {
          if (merged.has(nodeId)) merged.delete(nodeId)
          else merged.add(nodeId)
        }
        ports.selection.selectNodes([...merged])
      }),
      handle.bridge.onNodesTransformPreview(({ nodes }) => {
        const currentSnapshot = readSnapshot()
        if (currentSnapshot.canvasMode !== 'edit') return
        const currentById = new Map(
          currentSnapshot.editingNodes.map((node) => [node.id, node]),
        )
        for (const { nodeId, ...patch } of nodes) {
          const current = currentById.get(nodeId)
          if (!current) continue
          const normalizedPatch = withDirectionAwareTextAutoSize(
            current,
            patch,
          )
          queueAuthoringNodePatch(
            currentSnapshot.editingScope,
            { ...current, ...normalizedPatch } as AuthoringPatchNode,
          )
        }
      }),
      handle.bridge.onNodeMoveEnd(() => {}),
      handle.bridge.onNodesMoveEnd(() => {}),
      handle.bridge.onNodeResizeEnd(() => {}),
      handle.bridge.onNodeRotateEnd(() => {}),
      handle.bridge.onNodesTransformEnd(() => {}),
      handle.bridge.onTextDoubleClick((nodeId) => {
        setActiveFormulaEditSession(null)
        setActiveComponentTextSession(null)
        setActiveRuntimeTextSession(null)
        ports.selection.selectNode(nodeId)
        ports.content.beginTextEdit(nodeId, 'canvas')
      }),
      handle.bridge.onFormulaDoubleClick((nodeId) => {
        const currentSnapshot = readSnapshot()
        const view = currentSnapshot.view
        if (!view || currentSnapshot.canvasMode !== 'edit') return
        const item = nativeSlideLayer(view.layers, nodeId, 'formula')
        if (!item) return
        if (currentSnapshot.editingTextNodeId) {
          ports.content.cancelTextEdit()
          handle.bridge.setTextEditing(null)
        }
        setActiveComponentTextSession(null)
        setActiveRuntimeTextSession(null)
        ports.selection.selectNode(nodeId)
        setActiveFormulaEditSession({
          projectId: currentSnapshot.projectId,
          scope: currentSnapshot.editingScope,
          sceneId: view.sceneId,
          stateId: currentSnapshot.presentationStateId,
          nodeId,
        })
      }),
    ]

    return () => {
      observer.disconnect()
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      handle.destroy()
      gameRef.current = null
      setCanvas(null)
    }
  }, [queueAuthoringNodePatch])

  useLayoutEffect(() => {
    // Scale.NONE deliberately leaves sizing to the unified stage, but Phaser
    // then does not observe ancestor CSS transforms. Refresh its cached canvas
    // bounds after every zoom/pan commit so pointer coordinates stay in the
    // same 1280×720 space as the Player and authoring targets.
    gameRef.current?.game.scale.refresh()
  }, [
    stageTransform.scale,
    stageTransform.stageRect.x,
    stageTransform.stageRect.y,
  ])

  useEffect(() => {
    const handle = gameRef.current
    if (!handle) return
    const previous = previousSceneRef.current
    const componentsChanged =
      previousComponentPackagesRef.current !== componentPackages
    const editingId = readSnapshot().editingTextNodeId

    if (
      previous &&
      previous.id === document.id &&
      !componentsChanged &&
      editingId
    ) {
      const previousIds = previous.nodes.map((node) => node.id).join('|')
      const nextIds = document.nodes.map((node) => node.id).join('|')
      const authoringScope = publishedAuthoringInitRef.current?.authoringScope
        ?? backend?.getSnapshot().scope
        ?? editingScope
      const localSource = localPublishedAuthoringSource(authoringScope)
      const currentPublished = extractPublishedAuthoringState(slideEditorView, localSource)
      const prevPublished = previousPublishedStateRef.current
      const publishedDirty = prevPublished ? (
        prevPublished.backgroundColor !== currentPublished.backgroundColor
        || prevPublished.backgroundAssetId !== currentPublished.backgroundAssetId
        || prevPublished.localNodes.map((n) => n.id).join('|') !== currentPublished.localNodes.map((n) => n.id).join('|')
        || prevPublished.globalNodes.map((n) => n.id).join('|') !== currentPublished.globalNodes.map((n) => n.id).join('|')
        || currentPublished.localNodes.some((node) => {
          if (node.id === editingId) return false
          const before = prevPublished.localNodes.find((item) => item.id === node.id)
          return !before || !nodesEqual(before, node)
        })
        || currentPublished.globalNodes.some((node) => {
          if (node.id === editingId) return false
          const before = prevPublished.globalNodes.find((item) => item.id === node.id)
          return !before || !nodesEqual(before, node)
        })
      ) : false
      const othersDirty =
        previousIds !== nextIds
        || previous.backgroundColor !== document.backgroundColor
        || previous.backgroundAssetId !== document.backgroundAssetId
        || document.nodes.some((node) => {
          if (node.id === editingId) return false
          const before = previous.nodes.find((item) => item.id === node.id)
          return !before || !nodesEqual(before, node)
        })
        || publishedDirty
      if (!othersDirty) return
    }

    if (
      !previous ||
      previous.id !== document.id ||
      componentsChanged
    ) {
      handle.bridge.loadScene(document, componentPackages)
    } else {
      const previousById = new Map(previous.nodes.map((node) => [node.id, node]))
      const nextById = new Map(document.nodes.map((node) => [node.id, node]))
      previous.nodes.forEach((node) => {
        if (!nextById.has(node.id)) handle.bridge.removeNode(node.id)
      })
      document.nodes.forEach((node) => {
        const before = previousById.get(node.id)
        if (!before) handle.bridge.addNode(node)
        else if (!nodesEqual(before, node) && node.id !== editingId) {
          handle.bridge.applyNode(node)
        }
      })
      const previousIds = previous.nodes.map((node) => node.id).join('|')
      const nextIds = document.nodes.map((node) => node.id).join('|')
      if (previousIds !== nextIds) {
        handle.bridge.reorderNodes(document.nodes.map((node) => node.id))
      }
    }
    if (canvasMode === 'edit' && authoringReadyRef.current) {
      const authoringScope = publishedAuthoringInitRef.current?.authoringScope
        ?? backend?.getSnapshot().scope
        ?? editingScope
      const localSource = localPublishedAuthoringSource(authoringScope)
      const currentPublished = extractPublishedAuthoringState(slideEditorView, localSource)
      const previousPublished = previousPublishedStateRef.current

      if (previousPublished) {
        const previousLocalById = new Map(
          previousPublished.localNodes.map((node) => [node.id, node]),
        )
        for (const node of currentPublished.localNodes) {
          if (node.id === editingId) continue
          const before = previousLocalById.get(node.id)
          if (!before || !nodesEqual(before, node)) {
            queueAuthoringNodePatch('scene', node)
          }
        }

        const previousGlobalById = new Map(
          previousPublished.globalNodes.map((node) => [node.id, node]),
        )
        for (const node of currentPublished.globalNodes) {
          if (node.id === editingId) continue
          const before = previousGlobalById.get(node.id)
          if (!before || !nodesEqual(before, node)) {
            queueAuthoringNodePatch('global', node)
          }
        }

        if (editingScope === 'scene') {
          if (
            previousPublished.backgroundColor !== currentPublished.backgroundColor ||
            previousPublished.backgroundAssetId !== currentPublished.backgroundAssetId
          ) {
            postAuthoringPatch({
              kind: 'scene-background',
              target: { kind: 'scene-background', scope: 'scene' },
              backgroundColor: currentPublished.backgroundColor,
              backgroundAssetId: currentPublished.backgroundAssetId,
            })
          }
          const previousOrder = previousPublished.localNodes.map((node) => node.id).join('|')
          const nextOrder = currentPublished.localNodes.map((node) => node.id).join('|')
          if (previousOrder !== nextOrder) {
            postAuthoringPatch({
              kind: 'scene-order',
              target: { kind: 'scene-order', scope: 'scene' },
              nodeIds: currentPublished.localNodes.map((node) => node.id),
            })
          }
        }
      }

      previousPublishedStateRef.current = structuredClone(currentPublished)
      if (editingId && previousPublishedStateRef.current && previousPublished) {
        const oldLocal = previousPublished.localNodes.find((node) => node.id === editingId)
        if (oldLocal) {
          const idx = previousPublishedStateRef.current.localNodes.findIndex((node) => node.id === editingId)
          if (idx >= 0) {
            previousPublishedStateRef.current.localNodes[idx] = structuredClone(oldLocal)
          }
        }
        const oldGlobal = previousPublished.globalNodes.find((node) => node.id === editingId)
        if (oldGlobal) {
          const idx = previousPublishedStateRef.current.globalNodes.findIndex((node) => node.id === editingId)
          if (idx >= 0) {
            previousPublishedStateRef.current.globalNodes[idx] = structuredClone(oldGlobal)
          }
        }
      }
    }
    previousSceneRef.current = structuredClone(document)
    previousComponentPackagesRef.current = componentPackages
    if (editingId && previous) {
      const oldNode = previous.nodes.find((node) => node.id === editingId)
      if (oldNode) {
        const index = previousSceneRef.current.nodes.findIndex((node) => node.id === editingId)
        if (index >= 0) {
          previousSceneRef.current.nodes[index] = structuredClone(oldNode)
        }
      }
    }
  }, [
    backend,
    canvasMode,
    componentPackages,
    document,
    editingScope,
    postAuthoringPatch,
    queueAuthoringNodePatch,
    slideEditorView,
  ])

  useEffect(() => {
    gameRef.current?.bridge.selectNodes(needsLayerOverlay ? [] : [...selectedNodeIds])
  }, [selectedNodeIds, needsLayerOverlay])

  useEffect(() => {
    gameRef.current?.bridge.setTextEditing(editingTextNodeId)
    if (!editingTextNodeId && selectedNode?.type === 'text') {
      gameRef.current?.bridge.applyNode(selectedNode)
    }
  }, [editingTextNodeId, selectedNode])

  const nativeTextEditor = useSlideNativeTextEditor({
    readBackend: () => backendRef.current,
    readHost: () => publishedAuthoringHostRef.current,
    readTransform: () => { const viewport = readCandidateViewport(); return viewport ? createStageViewportTransform(viewport) : null },
    apply: command => ports.authoring.applySlideCommand(command),
    report: message => ports.canvas.setStatus(message),
  }, `${snapshot.projectId}:${courseLocationId}:${activePresentationStateId}:${publishedAuthoringOwnerScope}:${canvasMode}`)

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    if (canvasMode !== 'edit') return
    const value = event.dataTransfer.getData(
      'application/x-courseware-element',
    )
    const viewport = stageViewportRef.current
    if (!value || !viewport) return
    const viewportRect = viewport.getBoundingClientRect()
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return
    const transform = createStageViewportTransform({
      viewport: {
        x: viewportRect.left,
        y: viewportRect.top,
        width: viewportRect.width,
        height: viewportRect.height,
      },
      zoom: view.zoom,
      pan: { x: view.x, y: view.y },
    })
    const rect = transform.stageRect
    if (
      event.clientX < rect.x ||
      event.clientX > rect.x + rect.width ||
      event.clientY < rect.y ||
      event.clientY > rect.y + rect.height
    ) {
      return
    }
    const { x, y } = clientToWorld(transform, {
      x: event.clientX,
      y: event.clientY,
    })
    if (value === 'text') ports.content.addTextNode(x, y)
    else if (value === 'formula') ports.content.addFormulaNode(x, y)
    else if (value === 'rectangle') ports.content.addRectangleNode(x, y)
    else if (value === 'table') ports.content.addTableNode(x, y)
    else if (value.startsWith('chart:')) {
      ports.content.addChartNode(
        value.slice('chart:'.length) as 'bar' | 'line' | 'area' | 'pie' | 'donut',
        x,
        y,
      )
    }
    else if (value.startsWith('shape:')) {
      ports.content.addShapeNode(value.slice('shape:'.length), x, y)
    }
    else if (value === 'image') onAddImage(x, y)
    else if (value === 'video') onAddVideo(x, y)
    else if (value.startsWith('component-preset:')) {
      const [encodedPackageId, encodedPresetId] = value
        .slice('component-preset:'.length)
        .split(':', 2)
      if (encodedPackageId && encodedPresetId) {
        ports.content.addExternalComponentNode(
          decodeURIComponent(encodedPackageId),
          x,
          y,
          decodeURIComponent(encodedPresetId),
        )
      }
    }
    else if (value.startsWith('component:')) {
      ports.content.addExternalComponentNode(value.slice('component:'.length), x, y)
    }
  }

  if (!snapshot.projectId || !slideEditorView) {
    return (
      <main
        className="workspace"
        data-testid="slide-workspace-sessionless"
        role="alert"
      >
        <p className="property-hint">{SLIDE_SESSIONLESS_ERROR}</p>
      </main>
    )
  }

  return (
    <main
      ref={workspaceRef}
      className={`workspace workspace--${canvasMode}`}
      aria-label="课件画布"
      style={drawTool ? { cursor: 'crosshair' } : undefined}
      onDragOver={(event) => {
        if (canvasMode !== 'edit') return
        if (
          event.dataTransfer.types.includes(
            'application/x-courseware-element',
          )
        ) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={onDrop}
      onWheel={(event) => {
        if (canvasMode !== 'edit' || (!event.ctrlKey && !event.metaKey)) return
        event.preventDefault()
        setZoom(view.zoom + (event.deltaY < 0 ? 0.1 : -0.1))
      }}
      onPointerDownCapture={(event) => {
        if (
          canvasMode === 'edit' &&
          (event.button === 1 || (event.button === 0 && spacePressedRef.current))
        ) {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          panRef.current = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            originX: view.x,
            originY: view.y,
          }
          setPanning(true)
          return
        }
        if (
          slideBackendKind !== 'slide-authoring' ||
          canvasMode !== 'edit' ||
          event.button !== 0
        ) return
        if (
          event.target instanceof Element &&
          event.target.closest(
            '.canvas-authoring-target, .canvas-plain-text-editor, .text-edit-overlay, .text-edit-toolbar, .formula-edit-dialog, .canvas-mode-switch, .canvas-view-controls',
          )
        ) return
        const currentSnapshot = readSnapshot()
        if (currentSnapshot.editingTextNodeId || currentSnapshot.contentEdit) {
          event.preventDefault()
          event.stopPropagation()
          const editingId = currentSnapshot.editingTextNodeId
          if (editingId) {
            ports.content.commitTextEdit()
            syncCommittedTextNode(editingId)
          }
          return
        }
        const viewport = readCandidateViewport()
        if (!viewport) return
        if (currentSnapshot.drawTool) {
          const transform = createStageViewportTransform(viewport)
          const world = clientToWorld(transform, { x: event.clientX, y: event.clientY })
          const snapped = snapLinePoint(
            world,
            collectLineSnapAxes(listSlideWorkspaceHitTargets(backendRef.current)),
            transform.scale,
            event.altKey,
          )
          drawGestureRef.current = {
            pointerId: event.pointerId,
            shapeType: currentSnapshot.drawTool,
            startWorld: snapped.point,
          }
          setDrawPreview({ points: [snapped.point], guides: snapped.guideX !== undefined || snapped.guideY !== undefined ? { x: snapped.guideX, y: snapped.guideY } : null })
          event.currentTarget.setPointerCapture(event.pointerId)
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (currentSnapshot.editingScope === 'global') {
          const controllerResult = controllerAuthoringRef.current.pointerDown({
            x: event.clientX,
            y: event.clientY,
          }, viewport)
          if (
            controllerResult.kind !== 'v8' &&
            controllerGestureConsumed(
              controllerResult.overlay,
              controllerResult.preview,
              controllerResult.target,
            )
          ) {
            controllerPointerActiveRef.current = true
            if (controllerResult.target) {
              ports.selection.selectNode(controllerResult.target.layerItemId)
            }
            setControllerOverlay(controllerResult.overlay)
            event.currentTarget.setPointerCapture(event.pointerId)
            event.preventDefault()
            event.stopPropagation()
            return
          }
        }
        const result = slideAuthoringRef.current.pointerDown({
          x: event.clientX,
          y: event.clientY,
          additive: event.shiftKey || event.ctrlKey || event.metaKey,
          altKey: event.altKey,
        }, viewport)
        if (result.kind !== 'slide-authoring') return
        candidatePointerActiveRef.current = true
        setLayerOverlay(result.overlay ?? null)
        paintSlideTransformPreview(result.preview)
        if (result.linePreview) paintSlideLinePreview(result.linePreview)
        setLineDragGuides(result.guides ?? null)
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
        event.stopPropagation()
      }}
      onPointerMoveCapture={(event) => {
        const pan = panRef.current
        if (!pan || pan.pointerId !== event.pointerId) {
          const draw = drawGestureRef.current
          if (draw && draw.pointerId === event.pointerId) {
            const viewport = readCandidateViewport()
            if (viewport) {
              const transform = createStageViewportTransform(viewport)
              const world = clientToWorld(transform, { x: event.clientX, y: event.clientY })
              const snapped = snapLinePoint(
                world,
                collectLineSnapAxes(listSlideWorkspaceHitTargets(backendRef.current)),
                transform.scale,
                event.altKey,
              )
              const authored = drawLineAuthoringGeometry(draw.shapeType, draw.startWorld, snapped.point)
              if (authored) {
                const points = resolveNativeLinePoints(
                  authored.lineGeometry,
                  authored.frame.width,
                  authored.frame.height,
                ).map((point) => ({ x: authored.frame.x + point.x, y: authored.frame.y + point.y }))
                setDrawPreview({
                  points,
                  guides: snapped.guideX !== undefined || snapped.guideY !== undefined
                    ? { x: snapped.guideX, y: snapped.guideY }
                    : null,
                })
              } else {
                setDrawPreview({
                  points: [draw.startWorld, snapped.point],
                  guides: snapped.guideX !== undefined || snapped.guideY !== undefined
                    ? { x: snapped.guideX, y: snapped.guideY }
                    : null,
                })
              }
            }
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (
            slideBackendKind === 'slide-authoring' &&
            controllerPointerActiveRef.current
          ) {
            const viewport = readCandidateViewport()
            if (viewport) {
              const controllerResult = controllerAuthoringRef.current.pointerMove({
                x: event.clientX,
                y: event.clientY,
              }, viewport)
              if (controllerResult.kind !== 'v8') {
                setControllerOverlay(controllerResult.overlay)
              }
              event.preventDefault()
              event.stopPropagation()
              return
            }
          }
          if (
            slideBackendKind === 'slide-authoring' &&
            candidatePointerActiveRef.current
          ) {
            const viewport = readCandidateViewport()
            if (viewport) {
              const moved = slideAuthoringRef.current.pointerMove({
                x: event.clientX,
                y: event.clientY,
                altKey: event.altKey,
              }, viewport)
              if (moved.kind === 'slide-authoring') {
                setLayerOverlay(moved.overlay ?? null)
                paintSlideTransformPreview(moved.preview)
                if (moved.linePreview) paintSlideLinePreview(moved.linePreview)
                setLineDragGuides(moved.guides ?? null)
              }
              event.preventDefault()
              event.stopPropagation()
              return
            }
          }
          const hit = canvasAuthoringHitAtClientPoint(event.clientX, event.clientY)
          setHoveredAuthoringTargetId((current) => (
            current === hit?.target.targetId
              ? current
              : hit?.target.targetId ?? null
          ))
          return
        }
        event.preventDefault()
        event.stopPropagation()
        setView((current) => ({
          ...current,
          x: pan.originX + event.clientX - pan.clientX,
          y: pan.originY + event.clientY - pan.clientY,
        }))
      }}
      onPointerUpCapture={(event) => {
        const draw = drawGestureRef.current
        if (draw && draw.pointerId === event.pointerId) {
          drawGestureRef.current = null
          setDrawPreview(null)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          const viewport = readCandidateViewport()
          if (viewport) {
            const transform = createStageViewportTransform(viewport)
            const world = clientToWorld(transform, { x: event.clientX, y: event.clientY })
            const rawDistance = Math.hypot(world.x - draw.startWorld.x, world.y - draw.startWorld.y)
            if (rawDistance >= 3) {
              const snapped = snapLinePoint(
                world,
                collectLineSnapAxes(listSlideWorkspaceHitTargets(backendRef.current)),
                transform.scale,
                event.altKey,
              )
              const authored = drawLineAuthoringGeometry(draw.shapeType, draw.startWorld, snapped.point)
              if (authored) {
                ports.content.drawShapeNode({
                  shapeType: draw.shapeType,
                  frame: authored.frame,
                  lineGeometry: authored.lineGeometry,
                })
              }
            }
          }
          ports.canvas.setDrawTool(null)
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (
          slideBackendKind === 'slide-authoring' &&
          controllerPointerActiveRef.current
        ) {
          const viewport = readCandidateViewport()
          if (viewport) {
            const currentSnapshot = readSnapshot()
            const controllerResult = currentSnapshot.editingScope === 'global'
              ? controllerAuthoringRef.current.pointerUp({
                  x: event.clientX,
                  y: event.clientY,
                }, viewport)
              : controllerAuthoringRef.current.pointerCancel({
                  x: event.clientX,
                  y: event.clientY,
                }, viewport)
            if (controllerResult.kind !== 'v8') {
              setControllerOverlay(
                currentSnapshot.editingScope === 'global'
                  ? controllerResult.overlay
                  : null,
              )
            }
          }
          controllerPointerActiveRef.current = false
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (
          slideBackendKind === 'slide-authoring' &&
          candidatePointerActiveRef.current
        ) {
          const viewport = readCandidateViewport()
          if (viewport) {
            const raised = slideAuthoringRef.current.pointerUp({
              x: event.clientX,
              y: event.clientY,
              altKey: event.altKey,
            }, viewport)
            if (raised.kind === 'slide-authoring') {
              setLayerOverlay(raised.overlay ?? null)
              paintSlideTransformPreview(raised.preview)
              if (raised.linePreview) paintSlideLinePreview(raised.linePreview)
              setLineDragGuides(raised.guides ?? null)
            }
          }
          candidatePointerActiveRef.current = false
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (panRef.current?.pointerId !== event.pointerId) return
        event.preventDefault()
        event.stopPropagation()
        panRef.current = null
        setPanning(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onPointerCancelCapture={(event) => {
        const draw = drawGestureRef.current
        if (draw && draw.pointerId === event.pointerId) {
          drawGestureRef.current = null
          setDrawPreview(null)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (
          slideBackendKind === 'slide-authoring' &&
          candidatePointerActiveRef.current
        ) {
          revertSlideDragPreview()
          const viewport = readCandidateViewport()
          if (viewport) {
            slideAuthoringRef.current.cancelGesture(viewport)
            setLayerOverlay(slideAuthoringRef.current.overlayGeometry(viewport))
          }
          candidatePointerActiveRef.current = false
          setLineDragGuides(null)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (
          slideBackendKind === 'slide-authoring' &&
          controllerPointerActiveRef.current
        ) {
          const viewport = readCandidateViewport()
          if (viewport) {
            controllerAuthoringRef.current.pointerCancel({
              x: event.clientX,
              y: event.clientY,
            }, viewport)
          }
          controllerPointerActiveRef.current = false
          setControllerOverlay(null)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (panRef.current?.pointerId === event.pointerId) {
          panRef.current = null
          setPanning(false)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }
      }}
      onPointerLeave={() => setHoveredAuthoringTargetId(null)}
      onDoubleClickCapture={(event) => {
        if (
          !authoringCanvasInteractive ||
          (event.target instanceof Element &&
            event.target.closest(
              '.canvas-authoring-target, .canvas-plain-text-editor, .text-edit-overlay, .text-edit-toolbar, .formula-edit-dialog',
            ))
        ) {
          return
        }
        if (slideBackendKind === 'slide-authoring') {
          const viewport = readCandidateViewport()
          if (!viewport) return
          const world = clientToWorld(createStageViewportTransform(viewport), {
            x: event.clientX,
            y: event.clientY,
          })
          const layerHit = hitTestV9SlideLayerItems(
            listSlideWorkspaceHitTargets(backendRef.current),
            world,
          )
          if (layerHit) {
            if (layerHit.nativeType === 'table' || layerHit.nativeType === 'chart') {
              ports.selection.selectNode(layerHit.layerItemId)
              if (nativeTextEditor.begin(layerHit.layerItemId, world, {x:event.clientX,y:event.clientY})) {
                event.preventDefault()
                event.stopPropagation()
              }
              return
            }
            if (layerHit.nativeType === 'text' || layerHit.nativeType === 'formula') {
              event.preventDefault()
              event.stopPropagation()
              const currentSnapshot = readSnapshot()
              ports.selection.selectNode(layerHit.layerItemId)
              ports.content.beginTextEdit(layerHit.layerItemId, 'canvas')
              if (layerHit.nativeType === 'formula') {
                setActiveFormulaEditSession({
                  projectId: currentSnapshot.projectId,
                  scope: currentSnapshot.editingScope,
                  sceneId: currentSnapshot.sceneId,
                  stateId: currentSnapshot.presentationStateId,
                  nodeId: layerHit.layerItemId,
                })
              }
              return
            }
          }
        }
        const hit = canvasAuthoringHitAtClientPoint(event.clientX, event.clientY)
        if (!hit) return
        event.preventDefault()
        event.stopPropagation()
        if (hit.kind === 'component') {
          beginComponentTextEdit(hit.target)
        } else if (hit.target.kind === 'text') {
          beginRuntimeTextEdit(hit.target)
        } else {
          void replaceRuntimeAsset(hit.target)
        }
      }}
    >
      <div className="canvas-mode-switch" role="group" aria-label="画布模式">
        <button
          type="button"
          className={canvasMode === 'edit' ? 'canvas-mode-switch__active' : ''}
          aria-pressed={canvasMode === 'edit'}
          onClick={() => ports.canvas.setCanvasMode('edit')}
        >
          <MousePointer2 size={13} />编辑状态
        </button>
        <button
          type="button"
          className={canvasMode === 'run' ? 'canvas-mode-switch__active' : ''}
          aria-pressed={canvasMode === 'run'}
          onClick={() => ports.canvas.setCanvasMode('run')}
        >
          <Play size={13} />当前位置试运行
        </button>
        {useCoursePlayerTryRun ? (
          <div
            role="group"
            aria-label="试运行翻页"
            data-testid="course-try-run-chrome"
            style={{ display: 'flex', gap: 6, marginLeft: 8 }}
          >
            <button
              type="button"
              data-testid="course-try-run-previous"
              onClick={() => void courseTryRunSessionRef.current?.previous()}
            >
              上一页
            </button>
            <button
              type="button"
              data-testid="course-try-run-next"
              onClick={() => void courseTryRunSessionRef.current?.next()}
            >
              下一页
            </button>
          </div>
        ) : null}
      </div>
      {canvasMode === 'edit' && (
        <div className="canvas-view-controls" role="group" aria-label="画布视图">
          <button type="button" aria-label="缩小画布" onClick={() => setZoom(view.zoom - 0.1)}>
            <Minus size={14} />
          </button>
          <output aria-label="画布缩放比例">{Math.round(view.zoom * 100)}%</output>
          <button type="button" aria-label="放大画布" onClick={() => setZoom(view.zoom + 0.1)}>
            <Plus size={14} />
          </button>
          <button type="button" aria-label="适合窗口" title="重置缩放与平移" onClick={resetView}>
            <Maximize2 size={14} />
          </button>
          <span title="Ctrl+滚轮缩放；按住空格或鼠标中键拖动画布">
            <Hand size={13} />
          </span>
        </div>
      )}
      <div className={`canvas-label${editingScope === 'global' ? ' canvas-label--global' : ''}`}>
        1280 × 720 · {editingScope === 'global'
          ? `全局层 · ${slideEditorView?.layers.filter((layer) => layer.source === 'global').length ?? 0} 个元素`
          : `${slideEditorView?.sceneName ?? ''} · ${activePresentationStateId === null
            ? '基础'
            : slideEditorView?.presentation?.states.find((state) => state.active)?.name
              ?? '状态'}`}
      </div>
      <div ref={stageViewportRef} className="canvas-viewport">
        <div
          className="canvas-stage-stack"
          data-panning={panning || undefined}
          style={{
            left: stageTransform.stageRect.x,
            top: stageTransform.stageRect.y,
            width: STAGE_VIEWPORT_WIDTH,
            height: STAGE_VIEWPORT_HEIGHT,
            transform: `scale(${stageTransform.scale})`,
            // Geometry must change atomically: the Player, Phaser hit proxies and
            // authoring targets all consume this transform in the same frame.
            transition: 'none',
          }}
        >
          {usePublishedAuthoring && (
            <div
              ref={publishedAuthoringHostRef}
              className="runtime-preview-frame published-authoring-host"
              data-testid="published-authoring-host"
              title="统一编辑画布"
              inert
              aria-hidden="true"
            />
          )}
          <div
            ref={gameHostRef}
            className="canvas-stage canvas-stage--authoring"
            data-testid="canvas-stage"
            aria-hidden={canvasMode === 'run'}
            style={useCoursePlayerTryRun ? { pointerEvents: 'none' } : undefined}
          />
          <SlideDynamicAuthoringOverlay
            interactive={authoringCanvasInteractive}
            runtimeTargets={visibleRuntimeTargets}
            componentTargets={visibleComponentTargets}
            hoveredTargetId={hoveredAuthoringTargetId}
            replacingRuntimeAssetTargetId={replacingRuntimeAssetTargetId}
            activeRuntimeTextSession={activeRuntimeTextSession}
            activeRuntimeTextTarget={activeRuntimeTextTarget}
            activeRuntimeTextValue={activeRuntimeTextValue}
            activeComponentTextSession={activeComponentTextSession}
            activeComponentTextTarget={activeComponentTextTarget}
            componentEditingReady={Boolean(componentEditingLayer)}
            componentEditingValue={componentEditingValue}
            previewFeedback={useCoursePlayerTryRun ? null : previewFeedback}
            showPreparing={!useCoursePlayerTryRun && !usePublishedAuthoring}
            onHoverTarget={setHoveredAuthoringTargetId}
            onRuntimeTargetActivate={(target) => {
              if (target.kind === 'text') beginRuntimeTextEdit(target)
              else {
                setActiveComponentTextSession(null)
                void replaceRuntimeAsset(target)
              }
            }}
            onComponentTargetActivate={beginComponentTextEdit}
            onCommitRuntimeText={commitRuntimeText}
            onCancelRuntimeText={() => setActiveRuntimeTextSession(null)}
            onCommitComponentText={commitComponentText}
            onCancelComponentText={() => setActiveComponentTextSession(null)}
            onRetryPreview={retryRuntimePreview}
          />
          {nativeTextEditor.editor}
          {(drawPreview || lineDragGuides) && (
            <svg
              className="canvas-line-overlay"
              data-testid="canvas-line-overlay"
              viewBox={`0 0 ${STAGE_VIEWPORT_WIDTH} ${STAGE_VIEWPORT_HEIGHT}`}
              width={STAGE_VIEWPORT_WIDTH}
              height={STAGE_VIEWPORT_HEIGHT}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                pointerEvents: 'none',
                overflow: 'visible',
              }}
            >
              {(lineDragGuides?.x ?? drawPreview?.guides?.x) !== undefined && (
                <line
                  x1={lineDragGuides?.x ?? drawPreview?.guides?.x ?? 0}
                  y1={0}
                  x2={lineDragGuides?.x ?? drawPreview?.guides?.x ?? 0}
                  y2={STAGE_VIEWPORT_HEIGHT}
                  stroke="#ff4d9d"
                  strokeWidth={1}
                />
              )}
              {(lineDragGuides?.y ?? drawPreview?.guides?.y) !== undefined && (
                <line
                  x1={0}
                  y1={lineDragGuides?.y ?? drawPreview?.guides?.y ?? 0}
                  x2={STAGE_VIEWPORT_WIDTH}
                  y2={lineDragGuides?.y ?? drawPreview?.guides?.y ?? 0}
                  stroke="#ff4d9d"
                  strokeWidth={1}
                />
              )}
              {drawPreview && drawPreview.points.length >= 2 && (
                <polyline
                  points={drawPreview.points.map((point) => `${point.x},${point.y}`).join(' ')}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              )}
            </svg>
          )}
        </div>
        <div
          ref={courseTryRunRef}
          className="course-try-run-host"
          data-testid="course-try-run-host"
          hidden={!useCoursePlayerTryRun}
        />
        {tryRunFeedback && useCoursePlayerTryRun ? (
          <div
            className={`runtime-preview-loading runtime-preview-loading--${tryRunFeedback.kind} course-try-run-feedback`}
            role={tryRunFeedback.kind === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            <div className="runtime-preview-loading__panel">
              {tryRunFeedback.kind === 'loading' && (
                <LoaderCircle
                  className="runtime-preview-loading__spinner"
                  size={24}
                  aria-hidden="true"
                />
              )}
              <strong>{tryRunFeedback.title}</strong>
              <span>{tryRunFeedback.message}</span>
            </div>
          </div>
        ) : null}
      </div>
      {canvasMode === 'edit' && editingScope === 'global' && controllerOverlay ? (
        <TeacherControllerAuthoringOverlay overlay={controllerOverlay} />
      ) : null}
      {canvasMode === 'edit' && needsLayerOverlay && layerOverlay ? <SlideLayerSelectionOverlay overlay={layerOverlay} /> : null}
      {canvasMode === 'edit' && editingFormulaNode && (
        <FormulaEditDialog
          key={`${editingFormulaNode.id}:${activePresentationStateId ?? 'base'}`}
          node={editingFormulaNode}
          onCancel={() => setActiveFormulaEditSession(null)}
          onCommit={(ast, accessibleText) => {
            const currentSnapshot = readSnapshot()
            const backend = currentSnapshot.backend
            if (backend && currentSnapshot.contentEdit?.kind === 'formula') {
              const edited = updateV9SlideContentFormulaDraft(currentSnapshot.contentEdit, {
                ast,
                accessibleText,
              })
              ports.authoring.applySlideCommand(
                (session) => commitV9SlideContentEdit(session, edited),
                { clearContentEdit: true },
              )
            }
            setActiveFormulaEditSession(null)
          }}
        />
      )}
      {canvasMode === 'edit' && editingNode && workspaceRef.current && (gameHostRef.current || canvas) && (
        <TextEditOverlay
          key={editingNode.id}
          node={editingNode}
          workspace={workspaceRef.current}
          canvas={gameHostRef.current ?? canvas!}
          onPreview={(text, runs) => {
            const draftNode = { ...editingNode, text, runs }
            const rendered = editingNode.style.overflow === 'auto-height'
              ? renderTextNodeCanvas(draftNode)
              : null
            ports.content.updateTextEditDraft(
              editingNode.id,
              text,
              runs,
              rendered?.height ?? editingNode.height,
              rendered?.width ?? editingNode.width,
            )
          }}
          onCompositionChange={ports.content.setTextEditComposing}
          onCommit={(text, runs) => {
            const draftNode = { ...editingNode, text, runs }
            const rendered = editingNode.style.overflow === 'auto-height'
              ? renderTextNodeCanvas(draftNode)
              : null
            ports.content.updateTextEditDraft(
              editingNode.id,
              text,
              runs,
              rendered?.height ?? editingNode.height,
              rendered?.width ?? editingNode.width,
            )
            ports.content.commitTextEdit()
            syncCommittedTextNode(editingNode.id)
          }}
          onCancel={() => {
            ports.content.cancelTextEdit()
            syncCommittedTextNode(editingNode.id)
          }}
        />
      )}
    </main>
  )
}
