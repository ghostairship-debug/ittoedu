export type SlideAuthoringFocusKind =
  | 'none'
  | 'input'
  | 'textarea'
  | 'select'
  | 'contenteditable'
  | 'text-edit-session'
  | 'formula-edit-session'
  | 'runtime-author-session'
  | 'component-author-session'

export interface SlideAuthoringFocusDescriptor {
  readonly tagName?: string
  readonly isContentEditable?: boolean
  readonly textEditSession?: boolean
  readonly formulaEditSession?: boolean
  readonly runtimeAuthorSession?: boolean
  readonly componentAuthorSession?: boolean
}

export const SLIDE_DELETE_FOCUS_GUARD_REASON =
  '文字或作者编辑中，Delete/Backspace 只编辑文本，不删除元素'

export function classifySlideAuthoringFocus(
  input?: SlideAuthoringFocusKind | SlideAuthoringFocusDescriptor | EventTarget | null,
): SlideAuthoringFocusKind {
  if (input == null) return 'none'
  if (typeof input === 'string') return input
  const descriptor = readFocusDescriptor(input)
  if (descriptor.formulaEditSession) return 'formula-edit-session'
  if (descriptor.textEditSession) return 'text-edit-session'
  if (descriptor.runtimeAuthorSession) return 'runtime-author-session'
  if (descriptor.componentAuthorSession) return 'component-author-session'
  const tag = descriptor.tagName?.toLowerCase()
  if (tag === 'input') return 'input'
  if (tag === 'textarea') return 'textarea'
  if (tag === 'select') return 'select'
  if (isContentEditableDescriptor(descriptor, input)) return 'contenteditable'
  return 'none'
}

export function isSlideTextLikeAuthoringFocus(focus: SlideAuthoringFocusKind): boolean {
  return focus !== 'none'
}

/**
 * Text and authoring sessions keep Delete/Backspace within their own editor.
 */
export function shouldIgnoreSlideLayerDeleteForFocus(
  input?: SlideAuthoringFocusKind | SlideAuthoringFocusDescriptor | EventTarget | null,
): boolean {
  return isSlideTextLikeAuthoringFocus(classifySlideAuthoringFocus(input))
}

function readFocusDescriptor(
  input: SlideAuthoringFocusDescriptor | EventTarget,
): SlideAuthoringFocusDescriptor {
  if (typeof HTMLElement !== 'undefined' && input instanceof HTMLElement) {
    return {
      tagName: input.tagName,
      isContentEditable: isHtmlContentEditable(input),
    }
  }
  return input as SlideAuthoringFocusDescriptor
}

function isHtmlContentEditable(element: HTMLElement): boolean {
  if (element.isContentEditable) return true
  const value = element.contentEditable
  if (value === 'true' || value === 'plaintext-only') return true
  const attr = element.getAttribute('contenteditable')
  return attr === '' || attr === 'true' || attr === 'plaintext-only'
}

function isContentEditableDescriptor(
  descriptor: SlideAuthoringFocusDescriptor,
  input: SlideAuthoringFocusKind | SlideAuthoringFocusDescriptor | EventTarget,
): boolean {
  if (descriptor.isContentEditable) return true
  if (typeof HTMLElement !== 'undefined' && input instanceof HTMLElement) {
    return isHtmlContentEditable(input)
  }
  return false
}

