import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { PublishedGlobalCanvasRuntimeOwner } from '../../../../player/surfaces/runtime/publishedGlobalCanvasRuntimeOwner'
import { createPublishedAuthoringReadonlyState } from '../../../../player/surfaces/publishedDynamicHosts'
import type { ComponentPackageData } from '../../../../shared/componentTypes'
import type { CourseProjectDocument } from '../../../../shared/courseProjectTypes'
import type {
  PublishedCourseV2Payload,
} from '../../../../shared/publishedCourseTypes'
import type { RuntimeAuthoringTarget } from '../../../../shared/runtimeTypes'
import {
  beginRuntimeTargetEditSession,
  validateRuntimeTargetEditSession,
  type RuntimeTargetEditContext,
  type RuntimeTargetEditSession,
} from '../../../authoring/runtimeTargetEditSession'
import type { DeepReadonly, SpatialEditorLayerView } from '../../../course/spatialEditorView'
import type { RuntimeContentTextAuthoringCommitResult } from '../../../runtime/commitRuntimeAuthoring'
import type { CourseRuntimeContentTextTarget } from '../../../runtime/runtimeContentTextAuthoringCommands'
import { buildPublishedCourseTryRunPayload } from '../../coursePlayerTryRun'
import { CanvasPlainTextEditor } from '../../CanvasPlainTextEditor'

export interface SpatialRuntimeContentAuthoringPort {
  readonly captureRuntimeContentTextTarget: (
    session: Readonly<RuntimeTargetEditSession>,
  ) => CourseRuntimeContentTextTarget | null
  readonly updateRuntimeContentTextAtTarget: (
    target: CourseRuntimeContentTextTarget,
    value: string,
  ) => RuntimeContentTextAuthoringCommitResult
}

interface SpatialRuntimeTextEditSession {
  readonly liveSession: Readonly<RuntimeTargetEditSession>
  readonly courseTarget: CourseRuntimeContentTextTarget
}

interface SpatialGlobalRuntimeMountContextValue {
  register(itemId: string, target: HTMLElement | null): void
}

const SpatialGlobalRuntimeMountContext =
  createContext<SpatialGlobalRuntimeMountContextValue | null>(null)

function executableGlobalCanvasRuntime(
  layer: DeepReadonly<SpatialEditorLayerView>,
): boolean {
  return layer.source === 'global'
    && layer.item.kind === 'runtime'
    && layer.item.runtime.enabled
    && layer.item.runtime.protocol === 'canvas-runtime'
    && layer.item.runtime.runtimeApiVersion === 2
}

export function isSpatialGlobalCanvasRuntimeLayer(
  layer: DeepReadonly<SpatialEditorLayerView>,
): boolean {
  return executableGlobalCanvasRuntime(layer)
}

function globalRuntimeGenerationKey(payload: PublishedCourseV2Payload): string {
  return JSON.stringify({
    courseState: payload.courseState,
    runtimes: payload.globalLayerItems.flatMap((entry) => {
      if (
        entry.item.kind !== 'runtime'
        || !entry.item.runtime.enabled
        || entry.item.runtime.protocol !== 'canvas-runtime'
        || entry.item.runtime.runtimeApiVersion !== 2
      ) return []
      const runtime = structuredClone(entry.item.runtime)
      const contentKeys = Object.keys(runtime.content.values).sort()
      runtime.content.values = Object.fromEntries(contentKeys.map((key) => [key, '']))
      return [{
        itemId: entry.item.layerItemId,
        frame: entry.item.frame,
        rotation: entry.item.rotation,
        runtime,
      }]
    }),
  })
}

function contentValuesByItem(
  payload: PublishedCourseV2Payload,
): ReadonlyMap<string, Readonly<Record<string, string>>> {
  return new Map(payload.globalLayerItems.flatMap((entry) => (
    entry.item.kind === 'runtime'
      && entry.item.runtime.enabled
      && entry.item.runtime.protocol === 'canvas-runtime'
      && entry.item.runtime.runtimeApiVersion === 2
      ? [[entry.item.layerItemId, { ...entry.item.runtime.content.values }] as const]
      : []
  )))
}

function sanitizeTargets(
  targets: readonly Readonly<RuntimeAuthoringTarget>[],
  layers: readonly DeepReadonly<SpatialEditorLayerView>[],
): readonly Readonly<RuntimeAuthoringTarget>[] {
  const editableIds = new Set(layers.flatMap((layer) => (
    executableGlobalCanvasRuntime(layer)
      && layer.effectiveVisible
      && !layer.locked
      ? [layer.selectionId]
      : []
  )))
  const result: RuntimeAuthoringTarget[] = []
  for (const target of targets) {
    if (
      target.scope !== 'global'
      || target.sceneId !== undefined
      || target.kind !== 'text'
      || target.layer !== 'underlay' && target.layer !== 'overlay'
      || target.source !== 'registered' && target.source !== 'dom'
      || typeof target.nodeId !== 'string'
      || !editableIds.has(target.nodeId)
      || typeof target.targetId !== 'string'
      || !target.targetId
      || typeof target.key !== 'string'
      || !target.key
    ) continue
    const { x, y, width, height } = target.bounds
    if (![x, y, width, height].every(Number.isFinite)) continue
    const left = Math.max(0, x)
    const top = Math.max(0, y)
    const right = Math.min(1280, x + width)
    const bottom = Math.min(720, y + height)
    if (right <= left || bottom <= top) continue
    result.push(Object.freeze({
      ...target,
      targetId: `${target.nodeId}:${target.targetId}`,
      ...(typeof target.label === 'string'
        ? { label: target.label.slice(0, 120) }
        : { label: undefined }),
      bounds: Object.freeze({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      }),
    }))
  }
  return Object.freeze(result)
}

export interface SpatialGlobalRuntimeAuthoringProps {
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly surfaceId: string
  readonly scope: 'global' | 'surface' | 'world'
  readonly layers: readonly DeepReadonly<SpatialEditorLayerView>[]
  readonly assetFiles: Readonly<Record<string, Uint8Array>>
  readonly componentPackages: Readonly<Record<string, ComponentPackageData>>
  readonly content: SpatialRuntimeContentAuthoringPort
  readonly children: ReactNode
}

export function SpatialGlobalRuntimeAuthoring({
  project,
  locationId,
  surfaceId,
  scope,
  layers,
  assetFiles,
  componentPackages,
  content,
  children,
}: SpatialGlobalRuntimeAuthoringProps) {
  const targetsByItemRef = useRef(new Map<string, HTMLElement>())
  const ownerRef = useRef<PublishedGlobalCanvasRuntimeOwner | null>(null)
  const valuesRef = useRef<ReadonlyMap<string, Readonly<Record<string, string>>>>(new Map())
  const rawTargetsRef = useRef<readonly Readonly<RuntimeAuthoringTarget>[]>([])
  const targetsRef = useRef<readonly Readonly<RuntimeAuthoringTarget>[]>([])
  const [targets, setTargets] = useState<readonly Readonly<RuntimeAuthoringTarget>[]>([])
  const [activeEdit, setActiveEdit] = useState<SpatialRuntimeTextEditSession | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const payload = useMemo(() => buildPublishedCourseTryRunPayload({
    project,
    assetFiles,
    components: componentPackages,
  }), [assetFiles, componentPackages, project])
  const mountGeneration = useMemo(
    () => `${project.id}:${surfaceId}:${globalRuntimeGenerationKey(payload)}`,
    [payload, project.id, surfaceId],
  )
  const layersRef = useRef(layers)
  layersRef.current = layers

  const register = useCallback((itemId: string, target: HTMLElement | null) => {
    if (target) targetsByItemRef.current.set(itemId, target)
    else targetsByItemRef.current.delete(itemId)
    const owner = ownerRef.current
    if (owner) {
      queueMicrotask(() => {
        if (ownerRef.current === owner) owner.moveTo(surfaceId)
      })
    }
  }, [surfaceId])
  const mountContext = useMemo<SpatialGlobalRuntimeMountContextValue>(
    () => ({ register }),
    [register],
  )

  useLayoutEffect(() => {
    const document = targetsByItemRef.current.values().next().value?.ownerDocument
    if (!document || targetsByItemRef.current.size === 0) return
    // The workspace recreates and revokes all preview blob URLs whenever its
    // sidecar object changes. Runtime instances keep this resolver for their
    // lifetime, so use canonical Published data URLs that remain valid across
    // unrelated resource transactions. A changed Runtime asset binding is
    // already part of mountGeneration and refreshes the owner.
    const resolveAsset = (assetId: string) => payload.assets[assetId]?.url
    const readonlyState = createPublishedAuthoringReadonlyState(payload, resolveAsset)
    const owner = new PublishedGlobalCanvasRuntimeOwner({
      payload,
      hosts: [{
        id: surfaceId,
        getPublishedGlobalRuntimeMountTarget: (itemId) => (
          targetsByItemRef.current.get(itemId) ?? null
        ),
      }],
      services: readonlyState.services,
      resolveAsset,
      authoring: {
        courseState: readonlyState.courseState,
        onTargetsChanged: (update) => {
          rawTargetsRef.current = update.targets
          const next = sanitizeTargets(update.targets, layersRef.current)
          targetsRef.current = next
          setTargets(next)
        },
      },
      courseState: readonlyState.courseState,
    })
    ownerRef.current = owner
    valuesRef.current = contentValuesByItem(payload)
    rawTargetsRef.current = []
    targetsRef.current = []
    setTargets([])
    setActiveEdit(null)
    setLocalError(null)
    owner.mount(document)
    owner.moveTo(surfaceId)
    return () => {
      if (ownerRef.current === owner) ownerRef.current = null
      owner.destroy()
      rawTargetsRef.current = []
      targetsRef.current = []
    }
  // Content-only edits intentionally keep this owner generation alive.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountGeneration])

  useEffect(() => {
    const nextValues = contentValuesByItem(payload)
    const previousValues = valuesRef.current
    valuesRef.current = nextValues
    const owner = ownerRef.current
    if (!owner) return
    for (const [itemId, values] of nextValues) {
      const previous = previousValues.get(itemId)
      if (!previous) continue
      for (const [key, value] of Object.entries(values)) {
        if (previous[key] === value) continue
        void owner.applyAuthoringContentValue(itemId, key, value)
      }
    }
  }, [payload])

  useEffect(() => {
    const next = sanitizeTargets(rawTargetsRef.current, layers)
    targetsRef.current = next
    setTargets(next)
  }, [layers])

  const currentEditContext = useCallback((): RuntimeTargetEditContext => ({
    projectId: project.id,
    scope: 'global',
    // Global targets ignore scene identity, but the edit session still needs a
    // stable active-context discriminator. Spatial uses its location identity.
    sceneId: locationId,
    stateId: null,
    targets: targetsRef.current,
  }), [locationId, project.id])

  const beginTextEdit = useCallback((target: Readonly<RuntimeAuthoringTarget>) => {
    const begun = beginRuntimeTargetEditSession(target, currentEditContext())
    if (!begun.ok) {
      setLocalError('运行时文字目标已失效，请重新选择')
      setActiveEdit(null)
      return
    }
    const courseTarget = content.captureRuntimeContentTextTarget(begun.session)
    if (!courseTarget) {
      setLocalError('运行时文字目标没有可提交的全局 V9 作者地址，或当前 Runtime 已锁定')
      setActiveEdit(null)
      return
    }
    setLocalError(null)
    setActiveEdit(Object.freeze({ liveSession: begun.session, courseTarget }))
  }, [content, currentEditContext])

  const commitTextEdit = useCallback((
    session: Readonly<SpatialRuntimeTextEditSession>,
    value: string,
  ) => {
    const live = validateRuntimeTargetEditSession(session.liveSession, currentEditContext())
    if (!live.ok) {
      setLocalError('运行时文字目标已失效，未写入修改')
      setActiveEdit(null)
      return
    }
    const committed = content.updateRuntimeContentTextAtTarget(session.courseTarget, value)
    if (!committed.ok) setLocalError(`${committed.reason} 未写入修改`)
    else setLocalError(null)
    setActiveEdit(null)
  }, [content, currentEditContext])

  const activeTarget = activeEdit
    ? targets.find((target) => (
        target.targetId === activeEdit.liveSession.targetId
        && target.nodeId === activeEdit.liveSession.nodeId
        && target.key === activeEdit.liveSession.key
      ))
    : undefined

  useEffect(() => {
    if (scope !== 'global' || activeEdit && !activeTarget) setActiveEdit(null)
  }, [activeEdit, activeTarget, scope])

  return (
    <SpatialGlobalRuntimeMountContext.Provider value={mountContext}>
      {children}
      {scope === 'global' && targets.length > 0 ? (
        <div
          className="canvas-authoring-targets"
          data-testid="spatial-runtime-authoring-targets"
          aria-label="Spatial 全局 Runtime 可编辑内容"
        >
          {targets.map((target) => (
            <button
              key={target.targetId}
              type="button"
              className="canvas-authoring-target canvas-authoring-target--text"
              aria-label={`${target.label ?? target.key}，双击编辑文字`}
              title={`双击编辑文字：${target.label ?? target.key}`}
              style={{
                left: target.bounds.x,
                top: target.bounds.y,
                width: target.bounds.width,
                height: target.bounds.height,
                zIndex: target.layer === 'overlay' ? 2 : 1,
                pointerEvents: 'auto',
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => {
                event.stopPropagation()
                beginTextEdit(target)
              }}
            >
              <span className="canvas-authoring-target__badge" aria-hidden="true">
                T<span>{target.label ?? target.key}</span>
              </span>
            </button>
          ))}
          {activeEdit && activeTarget?.kind === 'text' ? (
            <CanvasPlainTextEditor
              key={activeTarget.targetId}
              bounds={activeTarget.bounds}
              label={activeTarget.label ?? activeTarget.key}
              value={activeEdit.courseTarget.initialValue}
              multiline={activeTarget.multiline}
              maxLength={activeTarget.maxLength}
              onCommit={(value) => commitTextEdit(activeEdit, value)}
              onCancel={() => setActiveEdit(null)}
            />
          ) : null}
        </div>
      ) : null}
      {localError ? (
        <div className="property-hint" role="alert" data-testid="spatial-runtime-authoring-error">
          {localError}
        </div>
      ) : null}
    </SpatialGlobalRuntimeMountContext.Provider>
  )
}

export function SpatialGlobalRuntimeMountTarget({ itemId }: { readonly itemId: string }) {
  const context = useContext(SpatialGlobalRuntimeMountContext)
  const ref = useCallback((target: HTMLDivElement | null) => {
    context?.register(itemId, target)
  }, [context, itemId])
  return (
    <div
      ref={ref}
      data-spatial-global-runtime-mount={itemId}
      data-layer-source="global"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    />
  )
}
