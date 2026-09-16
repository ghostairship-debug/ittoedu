import { composeCourseProjectLocation } from './courseLayerComposition'
import type { CourseProjectDocument } from './courseProjectTypes'

/** The compositor's mount boundary is different from playbackInitialVisibility.
 * node.enter can reveal a mounted playback-hidden item, never an unmounted one. */
export function slideMotionTargetUnavailable(project: CourseProjectDocument, locationId: string, stateId: string | null, nodeId: string): string | null {
  const entry = composeCourseProjectLocation({ project, locationId, stateId }).entries.find(value => value.item.layerItemId === nodeId)
  if (entry?.mounted) return null
  return `图层“${entry?.item.label || nodeId}”在状态“${stateId ?? '基础场景'}”未挂载（visible:false 或不属于当前位置）；show/hide 只控制已挂载节点的入退场动画。若目标呈现状态已设置显隐，直接使用 set-state；需要动画时保留 visible:true，并以 playbackInitialVisibility:hidden 设置初始播放隐藏。`
}
