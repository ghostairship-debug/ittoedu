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

  // A changed source or binding retires the old host. Geometry changes use updateSize instead.
  const sourceKey = JSON.stringify([
    item.runtime.source, item.runtime.protocol, item.runtime.runtimeApiVersion,
    item.runtime.enabled, item.runtime.renderMode, item.runtime.content,
    item.runtime.assets, item.runtime.nodeBindings, item.runtime.staticFallback,
  ])
  const runtime = useMemo(() => projectFlowRuntimeForAuthoring(item), [sourceKey])

  useEffect(() => {
    const target = container.current
    if (!target || !item.runtime.enabled || item.runtime.protocol !== 'surface-runtime'
      || item.runtime.runtimeApiVersion !== 3 || item.runtime.renderMode !== 'dom') return
    const session = createPublishedSurfaceRuntimeSession()
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
      resolveAsset: assetId => callbacks.current.assetUrls[assetId],
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
      callbacks.current.onTargetsChanged?.({ scope: 'scene', sceneId: surfaceId, revision: targetRevision + 1, targets: [] })
    }
  }, [item.layerItemId, item.runtime.enabled, item.runtime.protocol, item.runtime.runtimeApiVersion, item.runtime.renderMode, runtime, surfaceId])

  useEffect(() => {
    handle.current?.updateSize(width, height)
  }, [width, height, runtime])

  return <div ref={container} data-testid="flow-page-runtime" data-runtime-instance-id={item.layerItemId}
    style={{ width: '100%', height: '100%', minHeight: 0, ...style }} />
}
