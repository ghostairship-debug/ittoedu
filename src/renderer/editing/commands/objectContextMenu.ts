import type { MenuCommand } from './CommandMenu'

/**
 * A workspace (Slide, Flow or Spatial) hit-tests a right-click and selects what is under the pointer; the selection's
 * owner, which also draws the quick bar, then shows that selection's menu from the same command list.
 */
export const OBJECT_CONTEXT_MENU_EVENT = 'course-object-context-menu'

export interface ObjectContextMenuRequest {
  x: number
  y: number
  /** The objects the menu is for; a menu opens only when they are the current selection. */
  itemIds: readonly string[]
  /** Actions for the exact spot under the pointer (e.g. a Runtime's text), listed first. */
  extra?: readonly MenuCommand[]
}

/** Returns true when the selection owner showed a menu for exactly these objects. */
export function requestObjectContextMenu(root: Element, request: ObjectContextMenuRequest): boolean {
  return !root.dispatchEvent(new CustomEvent<ObjectContextMenuRequest>(OBJECT_CONTEXT_MENU_EVENT, { detail: request, cancelable: true }))
}
