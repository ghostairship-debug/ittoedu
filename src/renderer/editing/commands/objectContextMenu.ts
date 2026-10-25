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
  /** Frozen exact field identity, when this menu belongs to an author field. */
  selectionIdentity?: string
  /** Actions for the exact spot under the pointer (e.g. a Runtime's text), listed first. */
  extra?: readonly MenuCommand[]
}

/** Returns true when the selection owner showed a menu for exactly these objects. */
export function requestObjectContextMenu(root: Element, request: ObjectContextMenuRequest): boolean {
  return !root.dispatchEvent(new CustomEvent<ObjectContextMenuRequest>(OBJECT_CONTEXT_MENU_EVENT, { detail: request, cancelable: true }))
}

/**
 * The quick bar or a menu asks the workspace to open an object's own editor, as a double-click does (e.g. the formula
 * editor for a formula).
 */
export const OBJECT_EDIT_EVENT = 'course-object-edit'
export const IMAGE_EDIT_EVENT = 'course-image-edit'
export interface ImageEditRequest { documentId: string; epoch: string; itemId: string; selectionIdentity?: string }
/** Allow the selecting workspace's render to mount its exact selection UI first. */
export function requestImageEdit(request: ImageEditRequest): void {
  window.setTimeout(() => window.dispatchEvent(new CustomEvent<ImageEditRequest>(IMAGE_EDIT_EVENT, { detail: request })), 0)
}

/** Returns true when the workspace opened an editor for the object. */
export function requestObjectEdit(root: Element, itemId: string): boolean {
  return !root.dispatchEvent(new CustomEvent<{ itemId: string }>(OBJECT_EDIT_EVENT, { detail: { itemId }, cancelable: true }))
}

/** A current field action is resolved by its active document owner, never by owning instance fallback. */
export const AUTHOR_FIELD_ACTION_EVENT = 'course-author-field-action'
interface AuthorFieldActionTarget {
  documentId: string
  epoch: string
  selectionIdentity: string
}
export type AuthorFieldActionRequest = AuthorFieldActionTarget & (
  | { action: 'edit' | 'replace-image' }
  | { action: 'nudge'; dx: number; dy: number }
)
export function requestAuthorFieldAction(request: AuthorFieldActionRequest): boolean {
  return !window.dispatchEvent(new CustomEvent<AuthorFieldActionRequest>(AUTHOR_FIELD_ACTION_EVENT, { detail: request, cancelable: true }))
}
