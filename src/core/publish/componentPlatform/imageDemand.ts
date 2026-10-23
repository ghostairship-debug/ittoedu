import type { ComponentDefinition, ComponentInstance, CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import { componentProjectLayoutViewports } from '../../projectFiles/componentPlatform/projection'
import { imageDerivativePlan, type ImageDerivativeDemand } from '../../../shared/imageDerivative'
import { IDENTITY_MATRIX, multiplyMatrices, type AffineMatrix } from '../../components/geometry'
import { resolveComponentOuterPresentation } from '../../../shared/componentPresentation'
import { resolveFlowMediaLayoutInlineSize, type FlowMediaLayoutWidths } from '../../../shared/flowMediaLayout'
import { isNativeFlowLayoutGroup } from '../../../shared/flowNativeLayout'

function builtin(instance: ComponentInstance, definition: ComponentDefinition | undefined): string | undefined {
  const implementation = instance.implementationOverride ?? definition?.implementation
  return implementation?.kind === 'builtin' ? implementation.key : undefined
}

/** Restore-original is an editor reference. Other real consumers can still retain it independently. */
export function runtimeImageAssetIds(instance: ComponentInstance, definition: ComponentDefinition | undefined, ids: readonly string[]): string[] {
  if (builtin(instance, definition) !== 'guoling.image' || !instance.data || typeof instance.data !== 'object' || Array.isArray(instance.data)) return [...ids]
  const { assetId, originalAssetId } = instance.data
  return ids.filter(id => id !== originalAssetId || id === assetId)
}

const positive = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^(?:\d+\.?\d*|\.\d+)px$/.test(value) ? Number(value.slice(0, -2)) : NaN
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function projectedDemand(source: { width: number; height: number }, width: number, height: number,
  transform: AffineMatrix, dpr: number, fit: 'contain' | 'cover' | 'stretch', cropWidth = 1, cropHeight = 1): ImageDerivativeDemand {
  const sx = Math.hypot(transform[0], transform[1]), sy = Math.hypot(transform[2], transform[3])
  const x = width / (source.width * (cropWidth > 0 ? cropWidth : 1)), y = height / (source.height * (cropHeight > 0 ? cropHeight : 1))
  const localFit = fit === 'cover' ? Math.max(x, y) : Math.min(x, y)
  const ratio = Math.min(1, Math.max((fit === 'stretch' ? x : localFit) * sx, (fit === 'stretch' ? y : localFit) * sy) * dpr)
  return { width: Math.ceil(source.width * ratio), height: Math.ceil(source.height * ratio), dpr: 1, fit: 'cover' }
}

/** Largest known display across uses/states; an unknown program use retains full resolution. */
export function publishedImageDemands(versions: readonly CourseProjectV10[], assetIds: (instance: ComponentInstance, project: CourseProjectV10) => readonly string[], dpr = 2): Map<string, ImageDerivativeDemand> {
  const demands = new Map<string, ImageDerivativeDemand>(), unknown = new Set<string>()
  const remember = (project: CourseProjectV10, id: string, demand: ImageDerivativeDemand) => {
    const source = project.assets[id]
    if (!source?.width || !source.height) { unknown.add(id); return }
    const plan = imageDerivativePlan(source as { width: number; height: number }, source.mimeType ?? '', { animated: false, alpha: false, lossy: false }, demand)
    const prior = demands.get(id)
    demands.set(id, { width: Math.max(prior?.width ?? 0, plan.width), height: Math.max(prior?.height ?? 0, plan.height), dpr: 1, fit: 'cover' })
  }
  for (const project of versions) {
    for (const asset of Object.values(project.theme?.assets ?? {})) unknown.add(asset.assetId)
    const layouts = componentProjectLayoutViewports(project)
    const parent = new Map<string, string>()
    for (const instance of Object.values(project.instances)) for (const id of instance.childIds ?? []) parent.set(id, instance.id)
    type Display = { matrix: AffineMatrix; children: 'free' | 'flow'; flow?: FlowMediaLayoutWidths; stateOwners: number; unknown: boolean; width?: number; height?: number }
    const displays = new Map<string, Display>()
    const display = (id: string): Display => {
      const saved = displays.get(id)
      if (saved) return saved
      const instance = project.instances[id], ancestor = parent.get(id), owner = ancestor ? project.instances[ancestor] : undefined
      const above = ancestor ? display(ancestor) : undefined
      const placement = owner?.container ? owner.container.kind === 'flow' && !instance.flowPlacement ? 'flow' : 'free' : above?.children ?? 'free'
      const flow = owner?.container?.kind === 'flow' ? owner.container.flow?.layout ?? { readingWidth: 860, wideContentWidth: 1100 } : above?.flow
      const tier = instance.flowLayout?.width ?? 'content-width'
      const stateOwners = (above?.stateOwners ?? 0) + (instance.container?.presentation?.states.length ? 1 : 0)
      // Reading/wide lanes have an authored upper bound. Fluid/full-width and
      // browser grid/flex allocation need a measured viewport; keep their originals.
      // Players compose independently active nested presentation states. The
      // individual effective snapshots below do not bound their combined scale.
      const unknown = Boolean(above?.unknown || stateOwners > 1 || instance.container && ancestor || owner?.container?.kind === 'spatial'
        || placement === 'flow' && (flow?.widthMode === 'fluid' || tier === 'full-width'
        || owner && isNativeFlowLayoutGroup(owner, project.definitions[owner.definitionId])))
      const inlineSize = placement === 'flow' && flow ? resolveFlowMediaLayoutInlineSize(tier, flow, Number.MAX_SAFE_INTEGER)
        : instance.frame?.width ?? positive(instance.style?.inlineSize ?? instance.style?.width) ?? layouts.instances.get(id)?.width ?? 1280
      const presentation = resolveComponentOuterPresentation(project, instance, { placement, purpose: 'playback', inlineSize, flowLayout: flow })
      // A project-root container is laid out by its viewport owner, which does
      // not apply the instance's free-object frame. Nested fit/camera is unknown.
      const rootContainer = Boolean(instance.container && project.rootIds.includes(id))
      const affine = multiplyMatrices(above?.matrix ?? IDENTITY_MATRIX, placement === 'free' && !rootContainer ? instance.frame?.transform ?? IDENTITY_MATRIX : IDENTITY_MATRIX)
      const matrix = multiplyMatrices(affine, [presentation.scale, 0, 0, presentation.scale, 0, 0])
      const width = instance.frame?.width ?? positive(instance.style?.inlineSize ?? instance.style?.width) ?? (placement === 'flow' ? inlineSize : layouts.instances.get(id)?.width)
      const value: Display = { matrix, children: instance.container ? instance.container.kind === 'flow' ? 'flow' : 'free' : presentation.childrenPlacement,
        flow, stateOwners, unknown, width, height: instance.frame?.height ?? positive(instance.style?.blockSize ?? instance.style?.height) }
      displays.set(id, value)
      return value
    }
    for (const instance of Object.values(project.instances)) {
      const ids = assetIds(instance, project), data = instance.data
      const key = builtin(instance, project.definitions[instance.definitionId])
      const image = key === 'guoling.image'
        && data && typeof data === 'object' && !Array.isArray(data) ? data : undefined
      for (const id of ids) {
        const source = project.assets[id]
        if (!source || source.kind !== 'image' && !source.mimeType?.startsWith('image/')) continue
        // A native container's background is measured below, independently of
        // source-program dependencies which still make the same asset unknown.
        if (instance.container && key === `guoling.container.${instance.container.kind}` && id === instance.container.background?.assetId) continue
        if (!image || id !== image.assetId || !source.width || !source.height) { unknown.add(id); continue }
        const geometry = display(instance.id), transform = geometry.matrix
        const width = geometry.width
        const height = geometry.height
          ?? (width ? width * source.height / source.width : undefined)
        if (geometry.unknown || !width || !height) { unknown.add(id); continue }
        const crop = image.crop && typeof image.crop === 'object' && !Array.isArray(image.crop) ? image.crop : undefined
        const cropWidth = crop ? 1 - Number(crop.left ?? 0) - Number(crop.right ?? 0) : 1
        const cropHeight = crop ? 1 - Number(crop.top ?? 0) - Number(crop.bottom ?? 0) : 1
        // Fit in local coordinates first, then project both source axes. Taking
        // contain's minimum after affine scaling would undersample a stretched axis.
        const demand = projectedDemand(source as { width: number; height: number }, width, height, transform, dpr,
          image.fit === 'cover' || image.fit === 'stretch' ? image.fit : 'contain', cropWidth, cropHeight)
        // Keep full-source coordinates; all authored crop/fit values remain unchanged.
        remember(project, id, demand)
      }
    }
    // Background CSS can cover an arbitrarily tall Flow or use custom sizes/repeats.
    const backgrounds = [{ background: project.background, instance: undefined as ComponentInstance | undefined },
      ...Object.values(project.instances).map(instance => ({ background: instance.container?.background,
        instance }))]
    for (const { background, instance } of backgrounds) {
      if (background?.assetId) {
        const source = project.assets[background.assetId], geometry = instance ? display(instance.id) : undefined
        const viewport = instance?.container?.kind === 'slide' ? layouts.surfaces.get(instance.id) : undefined
        if (viewport && geometry && !geometry.unknown && source?.width && source.height)
          remember(project, background.assetId, projectedDemand(source as { width: number; height: number }, viewport.width, viewport.height,
            geometry.matrix, dpr, background.fit === 'fill' ? 'stretch' : background.fit ?? 'cover'))
        else unknown.add(background.assetId)
      }
      for (const layer of background?.paint?.layers ?? []) for (const id of Object.values(layer.resourceBindings)) unknown.add(id)
    }
  }
  for (const id of unknown) demands.delete(id)
  return demands
}
