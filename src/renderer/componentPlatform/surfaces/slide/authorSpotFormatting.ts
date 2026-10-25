import type { ComponentAuthorSpot, CourseProjectV10 } from '../../../../shared/contracts/component-platform'
import type { PropertiesPatch } from '../../../ui/properties/SlideNativePropertiesPanel'
import type { TextFormatView } from '../../../editing/quickbar/TextFormatActions'
import { domTextFormatView, domTextStylePatch } from '../../../editing/quickbar/domTextFormatting'
import { authorSpotIsSvgText, authorSpotStyleSourceRegion } from '../../../../core/components/authoring/componentAuthorEdits'

export function authorSpotFormatView(project: CourseProjectV10, spot: ComponentAuthorSpot): TextFormatView & { alignment: boolean; highlight: boolean; lineSpacing: boolean } | null {
  if (spot.kind !== 'text' || typeof spot.initialValue !== 'string' || !spot.textStyle || !spot.authorKey || !spot.binding) return null
  const exactHtml = !spot.geometry && authorSpotStyleSourceRegion(project, spot)
  if (!spot.geometry && !exactHtml) return null
  const style = { ...spot.textStyle, ...project.instances[spot.instanceId]?.authoring?.records?.[spot.authorKey]?.overrides.style }
  const svg = authorSpotIsSvgText(spot)
  const alignment = Boolean(spot.geometry) && /^(?:p|div|h[1-6]|li|td|th|section|article|blockquote|pre|header|footer|main|aside)$/.test(spot.binding.path.at(-1)?.tag ?? '')
  return { ...domTextFormatView(spot.initialValue, style, svg), alignment, highlight: !svg, lineSpacing: !svg }
}

export function authorSpotStylePatch(spot: ComponentAuthorSpot, view: TextFormatView, patch: PropertiesPatch): Record<string, string> {
  return domTextStylePatch(spot.textStyle ?? {}, authorSpotIsSvgText(spot), view, patch)
}
