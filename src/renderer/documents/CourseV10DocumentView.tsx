import { allDocumentTextSlots, inlineComponentIds, documentInlineChildIds } from '../../shared/document/textInteraction'
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { componentSurface, componentSurfaces, isComponentVisibleAtSurface, type ComponentInstance, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import { componentPaintStyle } from '../../shared/componentPaintStyle'
import { resolveComponentOuterPresentation } from '../../shared/componentPresentation'
import { ImageSafeAreaGuides } from '../ui/workspaces/ImageSafeAreaGuides'
import type { CourseInteractionSelection } from './interactionSelection'

export interface CourseV10DocumentViewProps {
  project: CourseProjectV10
  authorProject?: CourseProjectV10
  surfaceId: string | null
  rootInstanceId?: string | null
  selectedInstanceId: string | null
  selectedInstanceIds?: readonly string[]
  /** A field's derived owner id is not an overall object selection. */
  selectionKind?: CourseInteractionSelection['kind']
  player?: boolean
  /** Read the existing runtime at gesture time, including editor try-run. */
  isPlaying?(): boolean
  onSelect(instanceId: string | null): void
  onElement?(instanceId: string, element: HTMLElement | null, expectedDefault?: HTMLElement): void
  onTargetElement?(instanceId: string, element: HTMLElement | null, expectedDefault?: HTMLElement): void
  renderContainer?(instanceId: string, project: CourseProjectV10, placement?: 'free' | 'flow'): ReactNode
}

/** Author geometry and ownership projection only; professional DOM belongs to component runtime. */
export function InstanceView({ instance, project, authorProject = project, surfaceId, selectedInstanceId, selectedInstanceIds, selectionKind, player, isPlaying, onSelect, onElement, onTargetElement, renderContainer, placement = 'free' }: {
  instance: ComponentInstance
  surfaceId?: string | null
  placement?: 'free' | 'flow' | 'program'
} & Omit<CourseV10DocumentViewProps, 'surfaceId'>) {
  const contentHost = useRef<HTMLElement | null>(null)
  const bind = useCallback((element: HTMLElement | null) => {
    const previous = contentHost.current; contentHost.current = element
    if (element) onElement?.(instance.id, element)
    // A replacement container can bind this id before the old React tree unmounts.
    else if (previous) onElement?.(instance.id, null, previous)
  }, [instance.id, onElement])
  const outer = useRef<HTMLDivElement | null>(null)
  const bindTarget = useCallback((element: HTMLDivElement | null) => {
    const previous = outer.current; outer.current = element
    if (element) onTargetElement?.(instance.id, element)
    else if (previous) onTargetElement?.(instance.id, null, previous)
  }, [instance.id, onTargetElement])
  const definition = project.definitions[instance.definitionId]
  const [inlineSize, setInlineSize] = useState(instance.frame?.width ?? 1)
  const [availableInlineSize,setAvailableInlineSize]=useState<number|undefined>(undefined)
  const presentation = resolveComponentOuterPresentation(project, instance, { placement: placement === 'program' ? 'free' : placement, purpose: player ? 'playback' : 'author', inlineSize, availableInlineSize,
    flowLayout: surfaceId ? componentSurface(project, surfaceId)?.flow?.layout : undefined })
  useLayoutEffect(() => {
    const element = outer.current
    if (!element || placement !== 'flow') return
    const resize = () => { if (element.clientWidth > 0) setInlineSize(element.clientWidth);if(element.parentElement?.clientWidth)setAvailableInlineSize(element.parentElement.clientWidth) }
    resize()
    const Observer = element.ownerDocument.defaultView?.ResizeObserver
    const observer = Observer ? new Observer(resize) : undefined
    observer?.observe(element);if(element.parentElement)observer?.observe(element.parentElement)
    return () => observer?.disconnect()
  }, [placement])
  const authoredStyle = componentPaintStyle(instance, definition) as CSSProperties
  if (definition?.role === 'behavior') return null
  const inlineIds = new Set(allDocumentTextSlots(instance.data).flatMap(slot => inlineComponentIds(slot.content)))
  for (const id of documentInlineChildIds(authorProject, instance.id)) if (!project.instances[id]?.frame && !project.instances[id]?.flowPlacement) inlineIds.add(id)
  const children = !instance.container ? instance.childIds?.filter(id => !inlineIds.has(id)).map(id => project.instances[id] && <InstanceView key={id} instance={project.instances[id]} project={project} authorProject={authorProject}
    surfaceId={surfaceId} selectedInstanceId={selectedInstanceId} selectedInstanceIds={selectedInstanceIds} selectionKind={selectionKind} player={player} isPlaying={isPlaying} onSelect={onSelect}
    onElement={onElement} onTargetElement={onTargetElement} renderContainer={renderContainer} placement={presentation.childrenPlacement} />) : undefined
  const content = presentation.section
    ? <summary ref={bind} data-component-render={instance.id} style={presentation.contentStyle as CSSProperties} />
    : <div ref={bind} data-component-render={instance.id} style={presentation.contentStyle as CSSProperties} />
  const childContent = <div style={presentation.childrenStyle as CSSProperties}>{children}</div>
  return <div ref={bindTarget} hidden={!isComponentVisibleAtSurface(instance, surfaceId ?? '')} style={{ pointerEvents: 'auto', ...authoredStyle, ...presentation.outerStyle as CSSProperties,
    ...(placement === 'program' ? { position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'none' } as CSSProperties : {}),
    outline: !player && (selectionKind === undefined || selectionKind === 'objects') && (selectedInstanceIds?.includes(instance.id) ?? selectedInstanceId === instance.id) ? '2px solid #2563eb' : undefined }}
    data-component-instance={instance.id} data-component-placement={placement} onPointerDown={event => { if (!player && !isPlaying?.() && !instance.locked) { event.stopPropagation(); onSelect(instance.id) } }}>
    {instance.container && renderContainer ? renderContainer(instance.id, project, placement === 'flow' ? 'flow' : 'free') : presentation.section
      ? <details open={presentation.section.open} style={presentation.stageStyle as CSSProperties}>{content}{childContent}</details>
      : <div style={presentation.stageStyle as CSSProperties}>{content}{childContent}{!player && <ImageSafeAreaGuides instance={instance} project={project} />}</div>}
  </div>
}

export function CourseV10DocumentView(props: CourseV10DocumentViewProps) {
  const rootId = props.rootInstanceId ?? props.project.entry?.rootInstanceId ?? props.project.rootIds[0]
  const surface = props.surfaceId ? componentSurface(props.project, props.surfaceId) : rootId ? componentSurface(props.project, rootId) : undefined
  if (!surface) {
    const instance = rootId ? props.project.instances[rootId] : undefined
    return instance ? <div style={{ position: 'relative', width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
      {props.project.global.underlay.map(id => props.project.instances[id] && <InstanceView {...props} key={id} instance={props.project.instances[id]} surfaceId={rootId ?? null} placement="free" />)}
      <InstanceView {...props} instance={instance} surfaceId={rootId ?? null} placement="program" />
      {props.project.global.overlay.map(id => props.project.instances[id] && <InstanceView {...props} key={id} instance={props.project.instances[id]} surfaceId={rootId ?? null} placement="free" />)}
    </div> : <p>请添加作品内容。</p>
  }
  const instances = (children: string[], placement: 'free' | 'flow' = 'free') => children.map(id => props.project.instances[id] && <InstanceView key={id} instance={props.project.instances[id]} project={props.project} authorProject={props.authorProject}
    placement={placement} selectionKind={props.selectionKind}
    surfaceId={surface.id} selectedInstanceId={props.selectedInstanceId} selectedInstanceIds={props.selectedInstanceIds} player={props.player} isPlaying={props.isPlaying} onSelect={props.onSelect} onElement={props.onElement} onTargetElement={props.onTargetElement} renderContainer={props.renderContainer} />)
  return <div style={{ overflow: 'auto', minHeight: 400, background: '#e8edf3', padding: 24 }}>
    <div aria-label={surface.title} onPointerDown={() => { if (!props.player && !props.isPlaying?.()) props.onSelect(null) }} style={{ position: 'relative', background: '#fff',
      width: surface.designSize?.width ?? 960, minHeight: surface.designSize?.height ?? 640,
      ...(surface.kind === 'flow' ? { height: 'auto' } : { height: surface.designSize?.height ?? 640 }) }}>
      {props.project.rootIds.includes(surface.id) && instances(props.project.global.underlay)}
      {(props.project.rootIds.includes(surface.id) ? componentSurfaces(props.project) : [surface]).map(value => <div key={value.id} hidden={value.id !== surface.id} style={{ position: 'relative', width: '100%', height: value.designSize?.height ?? 640 }}>
        {instances(value.childIds, value.kind === 'flow' ? 'flow' : 'free')}
      </div>)}
      {props.project.rootIds.includes(surface.id) && instances(props.project.global.overlay)}
    </div>
  </div>
}
