import { componentContainers } from '../../shared/contracts/component-platform/project'
import type {CourseProjectV10} from '../../shared/contracts/component-platform'
import {isComponentVisibleAtSurface,owningContainer} from '../../shared/contracts/component-platform'
import {componentSurfaceGeometryTargets} from './spatialTargets'
import {componentSpatialCameraMatrix,type ComponentSpatialCamera} from '../surfaces/spatial/componentSpatialAdapter'
import {transformPoint} from '../../core/components/geometry'
import {spatialComponentCenter,spatialConnectionSegments,spatialConnectionTargets,spatialPathPoints,spatialPathTargetIds,spatialRelationLabelPosition,spatialSemanticVisible} from '../surfaces/spatial/componentPlatform/graph'
export function paintComponentSpatialGraph(document:Document,project:CourseProjectV10,id:string,svg:SVGSVGElement,pose:ComponentSpatialCamera,viewport:{width:number;height:number}){
const surface=componentContainers(project).find(value=>value.id===id);if(!surface)return;const targets=componentSurfaceGeometryTargets(project,id);const matrix=componentSpatialCameraMatrix(pose,{x:0,y:0,...viewport});
    const element = (tag: string, attributes: Record<string, string | number>) => {
      const value = document.createElementNS('http://www.w3.org/2000/svg', tag)
      for (const [key, item] of Object.entries(attributes)) value.setAttribute(key, String(item))
      return value
    }
    svg.replaceChildren()
    const arrowId = `component-arrow-${id}`, defs = element('defs', {}), marker = element('marker', { id: arrowId, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' })
    marker.append(element('path', { d: 'M0 0L10 5L0 10Z', fill: '#64748b' })); defs.append(marker); svg.append(defs)
    const visible = (instanceId: string) => Boolean(project?.instances[instanceId] && isComponentVisibleAtSurface(project.instances[instanceId], id) && spatialSemanticVisible(surface.spatial, instanceId, pose.zoom))
    const visibleTargets = targets.map(target => {
      const ancestors: string[] = []
      let container = owningContainer(project, target.instanceId)
      while (container?.kind === 'instance') { ancestors.push(container.instanceId); container = owningContainer(project, container.instanceId) }
      return { ...target, ancestors }
    }).filter(target => [...target.ancestors, target.instanceId].every(visible))
    for (const path of surface.spatial?.paths ?? []) {
      const segments = spatialConnectionSegments(spatialPathPoints(surface.spatial, path, visibleTargets), spatialConnectionTargets(visibleTargets, spatialPathTargetIds(surface.spatial, path)))
      const line = element('path', { 'data-spatial-path-id': path.id,
        d: segments.map(segment => { const start = transformPoint(matrix, segment.start), end = transformPoint(matrix, segment.end); return `M${start.x},${start.y}L${end.x},${end.y}` }).join(' '),
        fill: 'none', stroke: path.style?.color ?? '#3388ff', 'stroke-width': path.style?.width ?? 2 })
      if (path.style?.dash === 'dashed' || path.style?.dash === 'dotted') line.setAttribute('stroke-dasharray', path.style.dash === 'dashed' ? '8 5' : '2 4')
      svg.append(line)
    }
    for (const relation of surface.spatial?.relations ?? []) {
      const a = spatialComponentCenter(visibleTargets, relation.sourceInstanceId), b = spatialComponentCenter(visibleTargets, relation.targetInstanceId)
      if (!a || !b) continue
      const obstacles = spatialConnectionTargets(visibleTargets, [relation.sourceInstanceId, relation.targetInstanceId]), segments = spatialConnectionSegments([a, b], obstacles)
      const group = element('g', { 'data-spatial-relation-id': relation.id })
      segments.forEach((segment, index) => {
        const start = transformPoint(matrix, segment.start), end = transformPoint(matrix, segment.end)
        const line = element('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, stroke: '#64748b', 'stroke-width': 2 })
        if (index === segments.length - 1 && relation.kind !== 'line') line.setAttribute('marker-end', `url(#${arrowId})`)
        if (index === 0 && relation.kind === 'bidirectional') line.setAttribute('marker-start', `url(#${arrowId})`)
        group.append(line)
      })
      svg.append(group)
      if (relation.label && segments.length) {
        const label = element('text', { fill: '#334155', 'font-size': 14, 'text-anchor': 'middle', 'dominant-baseline': 'central', stroke: '#fff', 'stroke-width': 6, 'paint-order': 'stroke', 'stroke-linejoin': 'round' })
        label.textContent = relation.label; group.append(label)
        const bounds = (label as SVGGraphicsElement).getBBox?.(), position = spatialRelationLabelPosition(segments, obstacles, matrix, bounds ?? { width: 0, height: 14 })
        if (position) { label.setAttribute('x', String(position.x)); label.setAttribute('y', String(position.y)) }
      }
    }

}
