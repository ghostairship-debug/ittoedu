export function isSpatialTeacherController(item: unknown): boolean {
  return false
}

export function spatialLayerCoordinateSpace(
  source: 'global' | 'surface' | 'world',
  item: unknown,
): 'world' | 'viewport' {
  if (isSpatialTeacherController(item) || source === 'global') return 'viewport'
  return 'world'
}
