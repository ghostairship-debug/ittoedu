import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
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
export function FlowPageRuntime({ item, surfaceId, width, height, assetUrls, onHeightChange, onTargetsChanged, onError, style }: FlowPageRuntimeProps) {
  const container = useRef<HTMLDivElement>(null)
  const handle = useRef<PublishedSurfaceRuntimeMountHandle | null>(null)
  const callbacks = useRef({ onHeightChange, onTargetsChanged, onError, assetUrls })
  callbacks.current = { onHeightChange, onTargetsChanged, onError, assetUrls }
  const requestedAssetIds = useRef(new Set<string>())
  const relevantAssetIds = new Set([
    ...Object.values(item.runtime.assets).map(binding => binding.assetId),
    ...requestedAssetIds.current,
  ])
  // Managed URLs arrive after the first render and may rotate when project bytes change.
  // Recreate only hosts whose own asset references changed, including projectUrl() reads.
  const assetSignature = JSON.stringify([...relevantAssetIds].sort().map(id => [id, assetUrls[id] ?? null]))

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
        requestedAssetIds.current.add(assetId)
        return callbacks.current.assetUrls[assetId]
      },
      authoring: {
        scope: 'scene',
        sceneId: surfaceId,
        onTargetsChanged: update => {
          if (!active) return
          targetRevision = Math.max(targetRevision, update.revision)
          callbacks.current.onTargetsChanged?.(update)
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
      callbacks.current.onTargetsChanged?.({ scope: 'scene', sceneId: surfaceId, revision: targetRevision + 1, targets: [] })
    }
  }, [item.layerItemId, item.runtime.enabled, item.runtime.protocol, item.runtime.runtimeApiVersion, item.runtime.renderMode, sourceKey, surfaceId, assetSignature])

  useEffect(() => {
    handle.current?.applyAuthoringTextOverrides(item.runtime.content.overrides ?? [])
  }, [overrideKey, sourceKey, assetSignature])

  useEffect(() => {
    handle.current?.updateSize(width, height)
  }, [width, height, sourceKey, assetSignature])

  return <div ref={container} data-testid="flow-page-runtime" data-runtime-instance-id={item.layerItemId}
    style={{ width: '100%', height: '100%', minHeight: 0, ...style }} />
}
