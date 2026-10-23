import { owningContainer } from './contracts/component-platform/project'
import type { CourseProjectV10, JsonObject, ComponentDefinition, ComponentInstance } from './contracts/component-platform/project'

/** An unframed native group may use browser layout without changing child identity.
 * Framed groups retain their authored affine composition, including captured CSS. */
export function isNativeFlowLayoutGroup(instance: Pick<ComponentInstance, 'frame' | 'implementationOverride' | 'style'>, definition?: ComponentDefinition): boolean {
  const implementation = instance.implementationOverride ?? definition?.implementation
  return !instance.frame && implementation?.kind === 'builtin' && implementation.key === 'guoling.group'
    && (instance.style?.display === 'grid' || instance.style?.display === 'flex')
}

const containerProperties = /^(?:display|gap|rowGap|columnGap|gridTemplate(?:Columns|Rows|Areas)?|gridAuto(?:Columns|Rows|Flow)|flexDirection|flexWrap|flexFlow|alignItems|alignContent|justifyItems|justifyContent|placeItems|placeContent)$/
const itemProperties = /^(?:(?:min|max)?(?:Width|Height)|width|height|inlineSize|blockSize|minInlineSize|maxInlineSize|minBlockSize|maxBlockSize|margin(?:Top|Right|Bottom|Left|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?|grid(?:Area|Row|Column|RowStart|RowEnd|ColumnStart|ColumnEnd)|order|flex|flexBasis|flexGrow|flexShrink|alignSelf|justifySelf|placeSelf|zIndex|aspectRatio)$/
const stickyProperties = /^(?:inset(?:(?:Block|Inline)(?:Start|End)?)?|top|right|bottom|left|zIndex)$/
const unitless = /^(?:order|zIndex|flex|flexGrow|flexShrink|grid(?:Row|Column)(?:Start|End)?|aspectRatio)$/
function camel(key: string): string { return key.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()) }

export function isNativeFlowContainerStyle(key: string): boolean { return containerProperties.test(camel(key)) }
export function isNativeFlowItemStyle(key: string): boolean { return itemProperties.test(camel(key)) }

/** Sticky stays in the existing reading order; the browser uses its actual Flow scroll owner. */
export function isFlowStickyStyle(instance: Pick<ComponentInstance, 'style'>, key: string): boolean {
  return instance.style?.position === 'sticky' && (key === 'position' || stickyProperties.test(camel(key)))
}

export function flowStickyStyle(instance: Pick<ComponentInstance, 'style'>): Record<string, string> {
  return instance.style?.position === 'sticky' ? { position: 'sticky', ...projectStyle(instance, stickyProperties) } : {}
}

/** Only the existing Flow owner (or explicit viewport stretch) grants CSS placement. */
export function componentFlowStylePolicy(project: CourseProjectV10, instance: ComponentInstance, patch: JsonObject = {}): (key: string) => boolean {
  const owner = owningContainer(project, instance.id)
  const parent = owner?.kind === 'instance' ? project.instances[owner.instanceId] : undefined
  let ancestor = parent, inFlow = false
  while (ancestor) {
    if (ancestor.container) { inFlow = ancestor.container.kind === 'flow'; break }
    const next = owningContainer(project, ancestor.id)
    ancestor = next?.kind === 'instance' ? project.instances[next.instanceId] : undefined
  }
  const definition = project.definitions[instance.definitionId]
  const group = inFlow && (isNativeFlowLayoutGroup(instance, definition)
    || isNativeFlowLayoutGroup({ ...instance, style: { ...instance.style, ...patch } }, definition))
  const item = group || inFlow && Boolean(parent && isNativeFlowLayoutGroup(parent, project.definitions[parent.definitionId]))
  const nextStyle = Object.fromEntries([...Object.entries(instance.style ?? {}), ...Object.entries(patch)].map(([key, value]) => [camel(key), value]))
  const wasSticky = instance.style?.position === 'sticky'
  const retiresSticky = wasSticky && (nextStyle.position === null || nextStyle.position === 'relative' || nextStyle.position === 'static')
  return key => group && isNativeFlowContainerStyle(key) || item && isNativeFlowItemStyle(key)
    || inFlow && (isFlowStickyStyle({ style: nextStyle }, key)
      || camel(key) === 'position' && retiresSticky
      || wasSticky && stickyProperties.test(camel(key)) && patch[key] === null)
    || Boolean(instance.viewportPinned && ['width', 'height'].includes(camel(key)) && (patch[key] === '100%' || instance.style?.[camel(key)] === '100%'))
}

function projectStyle(instance: Pick<ComponentInstance, 'style'>, accept: RegExp): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(instance.style ?? {})) {
    const key = camel(name)
    if (!accept.test(key) || typeof value !== 'string' && typeof value !== 'number') continue
    result[key] = typeof value === 'number' && value !== 0 && !unitless.test(key) ? value + 'px' : String(value)
  }
  return result
}

/** Layout declarations belong on the direct child holder, never on a one-child stage. */
export function nativeFlowContainerStyle(instance: ComponentInstance): Record<string, string> {
  return projectStyle(instance, containerProperties)
}
export function nativeFlowItemStyle(instance: Pick<ComponentInstance, 'style'>): Record<string, string> {
  return projectStyle(instance, itemProperties)
}

/** Explicit native media heights remain CSS Flow boxes, without a fixed frame. */
export function nativeFlowMediaBlockSize(project: CourseProjectV10, instance: ComponentInstance): string | undefined {
  const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  if (instance.frame || implementation?.kind !== 'builtin' || !['guoling.image', 'guoling.video', 'guoling.audio'].includes(implementation.key)) return
  const owner = owningContainer(project, instance.id)
  const parent = owner?.kind === 'instance' ? project.instances[owner.instanceId] : undefined
  if (!parent || !isNativeFlowLayoutGroup(parent, project.definitions[parent.definitionId])) return
  const style = nativeFlowItemStyle(instance), value = style.blockSize ?? style.height
  return value && value !== 'auto' ? value : undefined
}
