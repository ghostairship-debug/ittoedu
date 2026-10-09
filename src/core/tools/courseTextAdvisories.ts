import { textComponentDataSchema } from '../../components/text/data'
import { shapeDataSchema } from '../../components/shape/data'
import { frameCorners } from '../components/geometry'
import { componentParentMatrix } from '../drivers/courseV10Operations'
import { isComponentVisibleAtSurface, owningContainer, resolveComponentBackground, resolveComponentPresentation,
  type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { ToolAdvisory, ToolTarget } from '../../shared/workbench/tools'

function contrastRatio(first: string, second: string): number | null {
  if (![first, second].every(color => /^#[\da-f]{6}$/i.test(color))) return null
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map(offset => {
      const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const a = luminance(first), b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Feedback about an acknowledged edit, never a layout writer or an ACK gate. */
export function courseTextAdvisories(source: CourseProjectV10, target: Extract<ToolTarget, { kind: 'course-instance' }>,
  step: number, suppliedBackgroundColor: boolean): ToolAdvisory[] {
  const project = resolveComponentPresentation(source, target.surfaceId, target.stateId ?? null)
  const instance = project.instances[target.instanceId]
  const definition = instance && project.definitions[instance.definitionId]
  if (!instance?.frame || instance.implementationOverride || definition?.implementation.kind !== 'builtin'
    || definition.implementation.key !== 'guoling.text' || Object.keys(instance.style ?? {}).length) return []
  const parsed = textComponentDataSchema.safeParse(instance.data)
  if (!parsed.success) return []
  const { appearance, sizing, content } = parsed.data, frame = instance.frame
  const advisories: ToolAdvisory[] = []
  if (sizing.mode === 'shrink-text' && appearance.writingMode === 'horizontal'
    && !content.inlines.some(inline => inline.style?.fontSize !== undefined)
    && frame.height - 2 * appearance.padding < appearance.fontSize) {
    advisories.push({ step, code: 'native-text-shrink', message: `文字框可用高度 ${Math.max(0, frame.height - 2 * appearance.padding)}px 小于设定字号 ${appearance.fontSize}px；shrink 可能把字缩小，请增高文字框或减小 padding。` })
  }
  if (suppliedBackgroundColor && appearance.backgroundOpacity === 0) advisories.push({ step,
    code: 'native-text-transparent-background', message: '已设置文字背景色，但 backgroundOpacity 为 0，底色仍透明；需要可见底色时请同时设置非零不透明度。' })

  const surface = project.surfaces.find(value => value.id === target.surfaceId)
  // Flow, containers and custom implementations need observed pixels, not a flat-slide guess.
  if (surface?.kind !== 'slide' || owningContainer(project, target.instanceId)?.kind !== 'surface'
    || !isComponentVisibleAtSurface(instance, surface.id) || appearance.backgroundOpacity !== 0
    || content.inlines.some(inline => inline.type === 'math' || inline.style?.color !== undefined || inline.style?.fontSize !== undefined
      || inline.style?.bold !== undefined)) return advisories
  const background = resolveComponentBackground(project, surface)
  if (background.assetId !== null) return advisories
  const bounds = (id: string) => {
    const item = project.instances[id]
    if (!item?.frame) return null
    const points = frameCorners(item.frame, componentParentMatrix(project, id))
    return { left: Math.min(...points.map(point => point.x)), right: Math.max(...points.map(point => point.x)),
      top: Math.min(...points.map(point => point.y)), bottom: Math.max(...points.map(point => point.y)) }
  }
  const text = bounds(instance.id)!
  const mounted = [...project.global.underlay, ...surface.childIds, ...project.global.overlay]
  if (mounted.some(id => {
    if (id === instance.id) return false
    const item = project.instances[id]
    if (!item || !isComponentVisibleAtSurface(item, surface.id) || item.style?.opacity === 0) return false
    const box = bounds(id)
    // Unknown placement or overflow may cover the text even outside an authored frame.
    const implementation = project.definitions[item.definitionId]?.implementation
    if (!box || Object.keys(item.style ?? {}).length || item.implementationOverride || item.childIds?.length
      || implementation?.kind !== 'builtin' || implementation.key !== 'guoling.shape') return true
    const shape = shapeDataSchema.safeParse(item.data)
    if (!shape.success || shape.data.pathGeometry || shape.data.lineGeometry) return true
    return box.left < text.right && text.left < box.right && box.top < text.bottom && text.top < box.bottom
  })) return advisories
  const ratio = contrastRatio(appearance.color, background.color)
  const minimum = appearance.fontSize >= 24 || appearance.bold && appearance.fontSize >= 19 ? 3 : 4.5
  if (ratio !== null && ratio < minimum) advisories.push({ step, code: 'native-text-low-contrast',
    message: `文字颜色 ${appearance.color} 与页面背景 ${background.color} 的对比度约 ${ratio.toFixed(2)}:1；文字框底色透明。请改用更清晰的文字颜色，或设置可见底色，并检查实际画面。` })
  return advisories
}
