import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { RuntimeLayerItem } from '../../../shared/courseProjectTypes'
import type { RuntimeAuthoringTargetUpdate } from '../../../shared/runtimeTypes'
import {
  createPublishedSurfaceRuntimeSession,
  mountPublishedSurfaceRuntime,
  type PublishedSurfaceRuntimeMountHandle,
} from '../../../player/surfaces/runtime/publishedSurfaceRuntimeMount'
import type { DeepReadonly } from '../../course/flowEditorView'
import { projectFlowRuntimeForAuthoring } from '../../document/flowRuntimeSpaceProjection'
import { retainAssetObjectUrls } from '../useAssetObjectUrls'

export interface FlowPageRuntimeProps {
  readonly item: DeepReadonly<RuntimeLayerItem>
  readonly surfaceId: string
  /** Stable document/session owner identity; changing it retires the previous target publisher. */
  readonly ownerKey?: string
  readonly width: number
  /** Derived paper-space slot height. It is never persisted or added to History. */
  readonly height: number
  readonly assetUrls: Readonly<Record<string, string>>
  readonly onHeightChange: (height: number) => void
  readonly onTargetsChanged?: (update: Readonly<RuntimeAuthoringTargetUpdate>) => void
  readonly onError?: (phase: 'register' | 'create' | 'lifecycle' | 'destroy', error: Error) => void
  readonly style?: CSSProperties
}

/** Runs one Flow paper Runtime in the actual API 3 host while editing. */
export function FlowPageRuntime({ item, surfaceId, ownerKey = surfaceId, width, height, assetUrls, onHeightChange, onTargetsChanged, onError, style }: FlowPageRuntimeProps) {
  const container = useRef<HTMLDivElement>(null)
  const handle = useRef<PublishedSurfaceRuntimeMountHandle | null>(null)
  const callbacks = useRef({ onHeightChange, onError, assetUrls })
  callbacks.current = { onHeightChange, onError, assetUrls }
  const targetOwners = useRef(new Map<string, FlowPageRuntimeProps['onTargetsChanged']>())
  targetOwners.current.set(ownerKey, onTargetsChanged)
  const currentOwnerKey = useRef(ownerKey)
  currentOwnerKey.current = ownerKey
  const assetBaseline = useRef<Map<string, string | null> | null>(null)
  const [assetEpoch, setAssetEpoch] = useState(0)

  // API 3 snapshots content.get/all() at create. Value/key or binding changes require
  // a new host; DOM text override rules can be updated on the existing instance.
  const sourceKey = JSON.stringify([
    item.runtime.source, item.runtime.protocol, item.runtime.runtimeApiVersion,
    item.runtime.enabled, item.runtime.renderMode,
    item.runtime.content.values, item.runtime.content.metadata,
    item.runtime.assets, item.runtime.nodeBindings, item.runtime.staticFallback,
  ])
  const overrideKey = JSON.stringify(item.runtime.content.overrides ?? [])
  const runtime = useMemo(() => projectFlowRuntimeForAuthoring(item), [sourceKey, overrideKey])

  useEffect(() => {
    const target = container.current
    if (!target || !item.runtime.enabled || item.runtime.protocol !== 'surface-runtime'
      || item.runtime.runtimeApiVersion !== 3 || item.runtime.renderMode !== 'dom') return
    const session = createPublishedSurfaceRuntimeSession()
    const releaseUrls = retainAssetObjectUrls(assetUrls)
    // Route through this mount's owner key. Same-owner callback refreshes are safe,
    // while a replaced owner still receives its own target cleanup.
    const targetsOwner = (update: Readonly<RuntimeAuthoringTargetUpdate>) =>
      targetOwners.current.get(ownerKey)?.(update)
    const baseline = new Map<string, string | null>(
      Object.values(item.runtime.assets).map(binding => [binding.assetId, assetUrls[binding.assetId] ?? null]),
    )
    assetBaseline.current = baseline
    let active = true
    let targetRevision = 0
    const mounted = mountPublishedSurfaceRuntime(target, {
      instanceId: item.layerItemId,
      runtime,
      width,
      height,
      visible: true,
      mode: 'authoring',
      session,
      resolveAsset: assetId => {
        const url = callbacks.current.assetUrls[assetId]
        baseline.set(assetId, url ?? null)
        return url
      },
      authoring: {
        scope: 'scene',
        sceneId: surfaceId,
        onTargetsChanged: update => {
          if (!active) return
          targetRevision = Math.max(targetRevision, update.revision)
          targetsOwner?.(update)
        },
      },
      onContentHeightChange: (measured: number) => {
        if (active) callbacks.current.onHeightChange(measured)
      },
      reportError: (phase, error) => {
        if (active) callbacks.current.onError?.(phase, error)
      },
    })
    handle.current = mounted
    return () => {
      active = false
      if (handle.current === mounted) handle.current = null
      mounted.destroy()
      session.destroy()
      releaseUrls()
      if (assetBaseline.current === baseline) assetBaseline.current = null
      targetsOwner({ scope: 'scene', sceneId: surfaceId, revision: targetRevision + 1, targets: [] })
      if (ownerKey !== currentOwnerKey.current) targetOwners.current.delete(ownerKey)
    }
  }, [item.layerItemId, item.runtime.enabled, item.runtime.protocol, item.runtime.runtimeApiVersion, item.runtime.renderMode, sourceKey, surfaceId, ownerKey, assetEpoch])

  // IDs learned from projectUrl() join this mount's baseline when first read. Their
  // appearance alone cannot remount; only a subsequently changed URL can.
  useEffect(() => {
    const baseline = assetBaseline.current
    if (baseline && [...baseline].some(([id, url]) => url !== (assetUrls[id] ?? null))) {
      setAssetEpoch(epoch => epoch + 1)
    }
  }, [assetUrls])

  useEffect(() => {
    handle.current?.applyAuthoringTextOverrides(item.runtime.content.overrides ?? [])
  }, [overrideKey, sourceKey, ownerKey, assetEpoch])

  useEffect(() => {
    handle.current?.updateSize(width, height)
  }, [width, height, sourceKey, ownerKey, assetEpoch])

  return <div ref={container} data-testid="flow-page-runtime" data-runtime-instance-id={item.layerItemId}
    style={{ width: '100%', height: '100%', minHeight: 0, ...style }} />
}
