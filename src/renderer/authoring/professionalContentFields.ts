import type { ComponentAuthorSpot, ComponentFrame, CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform'
import { documentTextContentSchema, type FlowTextContent } from '../../shared/document/content'
import { createTextComponentData, textComponentDataSchema, type TextComponentData } from '../../components/text/data'
import { authorSpotValue } from '../../core/components/authoring/componentAuthorEdits'

export function authorFieldRichContent(value: unknown): FlowTextContent | undefined {
  const parsed = documentTextContentSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** The professional input may have a text wrapper; only its original content value is written back. */
export function authorFieldTextData(spot: ComponentAuthorSpot, value: JsonValue = spot.initialValue, nativeText?: TextComponentData): TextComponentData | undefined {
  const content = authorFieldRichContent(value)
  if (!content) return undefined
  if (nativeText) return textComponentDataSchema.parse({ ...nativeText, content })
  const css = spot.textStyle ?? {}, size = Number.parseFloat(css['font-size'] ?? '')
  const lineHeight = css['line-height']?.trim(), lineSize = Number.parseFloat(lineHeight ?? '')
  const resolvedLineHeight = lineHeight === 'normal' ? 'normal'
    : Number.isFinite(lineSize) && lineSize > 0
      ? lineHeight?.endsWith('px') ? Number.isFinite(size) && size > 0 ? lineSize / size : undefined
        : /^\d*\.?\d+$/.test(lineHeight ?? '') ? lineSize : undefined
      : undefined
  const spacing = css['letter-spacing']?.trim(), letterSpacing = Number.parseFloat(spacing ?? '')
  return textComponentDataSchema.parse({ ...createTextComponentData(content), appearance: {
    ...(css['font-family'] ? { fontFamily: css['font-family'] } : {}),
    ...(Number.isFinite(size) && size > 0 ? { fontSize: size } : {}),
    ...(css.color ? { color: css.color } : {}),
    ...(css['font-weight'] ? { bold: css['font-weight'] === 'bold' || Number.parseInt(css['font-weight'], 10) >= 600 } : {}),
    ...(css['font-style'] ? { italic: css['font-style'] === 'italic' } : {}),
    ...(css['text-align'] && ['left', 'center', 'right'].includes(css['text-align']) ? { align: css['text-align'] as 'left' | 'center' | 'right' } : {}),
    ...(resolvedLineHeight !== undefined ? { lineHeight: resolvedLineHeight } : {}),
    ...(Number.isFinite(letterSpacing) && (spacing?.endsWith('px') || /^-?\d*\.?\d+$/.test(spacing ?? '')) ? { letterSpacing } : {}),
  } })
}

/** A display:contents field has no element box; its text still has real client geometry. */
export function nativeTextClientRect(element: Element): DOMRect | null {
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  const rectangles = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : []
  const visible = rectangles.filter(rect => rect.width > 0 && rect.height > 0)
  if (visible.length) {
    const left = Math.min(...visible.map(rect => rect.left)), top = Math.min(...visible.map(rect => rect.top))
    const right = Math.max(...visible.map(rect => rect.right)), bottom = Math.max(...visible.map(rect => rect.bottom))
    const Rect = element.ownerDocument.defaultView?.DOMRect ?? DOMRect
    return new Rect(left, top, right - left, bottom - top)
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? rect : null
}

/** Native document renderers already publish the exact slot path; never infer a field by matching text. */
export function nativeTextSpotFromElement(project: CourseProjectV10, instanceId: string, element: Element,
  bounds: ComponentFrame): ComponentAuthorSpot | undefined {
  const instance = project.instances[instanceId], slot = element.closest<HTMLElement>('[data-document-path]')
  if (!instance || !slot || slot.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance !== instanceId) return undefined
  let path: unknown
  try { path = JSON.parse(slot.dataset.documentPath ?? '') } catch { return undefined }
  if (!Array.isArray(path) || path.some(key => typeof key !== 'string')) return undefined
  const value = authorSpotValue(instance.data, path)
  if (typeof value !== 'string' && !authorFieldRichContent(value)) return undefined
  const computed = slot.ownerDocument.defaultView?.getComputedStyle(slot)
  const textStyle = computed ? Object.fromEntries(['font-family', 'font-size', 'color', 'font-weight', 'font-style',
    'text-decoration-line', 'background-color', 'text-align', 'line-height', 'letter-spacing'].map(name => [name, computed.getPropertyValue(name)])) : undefined
  return { id: `native-slot:${instanceId}:${JSON.stringify(path)}`, instanceId, mountGeneration: 0,
    kind: 'text', dataPath: [...path], initialValue: structuredClone(value!), localBounds: bounds, textStyle }
}
