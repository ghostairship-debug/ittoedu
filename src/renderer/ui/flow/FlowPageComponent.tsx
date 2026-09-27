import { useEffect, useRef, type CSSProperties } from 'react'
import type { ComponentPackageData, ComponentAuthoringTargetUpdate, ComponentScope } from '../../../shared/componentTypes'
import type { LightEditTextOverride } from '../../../shared/contracts/runtime/lightEdit'
import {
  componentLightEditOptions,
  findComponentPackageSource,
  mountPublishedComponent,
  type PublishedComponentMountHandle,
} from '../../../player/surfaces/publishedComponentMount'

export interface FlowPageComponentItem {
  readonly component: { readonly packageId: string; readonly version: string }
  readonly props: Readonly<Record<string, unknown>>
  readonly staticFallbackAssetId?: string
  readonly textOverrides?: readonly LightEditTextOverride[]
  readonly assetOverrides?: Readonly<Record<string, { readonly assetId: string }>>
}

export interface FlowPageComponentProps {
  readonly item: FlowPageComponentItem
  readonly nodeId: string
  readonly projectId: string
  readonly surfaceId: string
  /** Changing the document/session owner retires the old target publisher. */
  readonly ownerKey: string
  readonly scope: ComponentScope
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rotation?: number
  readonly visible?: boolean
  readonly componentPackages?: Readonly<Record<string, ComponentPackageData>>
  readonly assetUrls: Readonly<Record<string, string>>
  readonly onTargetsChanged?: (update: Readonly<ComponentAuthoringTargetUpdate>) => void
  readonly onError?: (phase: 'register' | 'create' | 'lifecycle' | 'destroy', error: Error) => void
  readonly style?: CSSProperties
}

/** One mounted Flow Component, shared by paper blocks and free page layers. */
export function FlowPageComponent({ item, nodeId, projectId, surfaceId, ownerKey, scope, x, y, width, height, rotation = 0, visible = true, componentPackages, assetUrls, onTargetsChanged, onError, style }: FlowPageComponentProps) {
  const container = useRef<HTMLDivElement>(null)
  const handle = useRef<PublishedComponentMountHandle | null>(null)
  const currentOwner = useRef(ownerKey)
  currentOwner.current = ownerKey
  const targetOwners = useRef(new Map<string, FlowPageComponentProps['onTargetsChanged']>())
  targetOwners.current.set(ownerKey, onTargetsChanged)
  const latest = useRef({ onError, assetUrls })
  latest.current = { onError, assetUrls }
  const pkg = findComponentPackageSource(componentPackages, item.component.packageId, item.component.version)
  const propsKey = JSON.stringify(item.props)
  const textKey = JSON.stringify(item.textOverrides ?? [])
  const assetsKey = JSON.stringify(item.assetOverrides ?? {})
  const urlKey = JSON.stringify(Object.entries(assetUrls).sort(([a], [b]) => a.localeCompare(b)))
  const sourceKey = JSON.stringify([item.component.packageId, item.component.version, nodeId, projectId, surfaceId, scope, assetsKey, urlKey])

  useEffect(() => {
    const el = container.current
    if (!el || !pkg) return
    let active = true
    let revision = 0
    const publish = (update: Readonly<ComponentAuthoringTargetUpdate>) => targetOwners.current.get(ownerKey)?.(update)
    const mounted = mountPublishedComponent(el, {
      projectId, container: el, componentId: item.component.packageId,
      version: item.component.version, instanceId: nodeId,
      width, height, props: { ...item.props },
      staticFallbackAssetId: item.staticFallbackAssetId,
      components: componentPackages,
      resolveAsset: id => latest.current.assetUrls[id],
      mode: 'edit', scope, sceneId: surfaceId, interactive: false,
      ...componentLightEditOptions({
        textOverrides: item.textOverrides,
        assetOverrides: item.assetOverrides as Readonly<Record<string, { assetId: string }>> | undefined,
      }),
      authoring: {
        node: { id: nodeId, component: { ...item.component }, x, y, width, height, rotation, visible, props: { ...item.props } },
        onTargetsChanged: update => {
          if (!active) return
          revision = Math.max(revision, update.revision)
          publish(update)
        },
      },
      reportError: (phase, error) => { if (active) latest.current.onError?.(phase, error) },
    })
    handle.current = mounted
    return () => {
      active = false
      if (handle.current === mounted) handle.current = null
      mounted.destroy()
      publish({ scope, sceneId: surfaceId, nodeId, revision: revision + 1, targets: [] })
      if (ownerKey !== currentOwner.current) targetOwners.current.delete(ownerKey)
    }
  }, [sourceKey, pkg, componentPackages, ownerKey, item.staticFallbackAssetId])

  useEffect(() => {
    handle.current?.updateProps({ ...item.props })
    handle.current?.updateAuthoringNode({ id: nodeId, component: { ...item.component }, x, y, width, height, rotation, visible, props: { ...item.props } })
  }, [sourceKey, propsKey, x, y, width, height, rotation, visible])

  useEffect(() => { handle.current?.resize(width, height) }, [sourceKey, width, height])
  useEffect(() => { handle.current?.setTextOverrides?.(item.textOverrides ?? []) }, [sourceKey, textKey])

  const fallbackUrl = item.staticFallbackAssetId ? assetUrls[item.staticFallbackAssetId] : undefined
  return pkg
    ? <div ref={container} data-testid="flow-page-component" data-component-instance-id={nodeId}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', ...style }} />
    : fallbackUrl
      ? <img src={fallbackUrl} alt={`${item.component.packageId} 后备`} style={{ width: '100%', height: '100%', objectFit: 'contain', ...style }} />
      : <div data-testid="flow-page-component-missing" style={style}>{item.component.packageId}</div>
}
