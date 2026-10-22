/** One-time read adaptation. Flow paper has layout only in the current author model. */
export function normalizeLegacyFlowBackgrounds<T>(input: T): T {
  if (!input || typeof input !== 'object') return input
  const project = input as Record<string, any>
  let changed = false
  const convert = (container: any) => {
    const layout = container?.kind === 'flow' && container.flow?.layout
    if (!layout || !Object.hasOwn(layout, 'paperBackgroundColor')) return container
    changed = true
    const { paperBackgroundColor: color, ...metrics } = layout
    // Old producers wrote this white default mechanically. The work's default is
    // already white; turning it into own paint would newly hide the global plane.
    const background = !project.background && container.background?.mode !== 'own'
      && typeof color === 'string' && color.toLowerCase() !== '#ffffff'
      ? { mode: 'own', color } : container.background
    return { ...container, flow: { ...container.flow, layout: metrics }, ...(background ? { background } : {}) }
  }
  const surfaces = Array.isArray(project.surfaces) ? project.surfaces.map(convert) : undefined
  const source = project.instances ?? project.example?.instances
  const instances = source && Object.fromEntries(Object.entries(source).map(([id, value]) => {
    const instance = value as any, container = convert(instance.container)
    return [id, container === instance.container ? instance : { ...instance, container }]
  }))
  return changed ? { ...project, ...(surfaces ? { surfaces } : {}), ...(project.instances ? { instances } : {}),
    ...(project.example ? { example: { ...project.example, instances } } : {}) } as T : input
}

export function hasLegacyFlowBackgrounds(input: unknown): boolean {
  return normalizeLegacyFlowBackgrounds(input) !== input
}
