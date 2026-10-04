import { courseComponentNameKey } from '../../../shared/composition/projectReferences'
import type { FlowBlock } from '../../../shared/courseProjectTypes'
import type { PublishedRuntimeLayerItem } from '../../../shared/publishedCourseTypes'
import type { CourseStateStore, RuntimeHostActions } from '../../../shared/runtimeTypes'
import { placeholderElement, themeHtmlDocumentRuntimes } from '../../composition/compositionHostDocument'
import { mountPublishedCanvasRuntime } from '../runtime/publishedCanvasRuntimeMount'
import { mountPublishedSurfaceRuntime, type PublishedSurfaceRuntimeSession } from '../runtime/publishedSurfaceRuntimeMount'

type CourseComponentBlock = Extract<FlowBlock, { type: 'course-component' }>
type PublishedRuntime = PublishedRuntimeLayerItem['runtime']

/** The definition a block names, matched as file names are (ignoring case). */
export function findPublishedCourseComponent(components: Readonly<Record<string, PublishedRuntime>> | undefined, name: string): PublishedRuntime | undefined {
  const key = courseComponentNameKey(name)
  const stored = Object.keys(components ?? {}).find(candidate => courseComponentNameKey(candidate) === key)
  return stored === undefined ? undefined : components![stored]
}

export interface CourseComponentBlockMountOptions {
  block: CourseComponentBlock
  /** The published definition of `block.name`; absent while the course has none. */
  runtime: PublishedRuntime | undefined
  width: number
  height: number
  mode: 'playback' | 'authoring'
  visible: boolean
  /** Course theme style text, for components written as HTML documents. */
  theme?: string
  resolveAsset(assetId: string): string | undefined
  session: PublishedSurfaceRuntimeSession
  courseState?: CourseStateStore
  actions?: Readonly<RuntimeHostActions>
  reportError?(error: Error): void
}

export interface CourseComponentBlockHandle {
  readonly element: HTMLElement
  resize(width: number, height: number): void
  setVisible(visible: boolean): void
  suspend(): void
  resume(): void
  destroy(): void
}

/**
 * Runs the named component of a `course-component` block in `container`, as a page
 * frame runs it; a missing name shows the block's title and a draft shows its reason.
 */
export function mountCourseComponentBlock(container: HTMLElement, options: CourseComponentBlockMountOptions): CourseComponentBlockHandle {
  const { block, runtime } = options
  const dom = container.ownerDocument
  container.dataset.courseComponent = block.name
  const placeholder = (title: string, detail: string): CourseComponentBlockHandle => {
    container.dataset.courseComponentState = 'placeholder'
    container.replaceChildren(placeholderElement(dom, title, detail))
    return { element: container, resize() {}, setVisible() {}, suspend() {}, resume() {}, destroy() { container.replaceChildren() } }
  }
  if (!runtime) return placeholder('待填组件', block.title || block.name)
  if (!runtime.enabled) return placeholder(runtime.draft ? '组件未通过检查' : '组件已停用', runtime.draft?.reason ?? (block.title || block.name))
  container.replaceChildren()
  container.dataset.courseComponentState = 'mounted'
  const input = {
    instanceId: block.id, runtime, width: options.width, height: options.height, visible: options.visible, mode: options.mode,
    resolveAsset: options.resolveAsset, session: options.session, courseState: options.courseState, actions: options.actions,
    reportError: (_phase: string, error: Error) => options.reportError?.(error),
  }
  const handle = runtime.protocol === 'surface-runtime'
    ? mountPublishedSurfaceRuntime(container, input)
    : mountPublishedCanvasRuntime(container, { ...input, sceneId: block.id, canvas: { width: options.width, height: options.height } })
  if (options.theme) themeHtmlDocumentRuntimes(container, options.theme)
  return {
    element: container,
    resize: (width, height) => handle.updateSize(width, height),
    setVisible: visible => handle.setVisible(visible),
    suspend: () => handle.suspend(),
    resume: () => handle.resume(),
    destroy: () => handle.destroy(),
  }
}
