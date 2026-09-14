import { useEffect, useRef } from 'react'
import type { LayerItem } from '../../shared/courseProjectTypes'
import type { TeacherControllerSceneInfo } from '../../player/teacherControllerHostContract'
import {
  teacherControllerHostNode,
} from '../../player/teacherControllerHostContract'
import { isTeacherControllerLayerItem } from '../course/globalLayerCommands'
import { TeacherControllerComponentHost } from '../../player/teacherControllerComponentHost'
import { controllerGeometryItem } from '../../player/teacherControllerComponentGeometry'
import type { TeacherControllerHostOptions } from '../../player/teacherControllerHostContract'
import type { ComponentPackageData } from '../../shared/componentTypes'

export interface TeacherControllerAuthoringChromeProps {
  readonly item: LayerItem
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly rotation: number
  readonly canvas: { readonly width: number; readonly height: number }
  readonly getRenderedStageBounds: () => { width: number; height: number }
  readonly scenes: readonly TeacherControllerSceneInfo[]
  readonly currentSceneId: string | null
  readonly flowViewport?: boolean
  readonly projectId?: string
  readonly componentPackages?: Record<string, ComponentPackageData>
  readonly assetUrls?: Record<string, string>
}

export function teacherControllerAuthoringPreviewCollapsed(item: LayerItem): boolean {
  return isTeacherControllerLayerItem(item) &&
    controllerGeometryItem(item).config.collapsible &&
    controllerGeometryItem(item).config.defaultCollapsed
}

function makeAuthoringPreviewInert(controller: TeacherControllerComponentHost): void {
  const root = controller.rootElement
  root.style.pointerEvents = 'none'
  root.tabIndex = -1
  root.setAttribute('aria-hidden', 'true')
  root.setAttribute('inert', '')
  root.removeAttribute('aria-label')
  root.removeAttribute('aria-keyshortcuts')
}

/**
 * Authoring-time controller chrome. Interactive playback stays off so Flow/Spatial
 * overlay gestures own the hit region.
 */
export function TeacherControllerAuthoringChrome({
  item,
  frame,
  rotation,
  canvas,
  getRenderedStageBounds,
  scenes,
  currentSceneId,
  flowViewport,
  projectId, componentPackages, assetUrls,
}: TeacherControllerAuthoringChromeProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<TeacherControllerComponentHost | null>(null)
  const liveRef = useRef({
    item,
    frame,
    rotation,
    canvas,
    getRenderedStageBounds,
    scenes,
    currentSceneId,
  })
  liveRef.current = {
    item,
    frame,
    rotation,
    canvas,
    getRenderedStageBounds,
    scenes,
    currentSceneId,
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host || !isTeacherControllerLayerItem(item)) return
    const live = () => liveRef.current
    const options: TeacherControllerHostOptions = {
      node: { ...teacherControllerHostNode(frame, rotation), flowViewport, playbackView: flowViewport },
      container: host,
      canvas,
      getRenderedStageBounds: () => live().getRenderedStageBounds(),
      scenes: [...scenes],
      getCurrentSceneId: () => live().currentSceneId,
      getStateLabel: () => null,
      getStatus: () => ({ muted: false, fullscreen: false }),
      getSession: () => ({
        offset: { dx: 0, dy: 0 },
        collapsed: teacherControllerAuthoringPreviewCollapsed(live().item),
      }),
      onSessionChange: () => undefined,
      onAction: () => undefined,
      getInteractive: () => false,
    }
    const controller = new TeacherControllerComponentHost(options, {
      container: host, componentId: item.component.packageId, version: item.component.version,
      instanceId: item.layerItemId, props: item.props, width: frame.width, height: frame.height,
      components: componentPackages, projectId, resolveAsset: id => assetUrls?.[id],
      scope: 'global', mode: 'edit', interactive: false,
    })
    makeAuthoringPreviewInert(controller)
    controllerRef.current = controller
    return () => {
      controller.destroy()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [item.kind === 'component' ? item : item.layerItemId, componentPackages, assetUrls, projectId])

  useEffect(() => {
    const current = liveRef.current
    if (!controllerRef.current || !isTeacherControllerLayerItem(current.item)) return
    controllerRef.current.update({ ...teacherControllerHostNode(current.frame, current.rotation), flowViewport, playbackView: flowViewport })
  }, [currentSceneId, frame.height, frame.width, frame.x, frame.y, item, rotation, scenes])

  if (!isTeacherControllerLayerItem(item)) return null

  return (
    <div
      ref={hostRef}
      className="teacher-controller-authoring-chrome"
      data-testid="teacher-controller-authoring-chrome"
      data-controller-preview-collapsed={teacherControllerAuthoringPreviewCollapsed(item)}
      aria-hidden="true"
      style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  )
}
