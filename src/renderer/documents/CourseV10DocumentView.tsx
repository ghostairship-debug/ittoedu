import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { isComponentVisibleAtSurface, type ComponentInstance, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import { componentPaintStyle } from '../../player/components/componentPlacementStyle'
import { flowObjectExtent } from '../../core/components/geometry/flowObjectExtent'
import { componentLayoutInput } from '../../components/web/measuredFragmentBox'

export interface CourseV10DocumentViewProps {
  project: CourseProjectV10
  surfaceId: string | null
  selectedInstanceId: string | null
  selectedInstanceIds?: readonly string[]
  player?: boolean
  onSelect(instanceId: string | null): void
  onElement?(instanceId: string, element: HTMLElement | null): void
  onTargetElement?(instanceId: string, element: HTMLElement | null): void
}

/** Author geometry and ownership projection only; professional DOM belongs to component runtime. */
export function InstanceView({ instance, project, surfaceId, selectedInstanceId, selectedInstanceIds, player, onSelect, onElement, onTargetElement, placement = 'free' }: {
  instance: ComponentInstance
  surfaceId?: string | null
  placement?: 'free' | 'flow'
} & Omit<CourseV10DocumentViewProps, 'surfaceId'>) {
  const bind = useCallback((element: HTMLDivElement | null) => { onElement?.(instance.id, element) }, [instance.id, onElement])
  const outer = useRef<HTMLDivElement | null>(null)
  const bindTarget = useCallback((element: HTMLDivElement | null) => { outer.current = element; onTargetElement?.(instance.id, element) }, [instance.id, onTargetElement])
  const frame = instance.frame
  const definition = project.definitions[instance.definitionId]
  const implementation = instance.implementationOverride ?? definition?.implementation
  const section = definition?.implementation.kind === 'builtin' && definition.implementation.key === 'guoling.document-block'
  const flow = placement === 'flow'
  const naturalFlow = flow && componentLayoutInput(instance, { kind: 'flow', inlineSize: frame?.width ?? 1, definition }).mode === 'flow-content'
  const localAssembly = flow && !naturalFlow && !section && (implementation?.kind === 'source' || implementation?.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(implementation.key) || Boolean(instance.childIds?.length))
  const extent = localAssembly ? flowObjectExtent(project, instance.id) : null
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const element = outer.current
    if (!element || !extent) return
    const resize = () => setScale(extent.width > 0 ? Math.min(1, (element.clientWidth || extent.width) / extent.width) : 1)
    resize()
    const Observer = element.ownerDocument.defaultView?.ResizeObserver
    const observer = Observer ? new Observer(resize) : undefined
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [extent?.width])
  const authoredStyle = componentPaintStyle(instance, definition) as CSSProperties
  const style: CSSProperties = flow ? {
    position: 'relative', width: '100%', height: naturalFlow ? 'auto' : extent ? extent.height * scale : section ? 'auto' : frame?.height ?? 'auto', marginBottom: 12,
  } : frame ? {
    position: 'absolute', left: 0, top: 0, width: frame.width, height: frame.height,
    transform: `matrix(${frame.transform.join(',')})`, transformOrigin: '0 0',
  } : { position: 'relative' }
  if (definition?.role === 'behavior') return null
  const children = instance.childIds?.map(id => project.instances[id] && <InstanceView key={id} instance={project.instances[id]} project={project}
    surfaceId={surfaceId} selectedInstanceId={selectedInstanceId} selectedInstanceIds={selectedInstanceIds} player={player} onSelect={onSelect}
    onElement={onElement} onTargetElement={onTargetElement} placement={flow && section ? 'flow' : 'free'} />)
  const content = <div ref={bind} data-component-render={instance.id} style={{ width: extent ? frame?.width ?? extent.width : '100%',
    height: naturalFlow ? 'var(--component-flow-height, auto)' : flow ? frame?.height ?? 'auto' : '100%' }} />
  return <div ref={bindTarget} hidden={!isComponentVisibleAtSurface(instance, surfaceId ?? '')} style={{ pointerEvents: 'auto', ...authoredStyle, ...style,
    outline: !player && (selectedInstanceIds?.includes(instance.id) ?? selectedInstanceId === instance.id) ? '2px solid #2563eb' : undefined }}
    data-component-instance={instance.id} data-component-placement={placement} onPointerDown={event => { if (!player && !instance.locked) { event.stopPropagation(); onSelect(instance.id) } }}>
    {extent ? <div style={{ position: 'absolute', left: 0, top: 0, width: extent.width, height: extent.height,
      transform: `scale(${scale}) translate(${-extent.x}px,${-extent.y}px)`, transformOrigin: '0 0' }}>{content}{children}</div> : <>{content}{children}</>}
  </div>
}

export function CourseV10DocumentView(props: CourseV10DocumentViewProps) {
  const surface = props.project.surfaces.find(value => value.id === props.surfaceId) ?? props.project.surfaces[0]
  if (!surface) return <p>请新建一个内容表面。</p>
  const instances = (children: string[], placement: 'free' | 'flow' = 'free') => children.map(id => props.project.instances[id] && <InstanceView key={id} instance={props.project.instances[id]} project={props.project}
    placement={placement}
    surfaceId={surface.id} selectedInstanceId={props.selectedInstanceId} selectedInstanceIds={props.selectedInstanceIds} player={props.player} onSelect={props.onSelect} onElement={props.onElement} onTargetElement={props.onTargetElement} />)
  return <div style={{ overflow: 'auto', minHeight: 400, background: '#e8edf3', padding: 24 }}>
    <div aria-label={surface.title} onPointerDown={() => props.onSelect(null)} style={{ position: 'relative', background: '#fff',
      width: surface.designSize?.width ?? 960, minHeight: surface.designSize?.height ?? 640,
      ...(surface.kind === 'flow' ? { height: 'auto' } : { height: surface.designSize?.height ?? 640 }) }}>
      {instances(props.project.global.underlay)}
      {props.project.surfaces.map(value => <div key={value.id} hidden={value.id !== surface.id} style={{ position: 'relative', width: '100%', height: value.designSize?.height ?? 640 }}>
        {instances(value.childIds, value.kind === 'flow' ? 'flow' : 'free')}
      </div>)}
      {instances(props.project.global.overlay)}
    </div>
  </div>
}
