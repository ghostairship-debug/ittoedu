/** Shared identity rule for author documents and Published payloads. */
export function isTeacherController(item: {
  kind: string; role?: string
} | undefined | null): boolean {
  return item?.kind === 'component' && item.role === 'teacher-controller'
}

export function omitTeacherControllerFromStaticExport(item: {
  kind: string; role?: string; props?: Record<string, unknown>
}): boolean {
  return isTeacherController(item) && item.props?.includeInStaticExports !== true
}

/** Role validation is independent of package names and user-editable props. */
export function teacherControllerRoleIssues(document: {
  globalLayerItems: readonly { item: { kind: string; role?: string }; plane?: string }[]
  surfaces: readonly {
    surfaceLayerItems: readonly { item: { kind: string; role?: string } }[]
    scenes?: readonly { layerItems: readonly { kind: string; role?: string }[] }[]
    world?: { layerItems: readonly { kind: string; role?: string }[] }
  }[]
}): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = []
  const controllers = document.globalLayerItems.filter(e => isTeacherController(e.item))
  if (controllers.length > 1) {
    issues.push({ path: ['globalLayerItems'], message: '教师控制台必须保持全局单份' })
  }
  document.globalLayerItems.forEach((entry, i) => {
    if (entry.item.role === 'teacher-controller' && entry.plane === 'underlay') {
      issues.push({ path: ['globalLayerItems', i, 'plane'], message: '教师控制台必须位于全局 Overlay' })
    }
  })
  const check = (item: { role?: string }, path: (string | number)[]) => {
    if (item.role === 'teacher-controller') issues.push({ path: [...path, 'role'], message: '教师控制台只能位于全局 Overlay' })
  }
  document.surfaces.forEach((surface, si) => {
    surface.surfaceLayerItems.forEach((e, i) => check(e.item, ['surfaces', si, 'surfaceLayerItems', i, 'item']))
    surface.scenes?.forEach((s, j) => s.layerItems.forEach((item, i) => check(item, ['surfaces', si, 'scenes', j, 'layerItems', i])))
    surface.world?.layerItems.forEach((item, i) => check(item, ['surfaces', si, 'world', 'layerItems', i]))
  })
  return issues
}

/** Editing a global controller in place never changes its document owner. */
export function canEditLayerInScope(layer: { source: string; item: { kind: string; role?: string } }, scope: string): boolean {
  return layer.source === scope || (scope === 'scene' && layer.source === 'global' && isTeacherController(layer.item))
}
