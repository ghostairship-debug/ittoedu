import { useEffect, useRef } from 'react'
import type { ComponentDefinition, ComponentInstance, ComponentRuntimeScope } from '../../shared/contracts/component-platform'
import { createTeacherControllerRuntimeImplementation, TEACHER_CONTROLLER_DEFINITION } from '../../components/teacher-controller'
import { readTeacherControllerConfig } from '../../shared/teacherControllerConfig'

export interface TeacherControllerAuthoringChromeProps {
  readonly item: ComponentInstance
  readonly definition?: Pick<ComponentDefinition, 'implementation'>
  readonly frame?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly rotation?: number
  readonly canvas?: { readonly width: number; readonly height: number }
  readonly getRenderedStageBounds?: () => { width: number; height: number }
  readonly scenes?: readonly { id: string; name: string }[]
  readonly currentSceneId?: string | null
  readonly flowViewport?: boolean
  readonly projectId?: string
  readonly assetUrls?: Record<string, string>
}
export function teacherControllerAuthoringPreviewCollapsed(item: ComponentInstance, definition?: Pick<ComponentDefinition, 'implementation'>): boolean {
  if (!usesDefaultController(item, definition)) return false
  const data = item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data : {}
  const config = readTeacherControllerConfig(data)
  return config.collapsible && config.defaultCollapsed
}
function usesDefaultController(item: ComponentInstance, definition?: Pick<ComponentDefinition, 'implementation'>): boolean {
  const implementation = item.implementationOverride ?? definition?.implementation
  return implementation ? implementation.kind === 'builtin' && implementation.key === 'guoling.navigation'
    : item.definitionId === TEACHER_CONTROLLER_DEFINITION.id
}
/** The preloaded controller draws author chrome; the surface owns all editing gestures. */
export function TeacherControllerAuthoringChrome({ item, definition }: TeacherControllerAuthoringChromeProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = hostRef.current
    if (!root || !usesDefaultController(item, definition)) return
    const controller = new AbortController(), cleanups = new Set<() => void>()
    let active = true
    const scope: ComponentRuntimeScope = {
      runScopeId: `author-preview:${item.id}`, instanceId: item.id, generation: 1, signal: controller.signal,
      isActive: () => active, cleanup: cleanup => { if (active) cleanups.add(cleanup); else cleanup() },
      target: () => null, events: { emit() {}, subscribe: () => () => {} },
      state: { get: () => undefined, set() {}, subscribe: () => () => {} },
    }
    // No navigation port: default UI is visible and inert, with no second navigator.
    const mounted = createTeacherControllerRuntimeImplementation(undefined).mount({ instance: item, scope, root })
    root.setAttribute('inert', ''); root.tabIndex = -1
    return () => {
      active = false; controller.abort()
      for (const cleanup of cleanups) cleanup()
      cleanups.clear()
      void Promise.resolve(mounted).then(value => value.dispose())
    }
  }, [item, definition])
  if (!usesDefaultController(item, definition)) return null
  return <div ref={hostRef} className="teacher-controller-authoring-chrome" data-testid="teacher-controller-authoring-chrome"
    data-controller-preview-collapsed={teacherControllerAuthoringPreviewCollapsed(item, definition)} aria-hidden="true"
    style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
}
